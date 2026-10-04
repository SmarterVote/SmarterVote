"""
FastAPI middleware that records every request to the analytics store.
"""

import asyncio
import logging
import os
import random
import time
from typing import Callable

from fastapi import Request, Response
from rate_limit import client_ip
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("races_api")

# Strong references to in-flight analytics writes (see dispatch()).
_background_tasks: "set[asyncio.Task[None]]" = set()

# Paths that should not be tracked
# /geocode carries a voter's street address and must never be recorded.
_SKIP_PREFIXES = ("/health", "/docs", "/redoc", "/openapi", "/favicon", "/geocode")
_PUBLIC_EXACT_PATHS = {"/races", "/races/summaries"}
_PUBLIC_PREFIXES = ("/races/",)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, min(1.0, float(os.getenv(name, str(default)))))
    except ValueError:
        logger.warning("Invalid %s value; falling back to %s", name, default)
        return default


def _is_public_race_path(path: str) -> bool:
    return path in _PUBLIC_EXACT_PATHS or any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)


class AnalyticsMiddleware(BaseHTTPMiddleware):
    """Records latency, status code, and hashed IP for low-cost public analytics."""

    def __init__(self, app):
        super().__init__(app)
        self.enabled = _env_bool("ANALYTICS_ENABLED", True)
        self.public_only = _env_bool("ANALYTICS_PUBLIC_ONLY", True)
        self.log_4xx = _env_bool("ANALYTICS_LOG_4XX", False)
        self.sample_rate = _env_float("ANALYTICS_SAMPLE_RATE", 1.0)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        # Skip internal and documentation endpoints
        if not self.enabled or any(path.startswith(p) for p in _SKIP_PREFIXES):
            return await call_next(request)

        if request.method not in {"GET", "HEAD"}:
            return await call_next(request)

        if self.public_only and not _is_public_race_path(path):
            return await call_next(request)

        if self.sample_rate <= 0:
            return await call_next(request)

        sampled = self.sample_rate >= 1.0 or random.random() < self.sample_rate
        if not sampled:
            return await call_next(request)

        start = time.monotonic()
        response = await call_next(request)
        elapsed_ms = int((time.monotonic() - start) * 1000)

        if response.status_code >= 400 and not self.log_4xx:
            return response

        store = getattr(request.app.state, "analytics", None)
        if store is not None:
            # Same trusted-hop rule as rate limiting: the right-most
            # X-Forwarded-For entry appended by Cloud Run's front end, never the
            # caller-controlled left-most value.
            ip = client_ip(request)
            referer = request.headers.get("referer")
            # Fire-and-forget — never delay the response. The event loop keeps
            # only a weak reference to tasks, so hold a strong one until done or
            # the write can be garbage-collected mid-flight.
            task = asyncio.create_task(
                store.log_request(
                    path=path,
                    status_code=response.status_code,
                    response_ms=elapsed_ms,
                    client_ip=ip,
                    referer=referer,
                )
            )
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)

        return response
