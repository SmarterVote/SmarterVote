"""GCS helpers for the races-api admin backend."""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from google.api_core.exceptions import NotFound, PreconditionFailed

from shared.config import NON_RACE_CATALOG_IDS
from shared.race_catalog import (
    build_agent_metrics_summary,
    build_candidate_summaries,
    build_forecast_summary,
    extract_quality_grade,
)

# Resolved once at startup; can be overridden in tests.
_GCS_BUCKET = os.getenv("GCS_BUCKET", "")

# Module-level singleton; tests can patch _get_gcs_admin to return a mock.
_gcs_admin_client = None


def _get_gcs_admin() -> Any:
    """Return a lazily-initialised GCS client, or None if unavailable."""
    global _gcs_admin_client
    if _gcs_admin_client is not None:
        return _gcs_admin_client
    try:
        from google.cloud import storage as gcs  # type: ignore

        _gcs_admin_client = gcs.Client()
        return _gcs_admin_client
    except ImportError:
        return None


def _gcs_list_race_ids(prefix: str) -> Optional[List[str]]:
    """List race IDs (JSON filename stems) under the given GCS prefix."""
    if not _GCS_BUCKET:
        return None
    client = _get_gcs_admin()
    if client is None:
        return None
    try:
        bucket = client.bucket(_GCS_BUCKET)
        # No max_results: the iterator pages through every blob. A fixed cap
        # silently truncated the listing once the catalog passed 500 contests.
        ids = []
        for blob in bucket.list_blobs(prefix=f"{prefix}/"):
            filename = blob.name.split("/")[-1]
            if not filename.endswith(".json"):
                continue
            race_id = filename[:-5]
            if (prefix == "races" and filename == "summaries.json") or race_id in NON_RACE_CATALOG_IDS:
                continue
            ids.append(race_id)
        return ids
    except Exception as exc:
        logging.warning("GCS list %s failed: %s", prefix, exc)
        return None


def _gcs_get_race_json(race_id: str, prefix: str) -> Optional[Dict[str, Any]]:
    """Fetch and parse a race JSON blob from GCS.

    Returns None only when the blob is genuinely absent (or holds invalid JSON).
    Transient provider errors propagate so callers never mistake an outage for
    a missing draft/published race.
    """
    if not _GCS_BUCKET:
        return None
    client = _get_gcs_admin()
    if client is None:
        return None
    bucket = client.bucket(_GCS_BUCKET)
    blob = bucket.blob(f"{prefix}/{race_id}.json")
    try:
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())
    except NotFound:
        return None
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logging.warning("GCS get %s/%s returned invalid JSON: %s", prefix, race_id, exc)
        return None


def _gcs_put_race_json(race_id: str, prefix: str, data: Dict[str, Any]) -> bool:
    """Upload a race JSON blob to GCS. Returns True on success."""
    if not _GCS_BUCKET:
        return False
    client = _get_gcs_admin()
    if client is None:
        return False
    try:
        bucket = client.bucket(_GCS_BUCKET)
        bucket.blob(f"{prefix}/{race_id}.json").upload_from_string(json.dumps(data, indent=2), content_type="application/json")
        return True
    except Exception as exc:
        logging.warning("GCS put %s/%s failed: %s", prefix, race_id, exc)
        return False


def _gcs_delete_race_json(race_id: str, prefix: str) -> bool:
    """Delete a race JSON blob from GCS. Returns True if it existed."""
    if not _GCS_BUCKET:
        return False
    client = _get_gcs_admin()
    if client is None:
        return False
    try:
        bucket = client.bucket(_GCS_BUCKET)
        blob = bucket.blob(f"{prefix}/{race_id}.json")
        if blob.exists():
            blob.delete()
            return True
        return False
    except Exception as exc:
        logging.warning("GCS delete %s/%s failed: %s", prefix, race_id, exc)
        return False


def _gcs_archive_race(race_id: str, src_prefix: str, source_label: str) -> bool:
    """Copy current blob to retired/{race_id}/<ts>-{source_label}.json."""
    if not _GCS_BUCKET:
        return False
    client = _get_gcs_admin()
    if client is None:
        return False
    try:
        bucket = client.bucket(_GCS_BUCKET)
        src_blob = bucket.blob(f"{src_prefix}/{race_id}.json")
        if not src_blob.exists():
            return False
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bucket.copy_blob(src_blob, bucket, f"retired/{race_id}/{ts}-{source_label}.json")
        return True
    except Exception as exc:
        logging.warning("GCS archive %s/%s failed: %s", src_prefix, race_id, exc)
        return False


