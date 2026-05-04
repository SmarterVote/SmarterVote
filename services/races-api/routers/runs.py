"""Run detail and log endpoints.

Runs are stored in Firestore `pipeline_runs` collection by the Cloud Function.
Logs are stored in the `pipeline_runs/{run_id}/logs` subcollection.
"""

from datetime import datetime
from typing import Any, Dict

import firestore_helpers
from auth import verify_token
from fastapi import APIRouter, Depends, HTTPException

router = APIRouter()


def _log_sort_key(entry: Dict[str, Any]) -> tuple[float, str]:
    """Return a stable ascending sort key for mixed legacy/new log schemas."""
    ts_val = entry.get("timestamp")
    if isinstance(ts_val, str):
        try:
            return (datetime.fromisoformat(ts_val.replace("Z", "+00:00")).timestamp(), "")
        except ValueError:
            pass

    legacy_ts = entry.get("ts")
    if isinstance(legacy_ts, (int, float)):
        return (float(legacy_ts), "")

    # Firestore doc IDs from FirestoreLogger are millisecond-prefix sortable.
    return (0.0, str(entry.get("id") or ""))


@router.get("/runs", dependencies=[Depends(verify_token)])
async def list_runs(limit: int = 50) -> Dict[str, Any]:
    """List recent pipeline runs from Firestore, newest first."""
    db = firestore_helpers._get_fs()
    docs = db.collection("pipeline_runs").order_by("started_at", direction="DESCENDING").limit(limit).stream()
    runs = [firestore_helpers._doc_to_plain(d) for d in docs]
    runs = [r for r in runs if r is not None]
    active = sum(1 for r in runs if r.get("status") in ("pending", "running"))
    return {"runs": runs, "active_count": active, "total_count": len(runs)}


@router.get("/runs/active", dependencies=[Depends(verify_token)])
async def list_active_runs() -> Dict[str, Any]:
    """List currently running or pending pipeline runs."""
    db = firestore_helpers._get_fs()
    docs = db.collection("pipeline_runs").where("status", "in", ["pending", "running"]).stream()
    runs = [firestore_helpers._doc_to_plain(d) for d in docs]
    runs = [r for r in runs if r is not None]
    return {"runs": runs, "count": len(runs)}


# Dual path: both /run/{id} (legacy) and /runs/{id} resolve to the same handler.
@router.get("/run/{run_id}", dependencies=[Depends(verify_token)])
@router.get("/runs/{run_id}", dependencies=[Depends(verify_token)])
async def get_run(run_id: str) -> Dict[str, Any]:
    """Get details of a specific run from Firestore."""
    db = firestore_helpers._get_fs()
    doc = db.collection("pipeline_runs").document(run_id).get()
    data = firestore_helpers._doc_to_plain(doc)
    if data is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return data


@router.get("/runs/{run_id}/logs", dependencies=[Depends(verify_token)])
async def get_run_logs(run_id: str, since: int = 0) -> Dict[str, Any]:
    """Return log entries for a run from the Firestore logs subcollection.

    Pass ``?since=N`` to return only entries after index N (incremental polling).
    Entries are sorted ascending by their timestamp sort key.
    """
    db = firestore_helpers._get_fs()
    logs_ref = db.collection("pipeline_runs").document(run_id).collection("logs")
    entries = [firestore_helpers._doc_to_plain(d) for d in logs_ref.stream()]
    entries = [e for e in entries if e is not None]
    entries.sort(key=_log_sort_key)
    sliced = entries[since:] if since < len(entries) else []
    return {"logs": sliced, "total": len(entries)}


@router.delete("/runs/{run_id}", dependencies=[Depends(verify_token)])
async def cancel_or_delete_run(run_id: str) -> Dict[str, Any]:
    """Cancel an active run or delete a finished one from Firestore."""
    db = firestore_helpers._get_fs()
    doc_ref = db.collection("pipeline_runs").document(run_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Run not found")
    data = doc.to_dict() or {}
    status = data.get("status", "")
    if status in ("pending", "running"):
        doc_ref.update({"status": "cancelled"})
        for queue_doc in db.collection("pipeline_queue").where("run_id", "==", run_id).stream():
            queue_data = queue_doc.to_dict() or {}
            if queue_data.get("status") in ("pending", "running"):
                queue_doc.reference.update({"status": "cancelled"})
        race_id = data.get("race_id")
        if race_id:
            firestore_helpers._fs_update_race(race_id, {"status": "cancelled"})
        return {"message": "Run cancelled", "run_id": run_id}
    else:
        doc_ref.delete()
    return {"message": "Run deleted", "run_id": run_id}
