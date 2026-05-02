"""
FastAPI service for accessing published race data.

This service exposes endpoints for listing available races and retrieving
individual race data stored as JSON files.
"""

import json
import logging
import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")

import httpx
import schemas
from analytics_middleware import AnalyticsMiddleware
from analytics_store import AnalyticsStore
from config import DATA_DIR
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from simple_publish_service import SimplePublishService
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Initialize simple publish service
publish_service = SimplePublishService(data_directory=DATA_DIR)

# Rate limiter (keyed by client IP)
limiter = Limiter(key_func=get_remote_address)

_ADMIN_API_KEY = os.getenv("ADMIN_API_KEY")
_RACE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,99}$")


def _require_admin_key(x_admin_key: str = Header(default="")) -> None:
    """Dependency: reject requests missing a valid X-Admin-Key header."""
    if not _ADMIN_API_KEY:
        raise HTTPException(status_code=503, detail="Admin API key not configured")
    if not secrets.compare_digest(x_admin_key, _ADMIN_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")


def _validate_race_id(race_id: str) -> None:
    """Reject race IDs that don't match the canonical format."""
    if not _RACE_ID_RE.match(race_id):
        raise HTTPException(status_code=400, detail="Invalid race_id format")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.analytics = AnalyticsStore()
    yield


# Initialize FastAPI app
app = FastAPI(title="SmarterVote Races API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Analytics middleware — runs before CORS, records every tracked request
app.add_middleware(AnalyticsMiddleware)

# Enable CORS — public read API + authenticated admin writes
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*", "X-Admin-Key", "Authorization"],
)


# ---------------------------------------------------------------------------
# Health endpoints
# ---------------------------------------------------------------------------


@app.get("/health", include_in_schema=False)
def health():
    """Liveness probe — always returns OK if the process is up."""
    return {"status": "ok"}


@app.get("/health/ready", include_in_schema=False)
def readiness():
    """Readiness probe — checks that the publish service can serve data."""
    races = publish_service.get_published_races()
    return {"ready": True, "race_count": len(races)}


@app.get("/races", response_model=List[str])
@limiter.limit("60/minute")
def list_races(request: Request, response: Response) -> List[str]:
    """List available race IDs."""
    response.headers["Cache-Control"] = "public, max-age=300"
    return publish_service.get_published_races()


@app.get("/races/summaries", response_model=List[schemas.RaceSummary])
@limiter.limit("30/minute")
def get_race_summaries(request: Request, response: Response) -> List[schemas.RaceSummary]:
    """Get summaries of all races for search and listing."""
    response.headers["Cache-Control"] = "public, max-age=300"
    return publish_service.get_race_summaries()


@app.get("/races/{race_id}")
@limiter.limit("60/minute")
def get_race(request: Request, response: Response, race_id: str):
    """Retrieve race data by ID."""
    _validate_race_id(race_id)
    race_data = publish_service.get_race_data(race_id)
    if not race_data:
        raise HTTPException(status_code=404, detail="Race not found")
    response.headers["Cache-Control"] = "public, max-age=300"
    return race_data


# ---------------------------------------------------------------------------
# Analytics endpoints (admin-key protected)
# ---------------------------------------------------------------------------


@app.post("/cache/clear")
@limiter.limit("10/minute")
def clear_cache(request: Request, x_admin_key: str = Header(default="")):
    """Clear the in-memory GCS response cache so the next request re-fetches fresh data.

    Call this after pushing new race data to GCS so the API reflects the update
    without waiting for the TTL to expire.
    """
    _require_admin_key(x_admin_key)
    publish_service.clear_cache()
    return {"message": "Cache cleared", "cache_ttl_seconds": publish_service.cache_ttl}


@app.get("/analytics/overview")
@limiter.limit("20/minute")
async def analytics_overview(
    request: Request,
    hours: int = Query(default=24, ge=1, le=720),
    x_admin_key: str = Header(default=""),
):
    """Summary stats: total requests, unique visitors, avg latency, error rate, timeseries."""
    _require_admin_key(x_admin_key)
    return await request.app.state.analytics.get_overview(hours=hours)


@app.get("/analytics/races")
@limiter.limit("20/minute")
async def analytics_races(
    request: Request,
    hours: int = Query(default=24, ge=1, le=720),
    x_admin_key: str = Header(default=""),
):
    """Per-race request counts for the last *hours* hours."""
    _require_admin_key(x_admin_key)
    stats = await request.app.state.analytics.get_race_stats(hours=hours)
    # Batch-load summaries once to avoid N+1 per-race lookups
    summaries = publish_service.get_race_summaries()
    summary_by_id = {s["id"]: s for s in summaries}
    for item in stats:
        summary = summary_by_id.get(item["race_id"])
        item["updated_utc"] = summary.get("updated_utc") if summary else None
        item["title"] = summary.get("title") if summary else None
    return {"races": stats, "hours": hours}


@app.get("/analytics/timeseries")
@limiter.limit("20/minute")
async def analytics_timeseries(
    request: Request,
    hours: int = Query(default=24, ge=1, le=720),
    bucket: int = Query(default=60, ge=5, le=360),
    x_admin_key: str = Header(default=""),
):
    """Bucketed request counts for charting. *bucket* is the bucket size in minutes."""
    _require_admin_key(x_admin_key)
    return {
        "timeseries": await request.app.state.analytics.get_timeseries(hours=hours, bucket_minutes=bucket),
        "hours": hours,
        "bucket_minutes": bucket,
    }


# ============================================================================
# Admin endpoints — Auth0 JWT protected
# Replaces the retired pipeline-client Cloud Run service.
# All operations are stateless: read/write Firestore + GCS directly.
# ============================================================================

# ---------------------------------------------------------------------------
# Auth0 JWT verification
# ---------------------------------------------------------------------------

_AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "")
_AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")
_SKIP_AUTH = os.getenv("SKIP_AUTH", "").lower() in ("1", "true", "yes")