def _gcs_archive_active_if_present(race_id: str, src_prefix: str, source_label: str) -> bool:
    """Archive an active artifact, distinguishing absence from provider failure.

    Returns ``False`` only when GCS is not configured or the source blob does
    not exist. Provider/client failures raise so destructive callers can stop.
    """
    if not _GCS_BUCKET:
        return False
    client = _get_gcs_admin()
    if client is None:
        raise RuntimeError("GCS client is unavailable while archiving race data")
    try:
        bucket = client.bucket(_GCS_BUCKET)
        src_blob = bucket.blob(f"{src_prefix}/{race_id}.json")
        if not src_blob.exists():
            return False
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bucket.copy_blob(src_blob, bucket, f"retired/{race_id}/{ts}-{source_label}.json")
        return True
    except Exception as exc:
        raise RuntimeError(f"Unable to archive {src_prefix}/{race_id}.json") from exc


def _gcs_list_versions(race_id: str) -> List[Dict[str, Any]]:
    """List retired versions for a race from GCS."""
    if not _GCS_BUCKET:
        return []
    client = _get_gcs_admin()
    if client is None:
        return []
    versions: List[Dict[str, Any]] = []
    try:
        bucket = client.bucket(_GCS_BUCKET)
        for blob in bucket.list_blobs(prefix=f"retired/{race_id}/", max_results=500):
            fname = blob.name.split("/")[-1]
            if not fname.endswith(".json"):
                continue
            stem = fname[:-5]
            parts = stem.rsplit("-", 1)
            source = parts[-1] if len(parts) == 2 else "unknown"
            ts_raw = parts[0] if len(parts) == 2 else stem
            try:
                ts: Optional[str] = datetime.strptime(ts_raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                ts = None
            versions.append({"filename": fname, "source": source, "archived_at": ts, "size_bytes": blob.size})
    except Exception as exc:
        logging.warning("GCS list versions %s failed: %s", race_id, exc)
    return versions


def _summary_from_race_data(race_id: str, race_data: Dict[str, Any]) -> Dict[str, Any]:
    """Build one races/summaries.json entry; the single builder every index writer uses.

    ``id`` is always the storage key ``race_id`` -- never the blob's own
    ``id`` field -- so the entry added on publish is the same one removed on
    unpublish/delete (both keyed by the URL race_id). A draft whose ``id``
    disagreed used to leave an orphaned index entry that nothing could remove.
    """
    return {
        "id": race_id,
        "title": race_data.get("title"),
        "office": race_data.get("office"),
        "jurisdiction": race_data.get("jurisdiction"),
        "state": race_data.get("state"),
        "contest_stage": race_data.get("contest_stage", "unknown"),
        "election_date": race_data.get("election_date", ""),
        "updated_utc": race_data.get("updated_utc", ""),
        "candidates": build_candidate_summaries(race_data),
        "quality_grade": extract_quality_grade(race_data),
        "agent_metrics": build_agent_metrics_summary(race_data),
        # One shape for every summary writer: this used to be a third hand-copied
        # field list that silently dropped takeaway, key_reasons, uncertainty and
        # the forecast panel from summaries.json, which the forecast page reads.
        "forecast": build_forecast_summary(race_data),
    }


def update_gcs_summaries_json(updates: Dict[str, Optional[Dict[str, Any]]], max_attempts: int = 5) -> None:
    """Update or remove race summaries in the central races/summaries.json index in GCS.

    `updates` is a mapping of race_id -> race_data (or None to remove it).
    """
    if not _GCS_BUCKET:
        return
    client = _get_gcs_admin()
    if client is None:
        raise RuntimeError("GCS client is unavailable while updating races/summaries.json")

    if not updates:
        return

    bucket = client.bucket(_GCS_BUCKET)
    for attempt in range(max_attempts):
        blob = bucket.blob("races/summaries.json")
        generation = 0
        summaries: List[Dict[str, Any]] = []
        try:
            blob.reload()
            generation = int(blob.generation or 0)
            loaded = json.loads(blob.download_as_text())
            if isinstance(loaded, list):
                summaries = [summary for summary in loaded if isinstance(summary, dict)]
        except NotFound:
            pass
        except (json.JSONDecodeError, ValueError) as exc:
            raise RuntimeError("Existing races/summaries.json is invalid") from exc

        races_to_update = set(updates.keys())
        summaries = [s for s in summaries if s.get("id") not in races_to_update]

        for race_id, race_data in updates.items():
            if race_data is not None:
                summaries.append(_summary_from_race_data(race_id, race_data))

        summaries.sort(key=lambda s: s.get("id", ""))
        try:
            blob.upload_from_string(
                json.dumps(summaries, indent=2),
                content_type="application/json",
                if_generation_match=generation,
            )
            return
        except PreconditionFailed:
            if attempt + 1 == max_attempts:
                break
            logging.info("races/summaries.json changed concurrently; retrying")

    raise RuntimeError("Failed to update races/summaries.json after concurrent writes")


def _assert_publishable_race(data: Dict[str, Any], race_id: Optional[str] = None) -> None:
    """Block publishing data that failed review or deterministic integrity checks.

    When ``race_id`` (the storage key) is given, the blob's own ``id`` must
    match it: the summaries index is keyed by the storage key, so a mismatched
    blob would publish under one ID while claiming another.
    """
    data_id = data.get("id")
    if race_id is not None and data_id is not None and data_id != race_id:
        raise ValueError(f"Race draft id {data_id!r} does not match race_id {race_id!r} and cannot be published")
    candidates = [candidate for candidate in data.get("candidates", []) if isinstance(candidate, dict)]
    names = [str(candidate.get("name") or "").strip() for candidate in candidates]
    normalized_names = [name.casefold() for name in names if name]
    if "candidates" in data and not normalized_names:
        raise ValueError("Race draft has no named candidates and cannot be published")
    if len(normalized_names) != len(set(normalized_names)):
        raise ValueError("Race draft contains duplicate candidate names and cannot be published")

    forecast = data.get("forecast")
    if isinstance(forecast, dict):
        winner = str(forecast.get("predicted_winner_name") or "").strip()
        if winner and winner.casefold() not in set(normalized_names):
            raise ValueError(f"Forecast winner {winner!r} is not present in the candidate roster")
        now = datetime.now(timezone.utc)
        for signal in forecast.get("market_signals") or []:
            if not isinstance(signal, dict):
                continue
            as_of = signal.get("as_of")
            if not isinstance(as_of, str):
                continue
            try:
                observed_at = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
                if observed_at.tzinfo is None:
                    observed_at = observed_at.replace(tzinfo=timezone.utc)
            except ValueError:
                raise ValueError(f"Prediction-market signal has invalid as_of timestamp: {as_of!r}") from None
            if observed_at > now + timedelta(minutes=5):
                raise ValueError("Prediction-market signal is future-dated and cannot be published")

    pipeline_state = data.get("pipeline_state")
    if isinstance(pipeline_state, dict) and pipeline_state.get("complete") is False:
        remaining = pipeline_state.get("remaining_steps") or []
        if set(str(step) for step in remaining) <= {"review"}:
            pass
        else:
            detail = f" Remaining steps: {', '.join(str(step) for step in remaining)}." if remaining else ""
            raise ValueError(f"Race draft is operationally incomplete and cannot be published.{detail}")

    # A flag marked `stale` was written against a roster this race no longer
    # has: reviewer flags address candidates positionally, so once the roster
    # changes `candidates[N].image_url` points at a different person entirely.
    # Such a flag is kept in the draft for the audit trail but must not block,
    # or a refresh that corrects a roster permanently inherits the previous
    # run's flags and can never be published.
    error_flags = [
        flag
        for review in data.get("reviews") or []
        if isinstance(review, dict)
        for flag in review.get("flags") or []
        if isinstance(flag, dict) and flag.get("severity") == "error" and not flag.get("stale")
    ]
    if error_flags:
        raise ValueError(f"Race has {len(error_flags)} unresolved error-severity review flag(s) and cannot be published")

    validation_grade = data.get("validation_grade")
    if not isinstance(validation_grade, dict):
        return
    if validation_grade.get("passed") is False:
        grade = validation_grade.get("grade") or "unknown"
        score = validation_grade.get("score")
        detail = f"Race failed validation ({grade}"
        if score is not None:
            detail += f", {score}/100"
        detail += ") and cannot be published"
        raise ValueError(detail)


def _gcs_delete_published_draft(race_id: str, data: Dict[str, Any]) -> bool:
    """Delete drafts/{race_id}.json only if it still holds the content just published.

    The draft generation is pinned when re-read and the delete uses
    ``if_generation_match``, so a newer draft written concurrently (e.g. by a
    worker finishing a run) is left in place instead of being destroyed.
    Returns True when no draft remains, False when a newer draft was kept.
    Provider errors propagate so the publish is reported as failed.
    """
    if not _GCS_BUCKET:
        return True
    client = _get_gcs_admin()
    if client is None:
        raise RuntimeError("GCS client is unavailable while removing published draft")
    blob = client.bucket(_GCS_BUCKET).blob(f"drafts/{race_id}.json")
    try:
        blob.reload()
        generation = blob.generation
        current = json.loads(blob.download_as_text(if_generation_match=generation))
    except NotFound:
        return True
    except PreconditionFailed:
        logging.info("Draft %s changed during publish; keeping the newer draft", race_id)
        return False
    except (json.JSONDecodeError, UnicodeDecodeError):
        current = None
    if current != data:
        logging.info("Draft %s differs from the published content; keeping the newer draft", race_id)
        return False
    try:
        blob.delete(if_generation_match=generation)
    except NotFound:
        return True
    except PreconditionFailed:
        logging.info("Draft %s changed during publish; keeping the newer draft", race_id)
        return False
    return True


def publish_race_to_gcs(race_id: str, data: Dict[str, Any]) -> bool:
    """Archive existing blobs, write new published blob, delete draft, update Firestore.

    Returns True when the published draft was removed, False when a newer
    draft written during the publish was preserved.
    """
    import firestore_helpers  # avoid circular at module load

    _assert_publishable_race(data, race_id)
    # Strict archive: a provider failure aborts the publish rather than
    # overwriting races/{id}.json with no retired copy of the previous version.
    _gcs_archive_active_if_present(race_id, "races", "published")
    _gcs_archive_active_if_present(race_id, "drafts", "draft")
    if not _gcs_put_race_json(race_id, "races", data):
        raise RuntimeError(f"Failed to write published race blob for {race_id}")

    draft_removed = _gcs_delete_published_draft(race_id, data)

    update: Dict[str, Any] = {
        "status": "published",
        "published_at": datetime.now(timezone.utc).isoformat(),
        "current_run_id": None,
    }
    if draft_removed:
        update["draft_updated_at"] = None
    firestore_helpers._fs_update_race(race_id, update)
    return draft_removed


# Alias used by races_admin router
_publish_race_gcs = publish_race_to_gcs


def save_chamber_forecasts(data: Dict[str, Any], draft: bool = False) -> None:
    """Save chamber forecasts to GCS or local file."""
    prefix = "drafts" if draft else "races"
    if _GCS_BUCKET:
        client = _get_gcs_admin()
        if client is not None:
            bucket = client.bucket(_GCS_BUCKET)
            bucket.blob(f"{prefix}/chamber_forecasts.json").upload_from_string(
                json.dumps(data, indent=2), content_type="application/json"
            )
            return

    from pathlib import Path

    from config import DATA_DIR

    filename = "chamber_forecasts_draft.json" if draft else "chamber_forecasts.json"
    local_path = Path(DATA_DIR) / filename
    local_path.parent.mkdir(parents=True, exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_chamber_forecasts(draft: bool = False) -> Optional[Dict[str, Any]]:
    """Load chamber forecasts from GCS or local file."""
    prefix = "drafts" if draft else "races"
    if _GCS_BUCKET:
        client = _get_gcs_admin()
        if client is not None:
            try:
                bucket = client.bucket(_GCS_BUCKET)
                blob = bucket.blob(f"{prefix}/chamber_forecasts.json")
                if blob.exists():
                    return json.loads(blob.download_as_text())
            except Exception as e:
                logging.warning("Error reading chamber forecasts from GCS: %s", e)

    from pathlib import Path

    from config import DATA_DIR

    filename = "chamber_forecasts_draft.json" if draft else "chamber_forecasts.json"
    local_path = Path(DATA_DIR) / filename
    if local_path.exists():
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logging.warning("Error reading local chamber forecasts: %s", e)
    return None
