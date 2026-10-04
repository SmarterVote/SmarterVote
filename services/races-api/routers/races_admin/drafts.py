"""Draft delete, publish, unpublish, and batch-publish endpoints."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict

import firestore_helpers
import gcs_helpers
from auth import verify_token
from fastapi import APIRouter, Depends, HTTPException, Request
from request_models import BatchPublishRequest, validate_race_id

# Imported as the package (not `from .helpers import _assert_publishable_race`) so that
# `unittest.mock.patch("routers.races_admin._assert_publishable_race", ...)` -- used by
# existing tests -- still takes effect here. Safe under circular import: this submodule
# is only loaded from `routers/races_admin/__init__.py`, which registers the package in
# `sys.modules` before executing its body, and the attribute is only read below at call
# time (never at import time).
from routers import races_admin as _races_admin_pkg
from routers.research_program import assert_race_admitted

from .helpers import _clear_public_race_cache, _published_race_update, _update_summaries_index

router = APIRouter()


def _assert_publishable_race(data: Dict[str, Any], race_id: str | None = None) -> None:
    """Block publishing drafts that the review gate explicitly failed.

    Delegates through the package namespace (see import comment above) so it
    remains patchable at ``routers.races_admin._assert_publishable_race``.
    """
    _races_admin_pkg._assert_publishable_race(data, race_id)


def _published_catalog_update(race_id: str, data: Dict[str, Any], draft_removed: bool) -> Dict[str, Any]:
    """Firestore catalog fields after publishing; keeps draft fields when a newer draft survived."""
    update: Dict[str, Any] = {
        **_published_race_update(),
        **firestore_helpers._fs_build_published_catalog_fields(race_id, data),
    }
    if draft_removed:
        update.update(
            {
                "draft_updated_utc": None,
                "draft_contest_stage": None,
                "draft_candidate_count": None,
                "draft_quality_grade": None,
                "draft_catalog_health": None,
            }
        )
    else:
        update.pop("draft_updated_at", None)
    return update


@router.delete("/api/races/{race_id}/draft", dependencies=[Depends(verify_token)])
def delete_draft_race(race_id: str) -> Dict[str, Any]:
    """Delete a draft race from GCS and update Firestore record."""
    validate_race_id(race_id)
    deleted = gcs_helpers._gcs_delete_race_json(race_id, "drafts")
    if not deleted:
        raise HTTPException(status_code=404, detail="Draft not found")
    has_published = gcs_helpers._gcs_get_race_json(race_id, "races") is not None
    update: Dict[str, Any] = {
        "status": "published" if has_published else "empty",
        "draft_updated_at": None,
        "draft_updated_utc": None,
        "draft_contest_stage": None,
        "draft_candidate_count": None,
        "draft_quality_grade": None,
        "draft_catalog_health": None,
    }
    if has_published:
        published_data = gcs_helpers._gcs_get_race_json(race_id, "races")
        if isinstance(published_data, dict):
            update.update(firestore_helpers._fs_build_published_catalog_fields(race_id, published_data))
    firestore_helpers._fs_update_race(race_id, update)
    return {"message": f"Draft {race_id} deleted", "id": race_id}


@router.post("/api/races/{race_id}/publish", dependencies=[Depends(verify_token)])
def publish_race(request: Request, race_id: str) -> Dict[str, Any]:
    """Publish a race (copy draft -> published in GCS)."""
    validate_race_id(race_id)
    assert_race_admitted(firestore_helpers._get_fs(), race_id, "publish")
    data = gcs_helpers._gcs_get_race_json(race_id, "drafts")
    if data is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    _assert_publishable_race(data, race_id)
    draft_removed = gcs_helpers._publish_race_gcs(race_id, data) is not False
    firestore_helpers._fs_update_race(race_id, _published_catalog_update(race_id, data, draft_removed))
    summaries_error = _update_summaries_index({race_id: data})
    _clear_public_race_cache(request)
    if summaries_error:
        raise HTTPException(
            status_code=502,
            detail={
                "message": f"Race {race_id} was published but races/summaries.json was not updated; retry the index update",
                "published": [race_id],
                "summaries_error": summaries_error,
            },
        )
    return {"message": f"Race {race_id} published", "id": race_id}


@router.post("/api/races/{race_id}/unpublish", dependencies=[Depends(verify_token)])
def unpublish_race(request: Request, race_id: str) -> Dict[str, Any]:
    """Remove a race from published (keeps draft).

    Idempotent with respect to the summaries index: when the published blob is
    already gone (e.g. a previous attempt deleted it and then failed to update
    races/summaries.json) the index entry is still removed before the 404, so
    a retry repairs the index instead of leaving the race listed forever.
    """
    validate_race_id(race_id)
    has_draft = gcs_helpers._gcs_get_race_json(race_id, "drafts") is not None
    deleted = gcs_helpers._gcs_delete_race_json(race_id, "races")
    if not deleted:
        summaries_error = _update_summaries_index({race_id: None})
        if summaries_error is None:
            _clear_public_race_cache(request)
        raise HTTPException(status_code=404, detail="Published race not found")
    update: Dict[str, Any] = {
        "status": "draft" if has_draft else "empty",
        "published_at": None,
        "published_updated_utc": None,
        "published_contest_stage": None,
        "published_candidate_count": None,
        "published_quality_grade": None,
        "published_catalog_health": None,
        "draft_updated_at": datetime.now(timezone.utc).isoformat() if has_draft else None,
    }
    if has_draft:
        draft_data = gcs_helpers._gcs_get_race_json(race_id, "drafts")
        if isinstance(draft_data, dict):
            update.update(firestore_helpers._fs_build_draft_catalog_fields(race_id, draft_data))
    firestore_helpers._fs_update_race(race_id, update)
    # The blob is already gone, so an index failure must not skip the catalog
    # and cache updates above/below (mirrors publish).
    summaries_error = _update_summaries_index({race_id: None})
    _clear_public_race_cache(request)
    if summaries_error:
        raise HTTPException(
            status_code=502,
            detail={
                "message": f"Race {race_id} was unpublished but races/summaries.json was not updated; retry the unpublish",
                "unpublished": [race_id],
                "summaries_error": summaries_error,
            },
        )
    return {"message": f"Race {race_id} unpublished (draft retained)", "id": race_id}


@router.post("/api/races/publish", dependencies=[Depends(verify_token)])
def batch_publish_races(request: Request, payload: BatchPublishRequest) -> Dict[str, Any]:
    """Publish multiple races at once (draft -> published)."""
    published = []
    errors = []
    updates_for_gcs = {}
    for race_id in payload.race_ids:
        try:
            validate_race_id(race_id)
            assert_race_admitted(firestore_helpers._get_fs(), race_id, "publish")
            data = gcs_helpers._gcs_get_race_json(race_id, "drafts")
            if data is None:
                errors.append({"race_id": race_id, "error": "Draft not found"})
                continue
            _assert_publishable_race(data, race_id)
            draft_removed = gcs_helpers._publish_race_gcs(race_id, data) is not False
            updates_for_gcs[race_id] = data
            firestore_helpers._fs_update_race(race_id, _published_catalog_update(race_id, data, draft_removed))
            published.append(race_id)
        except HTTPException as exc:
            errors.append({"race_id": race_id, "error": exc.detail})
        except ValueError as exc:
            # Publish-gate rejections carry our own validation message.
            errors.append({"race_id": race_id, "error": str(exc)})
        except Exception:
            logging.exception("Batch publish failed for %s", race_id)
            errors.append({"race_id": race_id, "error": "Publish failed; see server logs"})
    result: Dict[str, Any] = {"published": published, "errors": errors}
    if published:
        summaries_error = _update_summaries_index(updates_for_gcs)
        _clear_public_race_cache(request)
        if summaries_error:
            result["summaries_error"] = summaries_error
    return result
