"""Firestore helpers for the races-api admin backend."""

import logging
import os
from typing import Any, Dict, Optional

from fastapi import HTTPException

from shared.config import FIRESTORE_RACES_COLLECTION
from shared.race_catalog import build_race_summary_fields, build_versioned_catalog_fields

_FIRESTORE_PROJECT = os.getenv("FIRESTORE_PROJECT") or os.getenv("PROJECT_ID")

# Module-level singleton — tests reset this to None to force re-creation.
_fs_db = None


def _get_fs() -> Any:
    """Return a lazily-initialised Firestore client, or raise 503 if unavailable."""
    global _fs_db
    if _fs_db is not None:
        return _fs_db
    try:
        from google.cloud import firestore  # type: ignore

        _fs_db = firestore.Client(project=_FIRESTORE_PROJECT) if _FIRESTORE_PROJECT else firestore.Client()
        return _fs_db
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Firestore unavailable: {exc}") from exc


def _ts_to_str(v: Any) -> Any:
    """Convert Firestore/datetime timestamps to ISO strings."""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _strip_quality_score(value: Any) -> Any:
    """Remove legacy race-level quality_score fields from Firestore payloads."""
    if isinstance(value, dict):
        return {k: _strip_quality_score(v) for k, v in value.items() if k != "quality_score"}
    if isinstance(value, list):
        return [_strip_quality_score(v) for v in value]
    return value


def _doc_to_plain(doc: Any) -> Optional[Dict[str, Any]]:
    """Convert a Firestore DocumentSnapshot to a JSON-serialisable dict, or None."""
    if not doc.exists:
        return None
    raw = doc.to_dict() or {}
    plain = {k: _ts_to_str(v) for k, v in raw.items()}
    return _strip_quality_score(plain)


def _fs_update_race(race_id: str, fields: Dict[str, Any]) -> None:
    """Merge fields into the races/{race_id} Firestore document (best-effort)."""
    try:
        from google.cloud.firestore_v1 import SERVER_TIMESTAMP  # type: ignore

        fields = _strip_quality_score(dict(fields))
        fields.setdefault("updated_at", SERVER_TIMESTAMP)
        if fields.get("race_id") is None:
            fields["race_id"] = race_id
        _get_fs().collection(FIRESTORE_RACES_COLLECTION).document(race_id).set(fields, merge=True)
    except Exception as exc:
        logging.warning("Firestore race update %s failed: %s", race_id, exc)


def _fs_build_draft_catalog_fields(race_id: str, race_data: Dict[str, Any]) -> Dict[str, Any]:
    fields = build_race_summary_fields(race_id, race_data)
    fields.update(build_versioned_catalog_fields("draft", race_data))
    fields["draft_updated_at"] = race_data.get("updated_utc")
    return fields


def _fs_build_published_catalog_fields(race_id: str, race_data: Dict[str, Any]) -> Dict[str, Any]:
    fields = build_race_summary_fields(race_id, race_data)
    fields.update(build_versioned_catalog_fields("published", race_data))
    fields["published_at"] = race_data.get("updated_utc")
    return fields


# ---------------------------------------------------------------------------
# Conditional (read-then-write) updates
# ---------------------------------------------------------------------------

_ACTIVE_RACE_STATUSES = ("queued", "running")


def _update_if_unchanged(db: Any, doc_ref: Any, snapshot: Any, fields: Dict[str, Any]) -> bool:
    """Apply ``fields`` only if the document has not changed since ``snapshot``.

    Uses Firestore's ``last_update_time`` precondition so a concurrent writer
    (the worker finishing a run, another admin click) is never silently
    overwritten by a decision made on stale data. Returns False when the
    precondition fails (or the document vanished) so the caller can re-read.
    """
    from google.api_core import exceptions as gexc  # type: ignore

    update_time = getattr(snapshot, "update_time", None)
    try:
        if update_time is None:
            doc_ref.update(fields)
        else:
            doc_ref.update(fields, option=db.write_option(last_update_time=update_time))
    except (gexc.FailedPrecondition, gexc.NotFound):
        return False
    return True


def _update_with_retry(
    db: Any,
    doc_ref: Any,
    build_fields: Any,
    snapshot: Any = None,
    attempts: int = 3,
) -> tuple[str, Dict[str, Any] | None]:
    """Read-decide-write loop guarded by an update-time precondition.

    ``build_fields(data)`` returns the fields to write, or None when the
    current document state no longer warrants a write. Returns
    ``(outcome, data)`` where outcome is ``updated``, ``skipped``, ``missing``
    or ``conflict`` (precondition kept failing) and data is the state the
    decision was made on.
    """
    data: Dict[str, Any] | None = None
    for _ in range(max(1, attempts)):
        if snapshot is None:
            snapshot = doc_ref.get()
        if not getattr(snapshot, "exists", False):
            return "missing", None
        data = snapshot.to_dict() or {}
        fields = build_fields(data)
        if fields is None:
            return "skipped", data
        if _update_if_unchanged(db, doc_ref, snapshot, fields):
            return "updated", data
        snapshot = None
    return "conflict", data


def _settled_race_status(race_data: Dict[str, Any], default: str) -> str:
    """Status a race returns to when its active run stops without finishing.

    Mirrors ``_self_heal_stale_active_race``: a race that still has a published
    or draft copy goes back to that state rather than looking empty.
    """
    if race_data.get("published_at"):
        return "published"
    if race_data.get("draft_updated_at"):
        return "draft"
    return default


def _settle_race_after_run_stop(db: Any, race_id: str, run_id: str | None, default_status: str) -> str:
    """Release a race's active status after its run was cancelled.

    Only touches the race while it is still queued/running for ``run_id`` (or
    has no run pointer), so cancelling a superseded run never clobbers a newer
    run or a finished race. Returns the outcome from ``_update_with_retry``.
    """
    try:
        from google.cloud.firestore_v1 import SERVER_TIMESTAMP  # type: ignore
    except Exception:  # pragma: no cover - library always present in deploys
        SERVER_TIMESTAMP = None

    def build(race_data: Dict[str, Any]) -> Dict[str, Any] | None:
        if race_data.get("status") not in _ACTIVE_RACE_STATUSES:
            return None
        current = race_data.get("current_run_id")
        if run_id and current and str(current) != str(run_id):
            return None
        fields: Dict[str, Any] = {
            "status": _settled_race_status(race_data, default_status),
            "current_run_id": None,
        }
        if SERVER_TIMESTAMP is not None:
            fields["updated_at"] = SERVER_TIMESTAMP
        return fields

    race_ref = db.collection(FIRESTORE_RACES_COLLECTION).document(str(race_id))
    try:
        outcome, _ = _update_with_retry(db, race_ref, build)
    except Exception as exc:
        logging.warning("Firestore race settle %s failed: %s", race_id, exc)
        return "error"
    if outcome == "conflict":
        logging.warning("Race %s changed concurrently while settling cancelled run %s", race_id, run_id)
    return outcome
