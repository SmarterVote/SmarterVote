"""Queue management endpoints.

All endpoints are Auth0-JWT protected via verify_token dependency.
Queue items are stored in Firestore `pipeline_queue` collection and picked up
by the Eventarc-triggered Cloud Function.
"""

import uuid
from typing import Any, Dict

import firestore_helpers
from auth import verify_token
from fastapi import APIRouter, Depends, HTTPException
from request_models import RaceQueueRequest, validate_race_id

router = APIRouter()

_PIPELINE_STEPS = ["discovery", "images", "issues", "finance", "refinement", "review", "iteration"]


@router.get("/steps", dependencies=[Depends(verify_token)])
async def list_steps() -> Dict[str, Any]:
    """Return the ordered list of available pipeline steps."""
    return {"steps": _PIPELINE_STEPS}


@router.get("/queue", dependencies=[Depends(verify_token)])
async def get_queue(active_only: bool = False, limit: int = 200) -> Dict[str, Any]:
    """List queue items from Firestore.

    When ``active_only=true``, only pending/running items are returned.
    """
    db = firestore_helpers._get_fs()
    docs = db.collection("pipeline_queue").order_by("created_at").stream()
    items = [firestore_helpers._doc_to_plain(d) for d in docs]
    items = [i for i in items if i is not None]
    if active_only:
        items = [i for i in items if i.get("status") in ("pending", "running")]
    if limit > 0:
        items = items[-limit:]
    running = sum(1 for i in items if i.get("status") == "running")
    pending = sum(1 for i in items if i.get("status") == "pending")
    return {"items": items, "running": running > 0, "pending": pending}


@router.post("/api/races/queue", dependencies=[Depends(verify_token)])
async def queue_races(request: RaceQueueRequest) -> Dict[str, Any]:
    """Queue races for pipeline processing via Firestore-triggered Cloud Function."""
    db = firestore_helpers._get_fs()
    options = request.options.model_dump(exclude_none=True) if request.options else {}
    added = []
    errors = []

    for raw_id in request.race_ids:
        race_id = raw_id.strip()
        if not race_id:
            continue
        try:
            validate_race_id(race_id)
        except HTTPException:
            errors.append({"race_id": race_id, "error": "Invalid race_id format"})
            continue
        try:
            from google.cloud.firestore_v1 import SERVER_TIMESTAMP  # type: ignore

            item_id = str(uuid.uuid4())
            run_id = str(uuid.uuid4())
            item = {
                "id": item_id,
                "race_id": race_id,
                "run_id": run_id,
                "options": options,
                "status": "pending",
                "is_continuation": False,
                "created_at": SERVER_TIMESTAMP,
            }
            db.collection("pipeline_queue").document(item_id).set(item)
            firestore_helpers._fs_update_race(race_id, {"status": "queued", "current_run_id": run_id})
            added.append({"id": item_id, "race_id": race_id, "run_id": run_id, "status": "pending"})
        except Exception as exc:
            errors.append({"race_id": race_id, "error": str(exc)})

    return {"added": added, "errors": errors}


@router.post("/queue", dependencies=[Depends(verify_token)])
async def add_to_queue(request: RaceQueueRequest) -> Dict[str, Any]:
    """Alias for /api/races/queue (legacy endpoint)."""
    return await queue_races(request)


@router.delete("/queue/finished", dependencies=[Depends(verify_token)])
async def clear_finished_queue() -> Dict[str, Any]:
    """Delete completed/failed/cancelled queue items."""
    db = firestore_helpers._get_fs()
    finished_statuses = {"completed", "failed", "cancelled"}
    removed = 0
    for doc in db.collection("pipeline_queue").stream():
        data = doc.to_dict() or {}
        if data.get("status") in finished_statuses:
            doc.reference.delete()
            removed += 1
    return {"removed": removed}


@router.delete("/queue/pending", dependencies=[Depends(verify_token)])
async def clear_pending_queue() -> Dict[str, Any]:
    """Cancel all pending (not yet started) queue items."""
    db = firestore_helpers._get_fs()
    removed = 0
    for doc in db.collection("pipeline_queue").stream():
        data = doc.to_dict() or {}
        if data.get("status") == "pending":
            doc.reference.update({"status": "cancelled"})
            removed += 1
            race_id = data.get("race_id")
            if race_id:
                firestore_helpers._fs_update_race(race_id, {"status": "idle"})
    return {"removed": removed}


@router.delete("/queue/{item_id}", dependencies=[Depends(verify_token)])
async def remove_queue_item(item_id: str, force: bool = False) -> Dict[str, Any]:
    """Cancel or remove a specific queue item.

    When ``force=true`` this endpoint always deletes the queue document, even
    if the item is currently running. This matches admin UI recovery behavior
    for stuck queue items.
    """
    db = firestore_helpers._get_fs()
    doc = db.collection("pipeline_queue").document(item_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Queue item not found")
    data = doc.to_dict() or {}
    status = data.get("status", "")
    race_id = data.get("race_id")

    if force:
        doc.reference.delete()
        if race_id:
            firestore_helpers._fs_update_race(race_id, {"status": "cancelled"})
        return {"ok": True, "action": "force_removed", "id": item_id}

    if status == "pending":
        doc.reference.update({"status": "cancelled"})
        if race_id:
            firestore_helpers._fs_update_race(race_id, {"status": "idle"})
        return {"ok": True, "action": "cancelled", "id": item_id}
    elif status in ("completed", "failed", "cancelled"):
        doc.reference.delete()
        return {"ok": True, "action": "removed", "id": item_id}
    else:
        # running — mark cancelled; CF will check at next step boundary
        doc.reference.update({"status": "cancelled"})
        if race_id:
            firestore_helpers._fs_update_race(race_id, {"status": "cancelled"})
        return {"ok": True, "action": "cancelled", "id": item_id}