_http_bearer = HTTPBearer(auto_error=False)


async def _decode_jwt(token: str) -> dict:
    jwks_url = f"https://{_AUTH0_DOMAIN}/.well-known/jwks.json"
    async with httpx.AsyncClient(timeout=10) as client:
        jwks = (await client.get(jwks_url)).json()
    unverified = jwt.get_unverified_header(token)
    rsa_key = next((k for k in jwks["keys"] if k.get("kid") == unverified.get("kid")), None)
    if not rsa_key:
        raise HTTPException(status_code=401, detail="Invalid token: signing key not found")
    return jwt.decode(
        token,
        rsa_key,
        algorithms=[unverified.get("alg", "RS256")],
        audience=_AUTH0_AUDIENCE,
        issuer=f"https://{_AUTH0_DOMAIN}/",
    )


async def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_http_bearer),
) -> dict:
    """Dependency: verify Auth0 JWT bearer token."""
    if _SKIP_AUTH:
        return {}
    if not _AUTH0_DOMAIN or not _AUTH0_AUDIENCE:
        raise HTTPException(
            status_code=503,
            detail="Auth not configured (AUTH0_DOMAIN/AUTH0_AUDIENCE missing). Set SKIP_AUTH=true for local dev.",
        )
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return await _decode_jwt(credentials.credentials)
    except (JWTError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication") from exc


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------

_FIRESTORE_PROJECT = os.getenv("FIRESTORE_PROJECT") or os.getenv("PROJECT_ID")
_fs_db = None


def _get_fs() -> Any:
    """Return a lazily-initialized Firestore client, or raise 503 if unavailable."""
    global _fs_db
    if _fs_db is not None:
        return _fs_db
    try:
        from google.cloud import firestore  # type: ignore

        _fs_db = firestore.Client(project=_FIRESTORE_PROJECT) if _FIRESTORE_PROJECT else firestore.Client()
        return _fs_db
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Firestore unavailable: {exc}") from exc


def _fs_doc_to_dict(doc: Any) -> Optional[Dict[str, Any]]:
    """Convert a Firestore DocumentSnapshot to a plain dict, or None if missing."""
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    # Convert Timestamps to ISO strings for JSON serialisation
    for k, v in list(data.items()):
        try:
            from google.api_core.datetime_helpers import DatetimeWithNanoseconds  # type: ignore
            from google.cloud.firestore_v1.base_document import DocumentSnapshot  # noqa

            if hasattr(v, "isoformat"):
                data[k] = v.isoformat()
        except Exception:
            pass
    return data


def _ts_to_str(v: Any) -> Any:
    """Convert Firestore/datetime timestamps to ISO strings recursively."""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _doc_to_plain(doc: Any) -> Optional[Dict[str, Any]]:
    """Robustly convert a Firestore DocumentSnapshot to a JSON-serialisable dict."""
    if not doc.exists:
        return None
    raw = doc.to_dict() or {}
    return {k: _ts_to_str(v) for k, v in raw.items()}


# ---------------------------------------------------------------------------
# GCS helpers
# ---------------------------------------------------------------------------

_GCS_BUCKET = os.getenv("GCS_BUCKET", "")
_gcs_admin_client = None


def _get_gcs_admin() -> Any:
    """Return a lazily-initialized GCS client for admin operations."""
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
    """List race IDs (stems of .json blobs) under the given GCS prefix."""
    if not _GCS_BUCKET:
        return None
    client = _get_gcs_admin()
    if client is None:
        return None
    try:
        bucket = client.bucket(_GCS_BUCKET)
        blobs = list(bucket.list_blobs(prefix=f"{prefix}/"))
        ids = []
        for b in blobs:
            fname = b.name.split("/")[-1]
            if fname.endswith(".json"):
                ids.append(fname[:-5])
        return ids
    except Exception as exc:
        logging.warning("GCS list %s failed: %s", prefix, exc)
        return None


def _gcs_get_race_json(race_id: str, prefix: str) -> Optional[Dict[str, Any]]:
    """Fetch and parse a race JSON blob from GCS."""
    if not _GCS_BUCKET:
        return None
    client = _get_gcs_admin()
    if client is None:
        return None
    try:
        bucket = client.bucket(_GCS_BUCKET)
        blob = bucket.blob(f"{prefix}/{race_id}.json")
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())
    except Exception as exc:
        logging.warning("GCS get %s/%s failed: %s", prefix, race_id, exc)
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
        blob = bucket.blob(f"{prefix}/{race_id}.json")
        blob.upload_from_string(json.dumps(data, indent=2), content_type="application/json")
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
    """Copy current blob from src_prefix to retired/{race_id}/<ts>-{source_label}.json."""
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
        dst_name = f"retired/{race_id}/{ts}-{source_label}.json"
        bucket.copy_blob(src_blob, bucket, dst_name)
        return True
    except Exception as exc:
        logging.warning("GCS archive %s/%s failed: %s", src_prefix, race_id, exc)
        return False


