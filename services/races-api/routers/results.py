"""Results-only publishing and the public results file."""

import logging
import threading
import time
from typing import Any, Dict, List

import gcs_helpers
import live_feeds
from auth import verify_token
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from request_models import validate_race_id
from routers.races_admin.helpers import _clear_public_race_cache
from starlette.concurrency import run_in_threadpool

from shared.election_results import result_index_entry
from shared.forecast_summary import build_live_chamber_projection

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
