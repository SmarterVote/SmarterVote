"""Results-only publishing and the public results file."""

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

import gcs_helpers
import live_feeds
from auth import verify_token
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, ValidationError
from request_models import validate_race_id
from routers.races_admin.helpers import _clear_public_race_cache
from starlette.concurrency import run_in_threadpool

from shared.election_results import result_index_entry
from shared.forecast_summary import build_live_chamber_projection
from shared.models import RaceResult

logger = logging.getLogger(__name__)
router = APIRouter()

# Cloudflare caches this for visitors; the local copy only protects GCS from
# repeated edge misses across colos.
_RESULTS_LOCAL_TTL_SECONDS = 30
_RESULTS_CACHE_CONTROL = "public, max-age=30, s-maxage=60"
_cache_lock = threading.Lock()
_cached_results: tuple[float, Dict[str, Any]] | None = None
_cached_live_forecast: tuple[float, Dict[str, Any]] | None = None


class PublishResultsRequest(BaseModel):
    race_ids: List[str] = Field(..., min_length=1, max_length=100)


class SetResultCandidate(BaseModel):
    name: str = Field(..., min_length=1)
    party: Optional[str] = None
    pct: Optional[float] = None
    votes: Optional[int] = None


class SetResultSource(BaseModel):
    url: str = Field(..., min_length=1)
    type: Literal["news", "government"]
    title: Optional[str] = None
    published_at: Optional[str] = None


class SetRaceResultRequest(BaseModel):
    """A result copied by hand from named sources; the same checks as the results step apply."""

    status: str
    candidates: List[SetResultCandidate] = Field(default_factory=list)
    sources: List[SetResultSource] = Field(..., min_length=1)
    set_by: str = Field(..., min_length=1, max_length=200)
    pct_reporting: Optional[float] = None
    winner_name: Optional[str] = None
    called_by: Optional[str] = None
    called_at: Optional[str] = None
    runoff_date: Optional[str] = None
    correction_note: Optional[str] = None
    note: Optional[str] = Field(None, max_length=2000)


def build_set_result(payload: SetRaceResultRequest, roster: List[Dict[str, Any]], auth: Dict[str, Any]) -> Dict[str, Any]:
    """The stored result block for *payload*, with parties from the roster and an audit note."""
    now = datetime.now(timezone.utc)
    party_by_name = {str(c.get("name") or "").casefold(): c.get("party") for c in roster if isinstance(c, dict)}
    method = auth.get("auth") or ("auth0" if auth else "local")
    result: Dict[str, Any] = {
        "status": payload.status,
        "winner_name": payload.winner_name,
        "winner_party": party_by_name.get(str(payload.winner_name or "").casefold()),
        "called_by": payload.called_by,
        "called_at": payload.called_at,
        "pct_reporting": payload.pct_reporting,
        "candidates": [
            {
                "name": row.name,
                "party": row.party or party_by_name.get(row.name.casefold()),
                "votes": row.votes,
                "pct": row.pct,
            }
            for row in payload.candidates
        ],
        "runoff_date": payload.runoff_date,
        "correction_note": payload.correction_note,
        "sources": [{**source.model_dump(), "last_accessed": now.isoformat(), "is_fresh": True} for source in payload.sources],
        "as_of": now.isoformat(),
        "audit": {
            "method": "admin_set_result",
            "set_by": f"{payload.set_by} (via {method})",
            "set_at": now.isoformat(),
            "source_urls": [source.url for source in payload.sources],
            "note": payload.note,
        },
    }
    # Shape errors (a negative count, a bad URL or timestamp) fail here, before the race checks.
    RaceResult.model_validate(result)
    return result


def _set_result(race_id: str, payload: SetRaceResultRequest, auth: Dict[str, Any]) -> Dict[str, Any]:
    published = gcs_helpers._gcs_get_race_json(race_id, "races")
    if not published:
        raise HTTPException(status_code=404, detail="Results can only be set on a published race")
    try:
        result = build_set_result(payload, published.get("candidates") or [], auth)
        gcs_helpers.set_draft_race_result(race_id, result)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.warning(
        "Draft result for %s set by hand: %s by %s from %s",
        race_id,
        result["status"],
        result["audit"]["set_by"],
        ", ".join(result["audit"]["source_urls"]),
    )
    return result


def _clear_results_cache() -> None:
    global _cached_results, _cached_live_forecast
    with _cache_lock:
        _cached_results = None
        _cached_live_forecast = None