def _gcs_list_versions(race_id: str) -> List[Dict[str, Any]]:
    """List retired versions for a race from GCS."""
    if not _GCS_BUCKET:
        return []
    client = _get_gcs_admin()
    if client is None:
        return []
    versions = []
    try:
        bucket = client.bucket(_GCS_BUCKET)
        for blob in bucket.list_blobs(prefix=f"retired/{race_id}/"):
            fname = blob.name.split("/")[-1]
            if not fname.endswith(".json"):
                continue
            stem = fname[:-5]
            parts = stem.rsplit("-", 1)
            source = parts[-1] if len(parts) == 2 else "unknown"
            ts_raw = parts[0] if len(parts) == 2 else stem
            try:
                ts = datetime.strptime(ts_raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                ts = None
            versions.append({"filename": fname, "source": source, "archived_at": ts, "size_bytes": blob.size})
    except Exception as exc:
        logging.warning("GCS list versions %s failed: %s", race_id, exc)
    return versions


# ---------------------------------------------------------------------------
# Firestore race record helpers
# ---------------------------------------------------------------------------


def _fs_update_race(race_id: str, fields: Dict[str, Any]) -> None:
    """Merge fields into the races/{race_id} Firestore document (best-effort)."""
    try:
        from google.cloud.firestore_v1 import SERVER_TIMESTAMP  # type: ignore

        fields.setdefault("updated_at", SERVER_TIMESTAMP)
        _get_fs().collection("races").document(race_id).set(fields, merge=True)
    except Exception as exc:
        logging.warning("Firestore race update %s failed: %s", race_id, exc)


def _publish_race_gcs(race_id: str, data: Dict[str, Any]) -> None:
    """
    Archive existing draft/published blobs, write new published blob,
    delete draft blob, and update the Firestore race record.
    """
    _gcs_archive_race(race_id, "races", "published")
    _gcs_archive_race(race_id, "drafts", "draft")
    _gcs_put_race_json(race_id, "races", data)
    _gcs_delete_race_json(race_id, "drafts")
    _fs_update_race(
        race_id,
        {
            "status": "published",
            "published_at": datetime.now(timezone.utc).isoformat(),
        },
    )


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class RunOptions(BaseModel):
    cheap_mode: Optional[bool] = None
    force_fresh: Optional[bool] = None
    enabled_steps: Optional[List[str]] = None
    research_model: Optional[str] = None
    claude_model: Optional[str] = None
    max_candidates: Optional[int] = None
    candidate_names: Optional[List[str]] = None
    target_no_info: Optional[bool] = None
    note: Optional[str] = None
    goal: Optional[str] = None


class RaceQueueRequest(BaseModel):
    race_ids: List[str]
    options: Optional[RunOptions] = None


class BatchPublishRequest(BaseModel):
    race_ids: List[str]


class AdminChatMessage(BaseModel):
    role: str
    content: str


class AdminChatRequest(BaseModel):
    messages: List[AdminChatMessage]
    race_context: Optional[List[Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

_PIPELINE_STEPS = ["discovery", "images", "issues", "finance", "refinement", "review", "iteration"]


@app.get("/steps", dependencies=[Depends(verify_token)])
async def list_steps() -> Dict[str, Any]:
    """Return the list of available pipeline steps."""
    return {"steps": _PIPELINE_STEPS}


# ---------------------------------------------------------------------------
# Queue endpoints
# ---------------------------------------------------------------------------


@app.get("/queue", dependencies=[Depends(verify_token)])
async def get_queue() -> Dict[str, Any]:
    """List all pipeline queue items."""
    db = _get_fs()
    docs = db.collection("pipeline_queue").order_by("created_at").stream()
    items = [_doc_to_plain(d) for d in docs]
    items = [i for i in items if i is not None]
    running = sum(1 for i in items if i.get("status") == "running")
    pending = sum(1 for i in items if i.get("status") == "pending")
    return {"items": items, "running": running > 0, "pending": pending}


@app.post("/api/races/queue", dependencies=[Depends(verify_token)])
async def queue_races_admin(request: RaceQueueRequest) -> Dict[str, Any]:
    """Queue races for pipeline processing via Firestore-triggered Cloud Function."""
    db = _get_fs()
    options = request.options.model_dump(exclude_none=True) if request.options else {}
    added = []
    errors = []

    for raw_id in request.race_ids:
        race_id = raw_id.strip()
        if not race_id:
            continue
        try:
            _validate_race_id(race_id)
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
            # Mark race as queued in Firestore
            _fs_update_race(race_id, {"status": "queued", "current_run_id": run_id})
            added.append({"id": item_id, "race_id": race_id, "run_id": run_id, "status": "pending"})
        except Exception as exc:
            errors.append({"race_id": race_id, "error": str(exc)})

    return {"added": added, "errors": errors}


@app.post("/queue", dependencies=[Depends(verify_token)])
async def add_to_queue(request: RaceQueueRequest) -> Dict[str, Any]:
    """Alias for /api/races/queue (legacy endpoint)."""
    return await queue_races_admin(request)


@app.delete("/queue/finished", dependencies=[Depends(verify_token)])
async def clear_finished_queue() -> Dict[str, Any]:
    """Delete completed/failed/cancelled queue items."""
    db = _get_fs()
    finished_statuses = {"completed", "failed", "cancelled"}
    removed = 0
    for doc in db.collection("pipeline_queue").stream():
        data = doc.to_dict() or {}
        if data.get("status") in finished_statuses:
            doc.reference.delete()
            removed += 1
    return {"removed": removed}


@app.delete("/queue/pending", dependencies=[Depends(verify_token)])
async def clear_pending_queue() -> Dict[str, Any]:
    """Cancel all pending (not yet started) queue items."""
    db = _get_fs()
    removed = 0
    for doc in db.collection("pipeline_queue").stream():
        data = doc.to_dict() or {}
        if data.get("status") == "pending":
            doc.reference.update({"status": "cancelled"})
            removed += 1
            # Reset race status if it was queued due to this item
            race_id = data.get("race_id")
            if race_id:
                _fs_update_race(race_id, {"status": "idle"})
    return {"removed": removed}


@app.delete("/queue/{item_id}", dependencies=[Depends(verify_token)])
async def remove_queue_item(item_id: str) -> Dict[str, Any]:
    """Cancel or remove a specific queue item."""
    db = _get_fs()
    doc = db.collection("pipeline_queue").document(item_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Queue item not found")
    data = doc.to_dict() or {}
    status = data.get("status", "")
    if status == "pending":
        doc.reference.update({"status": "cancelled"})
        race_id = data.get("race_id")
        if race_id:
            _fs_update_race(race_id, {"status": "idle"})
        return {"ok": True, "action": "cancelled", "id": item_id}
    elif status in ("completed", "failed", "cancelled"):
        doc.reference.delete()
        return {"ok": True, "action": "removed", "id": item_id}
    else:
        # running — mark cancelled; CF will check at next step boundary
        doc.reference.update({"status": "cancelled"})
        race_id = data.get("race_id")
        if race_id:
            _fs_update_race(race_id, {"status": "cancelled"})
        return {"ok": True, "action": "cancelled", "id": item_id}


# ---------------------------------------------------------------------------
# Run endpoints
# ---------------------------------------------------------------------------


@app.get("/runs", dependencies=[Depends(verify_token)])
async def list_runs(limit: int = 50) -> Dict[str, Any]:
    """List recent pipeline runs from Firestore."""
    db = _get_fs()
    docs = db.collection("pipeline_runs").order_by("started_at", direction="DESCENDING").limit(limit).stream()
    runs = [_doc_to_plain(d) for d in docs]
    runs = [r for r in runs if r is not None]
    active = sum(1 for r in runs if r.get("status") in ("pending", "running"))
    return {"runs": runs, "active_count": active, "total_count": len(runs)}


@app.get("/runs/active", dependencies=[Depends(verify_token)])
async def list_active_runs() -> Dict[str, Any]:
    """List currently running pipeline runs."""
    db = _get_fs()
    docs = db.collection("pipeline_runs").where("status", "in", ["pending", "running"]).stream()
    runs = [_doc_to_plain(d) for d in docs]
    runs = [r for r in runs if r is not None]
    return {"runs": runs, "count": len(runs)}


@app.get("/run/{run_id}", dependencies=[Depends(verify_token)])
@app.get("/runs/{run_id}", dependencies=[Depends(verify_token)])
async def get_run(run_id: str) -> Dict[str, Any]:
    """Get details of a specific run."""
    db = _get_fs()
    doc = db.collection("pipeline_runs").document(run_id).get()
    data = _doc_to_plain(doc)
    if data is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return data


@app.get("/runs/{run_id}/logs", dependencies=[Depends(verify_token)])
async def get_run_logs(run_id: str, since: int = 0) -> Dict[str, Any]:
    """Return log entries for a run from the Firestore logs subcollection.

    Pass ?since=N to only return entries after index N (for incremental polling).
    """
    db = _get_fs()
    logs_ref = db.collection("pipeline_runs").document(run_id).collection("logs").order_by("ts", direction="ASCENDING")
    entries = [_doc_to_plain(d) for d in logs_ref.stream()]
    entries = [e for e in entries if e is not None]
    sliced = entries[since:] if since < len(entries) else []
    return {"logs": sliced, "total": len(entries)}


@app.delete("/runs/{run_id}", dependencies=[Depends(verify_token)])
async def cancel_or_delete_run(run_id: str) -> Dict[str, Any]:
    """Cancel an active run or delete a finished one from Firestore."""
    db = _get_fs()
    doc_ref = db.collection("pipeline_runs").document(run_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Run not found")
    data = doc.to_dict() or {}
    status = data.get("status", "")
    if status in ("pending", "running"):
        doc_ref.update({"status": "cancelled"})
        race_id = data.get("race_id")
        if race_id:
            _fs_update_race(race_id, {"status": "cancelled"})
    else:
        doc_ref.delete()
    return {"message": "Run deleted", "run_id": run_id}


# ---------------------------------------------------------------------------
# Race record endpoints
# ---------------------------------------------------------------------------


@app.get("/api/races", dependencies=[Depends(verify_token)])
async def list_all_races() -> Dict[str, Any]:
    """List all race records from Firestore (admin view with status metadata)."""
    db = _get_fs()
    docs = db.collection("races").limit(500).stream()
    races = [_doc_to_plain(d) for d in docs]
    races = [r for r in races if r is not None]
    return {"races": races}


@app.get("/api/races/{race_id}", dependencies=[Depends(verify_token)])
async def get_race_record(race_id: str) -> Dict[str, Any]:
    """Get a single race record from Firestore."""
    _validate_race_id(race_id)
    db = _get_fs()
    doc = db.collection("races").document(race_id).get()
    data = _doc_to_plain(doc)
    if data is None:
        raise HTTPException(status_code=404, detail="Race not found")
    return data


@app.delete("/api/races/{race_id}", dependencies=[Depends(verify_token)])
async def delete_race_record(race_id: str) -> Dict[str, Any]:
    """Delete a race record and all associated GCS blobs."""
    _validate_race_id(race_id)
    _gcs_delete_race_json(race_id, "races")
    _gcs_delete_race_json(race_id, "drafts")
    try:
        _get_fs().collection("races").document(race_id).delete()
    except Exception as exc:
        logging.warning("Firestore delete race %s failed: %s", race_id, exc)
    return {"message": f"Race {race_id} deleted", "id": race_id}


@app.post("/api/races/{race_id}/cancel", dependencies=[Depends(verify_token)])
async def cancel_race(race_id: str) -> Dict[str, Any]:
    """Cancel a queued or running race by updating Firestore state."""
    _validate_race_id(race_id)
    db = _get_fs()
    race_doc = db.collection("races").document(race_id).get()
    if not race_doc.exists:
        raise HTTPException(status_code=404, detail="Race not found")
    race_data = race_doc.to_dict() or {}
    if race_data.get("status") not in ("queued", "running"):
        raise HTTPException(status_code=400, detail="Race is not queued or running")
    # Cancel queue items for this race
    for doc in db.collection("pipeline_queue").where("race_id", "==", race_id).stream():
        d = doc.to_dict() or {}
        if d.get("status") in ("pending", "running"):
            doc.reference.update({"status": "cancelled"})
    # Cancel active runs
    run_id = race_data.get("current_run_id")
    if run_id:
        run_ref = db.collection("pipeline_runs").document(run_id)
        run_doc = run_ref.get()
        if run_doc.exists and (run_doc.to_dict() or {}).get("status") in ("pending", "running"):
            run_ref.update({"status": "cancelled"})
    _fs_update_race(race_id, {"status": "cancelled"})
    return {"message": f"Race {race_id} cancelled"}


@app.post("/api/races/{race_id}/recheck", dependencies=[Depends(verify_token)])
async def recheck_race_status(race_id: str) -> Dict[str, Any]:
    """Re-derive race status from GCS storage state (fixes stuck 'running' records)."""
    _validate_race_id(race_id)
    db = _get_fs()
    race_doc = db.collection("races").document(race_id).get()
    if not race_doc.exists:
        raise HTTPException(status_code=404, detail="Race not found")
    race_data = race_doc.to_dict() or {}

    # If currently showing running/queued, check if the run is still active
    current_status = race_data.get("status", "idle")
    if current_status in ("running", "queued"):
        run_id = race_data.get("current_run_id")
        run_actually_active = False
        if run_id:
            run_doc = db.collection("pipeline_runs").document(run_id).get()
            if run_doc.exists:
                run_status = (run_doc.to_dict() or {}).get("status", "")
                run_actually_active = run_status in ("pending", "running")
        if not run_actually_active:
            # Derive status from GCS files
            has_published = _gcs_get_race_json(race_id, "races") is not None
            has_draft = _gcs_get_race_json(race_id, "drafts") is not None
            new_status = "published" if has_published else ("draft" if has_draft else "idle")
            _fs_update_race(race_id, {"status": new_status})
            current_status = new_status

    updated_doc = db.collection("races").document(race_id).get()
    return {"message": f"Race {race_id} rechecked", "race": _doc_to_plain(updated_doc)}


@app.post("/api/races/{race_id}/run", dependencies=[Depends(verify_token)])
async def run_race_pipeline(race_id: str, options: Optional[RunOptions] = None) -> Dict[str, Any]:
    """Trigger the pipeline for a race by writing to the Firestore queue."""
    _validate_race_id(race_id)
    opts = options.model_dump(exclude_none=True) if options else {}
    from google.cloud.firestore_v1 import SERVER_TIMESTAMP  # type: ignore

    item_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    item = {
        "id": item_id,
        "race_id": race_id,
        "run_id": run_id,
        "options": opts,
        "status": "pending",
        "is_continuation": False,
        "created_at": SERVER_TIMESTAMP,
    }
    _get_fs().collection("pipeline_queue").document(item_id).set(item)
    _fs_update_race(race_id, {"status": "queued", "current_run_id": run_id})
    return {"run_id": run_id, "status": "queued", "race_id": race_id}


# ---------------------------------------------------------------------------
# Draft / publish endpoints
# ---------------------------------------------------------------------------


@app.get("/drafts", dependencies=[Depends(verify_token)])
async def list_draft_races() -> Dict[str, Any]:
    """List all draft race IDs from GCS."""
    ids = _gcs_list_race_ids("drafts")
    if ids is None:
        ids = []
    return {"races": ids}


@app.get("/drafts/{race_id}", dependencies=[Depends(verify_token)])
async def get_draft_race(race_id: str) -> Dict[str, Any]:
    """Get full draft race JSON."""
    _validate_race_id(race_id)
    data = _gcs_get_race_json(race_id, "drafts")
    if data is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return data


@app.post("/drafts/{race_id}/publish", dependencies=[Depends(verify_token)])
async def publish_draft(race_id: str) -> Dict[str, Any]:
    """Promote a draft to published."""
    _validate_race_id(race_id)
    data = _gcs_get_race_json(race_id, "drafts")
    if data is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    _publish_race_gcs(race_id, data)
    return {"message": f"Race {race_id} published", "id": race_id}


@app.delete("/drafts/{race_id}", dependencies=[Depends(verify_token)])
async def delete_draft_race(race_id: str) -> Dict[str, Any]:
    """Delete a draft race from GCS and update Firestore record."""
    _validate_race_id(race_id)
    deleted = _gcs_delete_race_json(race_id, "drafts")
    if not deleted:
        raise HTTPException(status_code=404, detail="Draft not found")
    _fs_update_race(race_id, {"status": "idle", "draft_updated_at": None})
    return {"message": f"Draft {race_id} deleted", "id": race_id}


@app.delete("/races/{race_id}/admin", dependencies=[Depends(verify_token)])
async def delete_published_race_admin(race_id: str) -> Dict[str, Any]:
    """Delete a published race from GCS (admin — keeps draft)."""
    _validate_race_id(race_id)
    deleted = _gcs_delete_race_json(race_id, "races")
    if not deleted:
        raise HTTPException(status_code=404, detail="Published race not found")
    _fs_update_race(race_id, {"status": "draft", "published_at": None})
    return {"message": f"Race {race_id} unpublished", "id": race_id}


@app.post("/api/races/{race_id}/publish", dependencies=[Depends(verify_token)])
async def publish_race(race_id: str) -> Dict[str, Any]:
    """Publish a race (copy draft -> published in GCS)."""
    _validate_race_id(race_id)
    data = _gcs_get_race_json(race_id, "drafts")
    if data is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    _publish_race_gcs(race_id, data)
    return {"message": f"Race {race_id} published", "id": race_id}


@app.post("/api/races/{race_id}/unpublish", dependencies=[Depends(verify_token)])
async def unpublish_race(race_id: str) -> Dict[str, Any]:
    """Remove a race from published (keeps draft)."""
    _validate_race_id(race_id)
    deleted = _gcs_delete_race_json(race_id, "races")
    if not deleted:
        raise HTTPException(status_code=404, detail="Published race not found")
    _fs_update_race(race_id, {"status": "draft", "published_at": None})
    return {"message": f"Race {race_id} unpublished (draft retained)", "id": race_id}


@app.post("/api/races/publish", dependencies=[Depends(verify_token)])
async def batch_publish_races(request: BatchPublishRequest) -> Dict[str, Any]:
    """Publish multiple races at once (draft -> published)."""
    published = []
    errors = []
    for race_id in request.race_ids:
        try:
            _validate_race_id(race_id)
            data = _gcs_get_race_json(race_id, "drafts")
            if data is None:
                errors.append({"race_id": race_id, "error": "Draft not found"})
                continue
            _publish_race_gcs(race_id, data)
            published.append(race_id)
        except HTTPException as exc:
            errors.append({"race_id": race_id, "error": exc.detail})
        except Exception as exc:
            errors.append({"race_id": race_id, "error": str(exc)})
    return {"published": published, "errors": errors}


# ---------------------------------------------------------------------------
# Race run history endpoints
# ---------------------------------------------------------------------------


@app.get("/api/races/{race_id}/runs", dependencies=[Depends(verify_token)])
async def list_race_runs(race_id: str, limit: int = 20) -> Dict[str, Any]:
    """List runs for a specific race from Firestore."""
    _validate_race_id(race_id)
    db = _get_fs()
    # Primary: subcollection races/{race_id}/runs
    sub_docs = (
        db.collection("races")
        .document(race_id)
        .collection("runs")
        .order_by("started_at", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    runs = [_doc_to_plain(d) for d in sub_docs]
    # Also check pipeline_runs collection for active runs for this race
    active_docs = db.collection("pipeline_runs").where("race_id", "==", race_id).stream()
    active_ids = set()
    for d in active_docs:
        data = _doc_to_plain(d)
        if data and data.get("status") in ("pending", "running"):
            runs.insert(0, data)
            active_ids.add(d.id)
    runs = [r for r in runs if r is not None]
    return {"runs": runs[:limit], "count": len(runs[:limit])}


@app.get("/api/races/{race_id}/runs/{run_id}", dependencies=[Depends(verify_token)])
async def get_race_run(race_id: str, run_id: str) -> Dict[str, Any]:
    """Get details of a specific run for a race."""
    _validate_race_id(race_id)
    db = _get_fs()
    # Check pipeline_runs first (active runs)
    doc = db.collection("pipeline_runs").document(run_id).get()
    data = _doc_to_plain(doc)
    if data:
        return data
    # Then check subcollection
    doc = db.collection("races").document(race_id).collection("runs").document(run_id).get()
    data = _doc_to_plain(doc)
    if data is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return data


@app.delete("/api/races/{race_id}/runs/{run_id}", dependencies=[Depends(verify_token)])
async def delete_race_run(race_id: str, run_id: str) -> Dict[str, Any]:
    """Cancel or delete a run for a race."""
    _validate_race_id(race_id)
    db = _get_fs()
    run_ref = db.collection("pipeline_runs").document(run_id)
    run_doc = run_ref.get()
    if run_doc.exists:
        status = (run_doc.to_dict() or {}).get("status", "")
        if status in ("pending", "running"):
            run_ref.update({"status": "cancelled"})
            race_doc = db.collection("races").document(race_id).get()
            if race_doc.exists and (race_doc.to_dict() or {}).get("status") in ("running", "queued"):
                _fs_update_race(race_id, {"status": "cancelled"})
        else:
            run_ref.delete()
        return {"message": "Run deleted", "run_id": run_id}
    # Try subcollection
    sub_ref = db.collection("races").document(race_id).collection("runs").document(run_id)
    if sub_ref.get().exists:
        sub_ref.delete()
        return {"message": "Run deleted", "run_id": run_id}
    raise HTTPException(status_code=404, detail="Run not found")


# ---------------------------------------------------------------------------
# Race data endpoints
# ---------------------------------------------------------------------------


@app.get("/api/races/{race_id}/data", dependencies=[Depends(verify_token)])
async def get_race_data(race_id: str, draft: bool = False) -> Dict[str, Any]:
    """Get full race JSON (published or draft)."""
    _validate_race_id(race_id)
    prefix = "drafts" if draft else "races"
    label = "Draft" if draft else "Race"
    data = _gcs_get_race_json(race_id, prefix)
    if data is None:
        raise HTTPException(status_code=404, detail=f"{label} data not found")
    return data


# ---------------------------------------------------------------------------
# Version / restore endpoints
# ---------------------------------------------------------------------------


@app.get("/api/races/{race_id}/versions", dependencies=[Depends(verify_token)])
async def list_race_versions(race_id: str) -> Dict[str, Any]:
    """List retired (archived) versions for a race, newest first."""
    _validate_race_id(race_id)
    versions = _gcs_list_versions(race_id)
    versions.sort(key=lambda v: v.get("archived_at") or "", reverse=True)
    return {"versions": versions, "count": len(versions)}


@app.get("/api/races/{race_id}/versions/{filename}", dependencies=[Depends(verify_token)])
async def get_race_version(race_id: str, filename: str) -> Dict[str, Any]:
    """Return JSON content of a specific retired version."""
    _validate_race_id(race_id)
    if "/" in filename or "\\" in filename or not filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Invalid version filename")
    if not _GCS_BUCKET:
        raise HTTPException(status_code=503, detail="GCS not configured")
    client = _get_gcs_admin()
    if client is None:
        raise HTTPException(status_code=503, detail="GCS unavailable")
    try:
        bucket = client.bucket(_GCS_BUCKET)
        blob = bucket.blob(f"retired/{race_id}/{filename}")
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Version not found")
        return json.loads(blob.download_as_text())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"GCS error: {exc}") from exc


@app.post("/api/races/{race_id}/versions/{filename}/restore", dependencies=[Depends(verify_token)])
async def restore_version_as_draft(race_id: str, filename: str) -> Dict[str, Any]:
    """Restore a retired version as the active draft."""
    _validate_race_id(race_id)
    if "/" in filename or "\\" in filename or not filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Invalid version filename")
    if not _GCS_BUCKET:
        raise HTTPException(status_code=503, detail="GCS not configured")
    client = _get_gcs_admin()
    if client is None:
        raise HTTPException(status_code=503, detail="GCS unavailable")
    try:
        bucket = client.bucket(_GCS_BUCKET)
        src_blob = bucket.blob(f"retired/{race_id}/{filename}")
        if not src_blob.exists():
            raise HTTPException(status_code=404, detail="Retired version not found")
        version_data = json.loads(src_blob.download_as_text())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"GCS read error: {exc}") from exc

    # Archive current draft if it exists
    _gcs_archive_race(race_id, "drafts", "draft")
    # Write restored version as new draft
    _gcs_put_race_json(race_id, "drafts", version_data)
    _fs_update_race(race_id, {"status": "draft", "draft_updated_at": datetime.now(timezone.utc).isoformat()})
    return {"message": f"Retired version restored as draft for {race_id}", "id": race_id, "restored_from": filename}


# ---------------------------------------------------------------------------
# Pipeline metrics (token usage / cost)
# ---------------------------------------------------------------------------


@app.get("/pipeline/metrics", dependencies=[Depends(verify_token)])
async def get_pipeline_metrics(limit: int = 50) -> Dict[str, Any]:
    """Return recent pipeline run records with token usage and cost data."""
    db = _get_fs()
    docs = db.collection("pipeline_runs").order_by("started_at", direction="DESCENDING").limit(limit).stream()
    records = [_doc_to_plain(d) for d in docs]
    records = [r for r in records if r is not None]
    return {"records": records, "count": len(records)}


@app.get("/pipeline/metrics/summary", dependencies=[Depends(verify_token)])
async def get_pipeline_metrics_summary() -> Dict[str, Any]:
    """Return aggregate pipeline cost stats."""
    db = _get_fs()
    docs = db.collection("pipeline_runs").stream()
    total_runs = 0
    total_usd = 0.0
    recent_usd = 0.0
    cutoff = datetime.now(timezone.utc).timestamp() - 30 * 86400
    for doc in docs:
        d = doc.to_dict() or {}
        total_runs += 1
        cost = d.get("cost_usd") or 0.0
        total_usd += cost
        started = d.get("started_at")
        ts = started.timestamp() if hasattr(started, "timestamp") else 0
        if ts > cutoff:
            recent_usd += cost
    avg_usd = total_usd / total_runs if total_runs > 0 else 0.0
    return {
        "total_runs": total_runs,
        "total_usd": round(total_usd, 4),
        "avg_usd": round(avg_usd, 4),
        "recent_30d_usd": round(recent_usd, 4),
    }


# ---------------------------------------------------------------------------
# Alerts (stub — placeholder for domain-aware alert rules)
# ---------------------------------------------------------------------------


@app.get("/alerts", dependencies=[Depends(verify_token)])
async def get_alerts() -> Dict[str, Any]:
    """Return active pipeline alerts (stub — expand with domain rules as needed)."""
    return {"alerts": [], "total": 0, "unacknowledged": 0}


@app.post("/alerts/{alert_id}/acknowledge", dependencies=[Depends(verify_token)])
async def ack_alert(alert_id: str) -> Dict[str, Any]:
    """Acknowledge an alert by ID."""
    return {"ok": True, "alert_id": alert_id}


@app.post("/alerts/acknowledge-all", dependencies=[Depends(verify_token)])
async def ack_all_alerts() -> Dict[str, Any]:
    """Acknowledge all currently active alerts."""
    return {"ok": True, "acknowledged_count": 0}


# ---------------------------------------------------------------------------
# Admin chat proxy (delegates to Claude/OpenAI via a simple system prompt)
# ---------------------------------------------------------------------------

_ADMIN_CHAT_MODEL = os.getenv("ADMIN_CHAT_MODEL", "gpt-4o-mini")
_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


@app.post("/api/admin-chat", dependencies=[Depends(verify_token)])
async def admin_chat(request: AdminChatRequest) -> Dict[str, Any]:
    """Admin-chat endpoint — forwards messages to OpenAI with race context."""
    if not _OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY not configured")
    system_content = (
        "You are an AI assistant embedded in the SmarterVote admin dashboard. "
        "You help administrators review races, decide which ones need re-running, "
        "and kick off new pipeline runs with the right settings."
    )
    if request.race_context:
        system_content += f"\n\nCurrent race context (JSON):\n{json.dumps(request.race_context, indent=2)}"
    messages = [{"role": "system", "content": system_content}]
    messages += [{"role": m.role, "content": m.content} for m in request.messages]
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {_OPENAI_API_KEY}"},
                json={"model": _ADMIN_CHAT_MODEL, "messages": messages},
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
            return {"reply": reply, "model": _ADMIN_CHAT_MODEL}
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {exc.response.status_code}") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Chat unavailable: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