def _load_public_results() -> Dict[str, Any]:
    global _cached_results
    with _cache_lock:
        if _cached_results and time.monotonic() < _cached_results[0]:
            return _cached_results[1]
    data = gcs_helpers.load_results_index()
    with _cache_lock:
        _cached_results = (time.monotonic() + _RESULTS_LOCAL_TTL_SECONDS, data)
    return data


def _load_live_forecast(publish_service: Any) -> Dict[str, Any]:
    """Chamber control with called races locked in; recomputed at most every 30s per instance."""
    global _cached_live_forecast
    with _cache_lock:
        if _cached_live_forecast and time.monotonic() < _cached_live_forecast[0]:
            return _cached_live_forecast[1]
    summaries = publish_service.get_race_summaries()
    if not isinstance(summaries, list):
        raise TypeError(f"Invalid summaries from publish service: {type(summaries)}")
    data = build_live_chamber_projection(summaries, _load_public_results())
    with _cache_lock:
        _cached_live_forecast = (time.monotonic() + _RESULTS_LOCAL_TTL_SECONDS, data)
    return data


def refresh_live_feeds(publish_service: Any) -> None:
    """Rewrite the static live feeds from fresh data. Never raises: the caller's publish already succeeded."""
    if not live_feeds.live_feeds_bucket():
        return
    try:
        _clear_results_cache()
        results = _load_public_results()
        summaries = publish_service.get_race_summaries_fresh()
        if not isinstance(summaries, list):
            raise TypeError(f"Invalid summaries from publish service: {type(summaries)}")
        forecast = build_live_chamber_projection(summaries, results)
        live_feeds.write_live_feeds(results, forecast)
    except Exception:
        logger.exception("Live feeds not refreshed; the previous static copies stay in place")


def _publish_results(race_ids: List[str]) -> Dict[str, Any]:
    published: List[str] = []
    rejected: Dict[str, str] = {}
    entries: Dict[str, Dict[str, Any]] = {}
    for race_id in race_ids:
        try:
            validate_race_id(race_id)
            race = gcs_helpers.publish_race_result(race_id)
        except Exception as exc:  # one bad race must not hold back the others
            rejected[race_id] = str(getattr(exc, "detail", exc))
            logger.warning("Result not published for %s: %s", race_id, rejected[race_id])
            continue
        entry = result_index_entry(race_id, race)
        if entry:
            entries[race_id] = entry
            published.append(race_id)
    if entries:
        gcs_helpers.update_results_index(entries)
    return {"published": published, "rejected": rejected}


@router.post("/api/results/publish", dependencies=[Depends(verify_token)])
async def publish_results(request: Request, payload: PublishResultsRequest) -> Dict[str, Any]:
    """Publish each race's checked draft result, and nothing else from its draft."""
    outcome = await run_in_threadpool(_publish_results, payload.race_ids)
    _clear_results_cache()
    # Also rewrites the static live feeds (see _clear_public_race_cache).
    await run_in_threadpool(_clear_public_race_cache, request)
    return outcome


@router.put("/api/races/{race_id}/result")
async def set_race_result(race_id: str, payload: SetRaceResultRequest, auth: dict = Depends(verify_token)) -> Dict[str, Any]:
    """Set the draft's result from supplied values; publishing is still ``/api/results/publish``.

    Runs the same race checks as the results step and the publish step, but not
    the unread-counts check: the caller copies the counts from the sources it
    names, and the audit note on the result records who and from where.
    """
    validate_race_id(race_id)
    result = await run_in_threadpool(_set_result, race_id, payload, auth or {})
    return {"race_id": race_id, "draft_result": result}


@router.get("/public/results")
async def public_results(response: Response) -> Dict[str, Any]:
    """Unauthenticated, cacheable results for every race with a published result."""
    data = await run_in_threadpool(_load_public_results)
    response.headers["Cache-Control"] = _RESULTS_CACHE_CONTROL
    return data


@router.get("/public/forecast-live")
async def public_forecast_live(request: Request, response: Response) -> Dict[str, Any]:
    """Unauthenticated, cacheable chamber projection: called races certain, the rest as forecast pre-election."""
    data = await run_in_threadpool(_load_live_forecast, request.app.state.publish_service)
    response.headers["Cache-Control"] = _RESULTS_CACHE_CONTROL
    return data
