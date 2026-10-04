"""Long-lived local pipeline worker.

Leases ``runner == "local"`` items from the Firestore ``pipeline_queue`` and runs
them to completion in-process with a far-future deadline (see
``pipeline_client/backend/queue_processor.py``). It runs alongside the default
one-shot Cloud Run Job path; runner-scoped claims keep the two modes from
competing for the same work.

Usage:
    python -m pipeline_client.worker

Env:
    WORKER_CONCURRENCY     max races in flight at once (default 2)
    WORKER_POLL_SECONDS    idle poll interval (default 3)
    GCS_BUCKET             GCS bucket for drafts/checkpoints (else settings)
    FIRESTORE_PROJECT / PROJECT_ID   Firestore project
Requires GCP credentials (GOOGLE_APPLICATION_CREDENTIALS or ADC) with Firestore +
GCS access, plus the LLM/search API keys the agent needs (via .env / env).
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
import uuid
from pathlib import Path
from typing import Any, Optional, Set

from dotenv import load_dotenv

from shared.config import FIRESTORE_QUEUE_COLLECTION

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

# Shared backends use FIRESTORE_PROJECT for mode detection, while workstation
# environments commonly provide only GOOGLE_CLOUD_PROJECT.
if not os.getenv("FIRESTORE_PROJECT"):
    _configured_project = os.getenv("PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
    if _configured_project:
        os.environ["FIRESTORE_PROJECT"] = _configured_project

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("pipeline_worker")

_RUNNER = os.getenv("WORKER_RUNNER", "local").strip().lower()
_CONCURRENCY = max(1, int(os.getenv("WORKER_CONCURRENCY", "2")))
_POLL_SECONDS = max(1, int(os.getenv("WORKER_POLL_SECONDS", "3")))
_ONCE = os.getenv("WORKER_ONCE", "false").strip().lower() in {"1", "true", "yes"}
# How often the long-lived worker proves it's still alive. This has nothing to do
# with race progress — it fires whether or not any race is in flight — so an admin
# can tell "worker process is dead/not restarted" apart from "worker is just idle".
# See infra/monitoring.tf's `pipeline_worker_heartbeat` log-based metric + the
# `local_worker_stale` alert policy, which fire off the log line this writes.
_HEARTBEAT_SECONDS = max(30, int(os.getenv("WORKER_HEARTBEAT_SECONDS", "300")))
# Consecutive provider auth/credit failures before the worker stops leasing, and
# how long it waits before probing the provider again. See _AuthFailureGate.
_AUTH_HALT_THRESHOLD = max(0, int(os.getenv("WORKER_AUTH_FAILURE_HALT_THRESHOLD", "3")))
_AUTH_HALT_COOLDOWN_SECONDS = max(60, int(os.getenv("WORKER_AUTH_FAILURE_COOLDOWN_SECONDS", "900")))
# Staleness of the long-lived local worker: its baked WORKER_GIT_COMMIT is
# compared against the latest commit on GitHub main (the container has no .git,
# so a local `git rev-parse` cannot work). Re-checked periodically, not just at
# startup, because a worker started current goes stale the moment a fix merges.
_VERSION_CHECK_SECONDS = max(60, int(os.getenv("WORKER_VERSION_CHECK_SECONDS", "1800")))
_STOP_CLAIMING_WHEN_STALE = os.getenv("WORKER_STOP_CLAIMING_WHEN_STALE", "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
_GITHUB_REPO = os.getenv("WORKER_GITHUB_REPO", "SmarterVote/SmarterVote").strip()
_GITHUB_BRANCH = os.getenv("WORKER_GITHUB_BRANCH", "main").strip()
_GITHUB_TIMEOUT_SECONDS = 10.0
# Only changes under these paths can alter what the worker does. A worker that is
# behind main by docs/web/infra commits alone is not stale.
_WORKER_CODE_PATH_PREFIXES = (
    "pipeline_client/",
    "shared/",
    "requirements",
    "pyproject.toml",
    "docker-compose.worker.yml",
)
_cloud_logger: Any = None
_cloud_logger_init_failed = False


def _get_cloud_logger() -> Any:
    """Lazily create a Cloud Logging client bound to the `pipeline-worker-heartbeat`
    log. Only WORKER_ONCE=false (long-lived) callers need this — the one-shot Cloud
    Run Job path already ships stdout to Cloud Logging automatically and doesn't call
    this. Returns None (and logs a one-time warning) if google-cloud-logging isn't
    installed or ADC lacks roles/logging.logWriter — the heartbeat is best-effort and
    must never crash the worker.
    """
    global _cloud_logger, _cloud_logger_init_failed
    if _cloud_logger is not None or _cloud_logger_init_failed:
        return _cloud_logger
    try:
        from google.cloud import logging as gcloud_logging  # type: ignore

        project = os.getenv("FIRESTORE_PROJECT") or os.getenv("PROJECT_ID")
        client = gcloud_logging.Client(project=project) if project else gcloud_logging.Client()
        _cloud_logger = client.logger("pipeline-worker-heartbeat")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cloud Logging heartbeat disabled (init failed): %s", exc)
        _cloud_logger_init_failed = True
        _cloud_logger = None
    return _cloud_logger


def _emit_heartbeat() -> None:
    """Write one structured heartbeat entry to Cloud Logging, if available.

    Best-effort: any failure here only logs a local warning and never propagates,
    since a heartbeat outage must not take down race processing.
    """
    cloud_logger = _get_cloud_logger()
    if cloud_logger is None:
        return
    try:
        cloud_logger.log_struct(
            {"event": "pipeline_worker_heartbeat", "runner": _RUNNER, "hostname": os.getenv("HOSTNAME", "local-worker")},
            severity="INFO",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to emit worker heartbeat: %s", exc)


def _get_db() -> Any:
    from pipeline_client.backend.firestore_logger import _get_db as _fl_get_db

    db = _fl_get_db()
    if db is None:
        from google.cloud import firestore  # type: ignore

        project = os.getenv("FIRESTORE_PROJECT") or os.getenv("PROJECT_ID")
        db = firestore.Client(project=project) if project else firestore.Client()
    return db


def _get_gcs() -> Any:
    from pipeline_client.backend.gcs_client import get_gcs_client

    return get_gcs_client()


def _bucket_name() -> str:
    from pipeline_client.backend.settings import settings

    return settings.gcs_bucket or os.getenv("GCS_BUCKET", "")


class _AuthFailureGate:
    """Stops the worker leasing new races while the LLM provider is refusing us.

    On 2026-08-30 the OpenRouter balance hit zero mid-pass and the provider
    returned HTTP 402 to every call for 18 minutes. Nothing stopped the lease
    loop: all 27 remaining queued races were claimed, burned against the dead
    provider and dequeued in the time a single race normally takes, each one
    recording a run-health failure as though its *research* had failed. Only two
    of them had any research reason to lose their queue slot.

    One failure is not evidence — a single race can fail auth for its own
    reasons, and a momentary provider blip should not idle the worker — so the
    gate only trips after ``threshold`` races in a row end that way. Anything
    else finishing resets the count.

    Tripping pauses leasing rather than exiting: the container runs under
    `restart: unless-stopped`, so a process that quits here would be restarted
    within seconds and burn another ``threshold`` races, over and over. After
    ``cooldown_seconds`` the gate clears itself and lets work through again, so
    a topped-up balance resumes on its own at a cost of a few races per
    cool-down instead of the whole queue.

    Races already in flight are left alone; they own their leases and their
    partial work is still worth checkpointing.
    """

    def __init__(
        self,
        threshold: int = _AUTH_HALT_THRESHOLD,
        cooldown_seconds: float = _AUTH_HALT_COOLDOWN_SECONDS,
        clock: Any = time.monotonic,
    ) -> None:
        self._threshold = threshold
        self._cooldown = cooldown_seconds
        self._clock = clock
        self._consecutive = 0
        self._blocked_until: Optional[float] = None

    @property
    def consecutive(self) -> int:
        return self._consecutive

    def record(self, reason: Optional[str]) -> None:
        """Fold one finished race's terminal failure reason into the streak."""
        from shared.run_health import RunFailureReason

        if reason == RunFailureReason.PROVIDER_AUTH_FAILURE.value:
            self._consecutive += 1
            return
        self._consecutive = 0
        self._blocked_until = None

    def leasing_blocked(self) -> bool:
        """True while the worker should leave queued races alone."""
        if self._threshold <= 0 or self._consecutive < self._threshold:
            return False
        now = self._clock()
        if self._blocked_until is None:
            self._blocked_until = now + self._cooldown
            logger.error(
                "HALTING NEW LEASES: %d consecutive races failed with a provider auth/credit error. "
                "The LLM API key is most likely out of credit or revoked — top it up and the worker "
                "will resume on its own. Remaining races stay queued (not dequeued); retrying in %ds.",
                self._consecutive,
                int(self._cooldown),
            )
            return True
        if now >= self._blocked_until:
            logger.warning("Auth-failure cool-down elapsed — leasing again to probe the provider")
            self._consecutive = 0
            self._blocked_until = None
            return False
        return True


def _github_headers() -> dict:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "smartervote-pipeline-worker"}
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def _fetch_latest_main_commit() -> Optional[str]:
    """Latest commit SHA on the configured GitHub branch, or None if unknowable."""
    import httpx

    url = f"https://api.github.com/repos/{_GITHUB_REPO}/commits/{_GITHUB_BRANCH}"
    try:
        async with httpx.AsyncClient(timeout=_GITHUB_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=_github_headers())
        if resp.status_code != 200:
            logger.warning("Worker version check: GitHub returned HTTP %s for %s", resp.status_code, url)
            return None
        sha = (resp.json() or {}).get("sha")
        return sha if isinstance(sha, str) and sha else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Worker version check: could not reach GitHub: %s", exc)
        return None


async def _worker_code_changed(base: str, head: str) -> Optional[bool]:
    """Whether worker-relevant files changed between two commits (None if unknown)."""
    import httpx

    url = f"https://api.github.com/repos/{_GITHUB_REPO}/compare/{base}...{head}"
    try:
        async with httpx.AsyncClient(timeout=_GITHUB_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=_github_headers())
        if resp.status_code != 200:
            return None
        payload = resp.json() or {}
        files = payload.get("files")
        if not isinstance(files, list) or len(files) >= 300:
            return None  # missing or truncated file list — cannot rule out a code change
        return any(
            isinstance(entry, dict) and str(entry.get("filename") or "").startswith(_WORKER_CODE_PATH_PREFIXES)
            for entry in files
        )
    except Exception:  # noqa: BLE001
        return None


class _VersionGate:
    """Stops the long-lived local worker leasing new races once its image is stale.

    The local Docker worker never auto-updates: after a fix merges it keeps running
    the old code indefinitely with no error. This gate compares the baked
    ``WORKER_GIT_COMMIT`` against GitHub main every ``interval`` seconds. When the
    image is confirmed behind main on worker code, it logs an ERROR and (unless
    ``WORKER_STOP_CLAIMING_WHEN_STALE=false``) stops claiming new work; races
    already in flight finish. Network failures read as unknown, never stale.
    """

    def __init__(
        self,
        runner: str = _RUNNER,
        interval: float = _VERSION_CHECK_SECONDS,
        stop_claiming: bool = _STOP_CLAIMING_WHEN_STALE,
        clock: Any = time.monotonic,
    ) -> None:
        self._runner = runner
        self._interval = interval
        self._stop_claiming = stop_claiming
        self._clock = clock
        self._last_check: Optional[float] = None
        self.is_stale: Optional[bool] = None

    async def refresh(self, force: bool = False) -> None:
        if self._runner != "local":
            self.is_stale = False
            return
        now = self._clock()
        if not force and self._last_check is not None and now - self._last_check < self._interval:
            return
        self._last_check = now

        from shared.run_health import check_worker_version_staleness

        worker_commit = (os.getenv("WORKER_GIT_COMMIT") or os.getenv("GIT_COMMIT") or "").strip()
        if not worker_commit:
            result = check_worker_version_staleness(runner=self._runner)
            logger.error("WORKER VERSION UNKNOWN: %s", result.get("warning"))
            self.is_stale = None
            return

        latest = await _fetch_latest_main_commit()
        if not latest:
            logger.warning(
                "WORKER VERSION WARNING: built from commit %s; latest %s commit unavailable, staleness unknown",
                worker_commit[:7],
                _GITHUB_BRANCH,
            )
            self.is_stale = None
            return
        result = check_worker_version_staleness(runner=self._runner, worker_commit=worker_commit, repo_commit=latest)
        if result.get("is_stale") is True:
            changed = await _worker_code_changed(worker_commit, latest)
            if changed is False:
                logger.info(
                    "Worker commit %s is behind %s %s, but no worker code changed in between",
                    worker_commit[:7],
                    _GITHUB_BRANCH,
                    latest[:7],
                )
                self.is_stale = False
                return
        self.is_stale = result.get("is_stale")
        if self.is_stale is True:
            logger.error(
                "STALE WORKER: %s%s",
                result.get("warning"),
                " No new races will be leased until the worker is rebuilt (in-flight races finish)."
                if self._stop_claiming
                else " WORKER_STOP_CLAIMING_WHEN_STALE=false, so leasing continues on old code.",
            )
        elif self.is_stale is None:
            logger.warning("WORKER VERSION WARNING: %s", result.get("warning"))
        else:
            logger.info("Worker built from commit %s (current with %s)", worker_commit[:7], _GITHUB_BRANCH)

    def leasing_blocked(self) -> bool:
        return bool(self._stop_claiming and self.is_stale is True)


def _poll_window(capacity: int) -> int:
    """How many queue docs to read per poll so client-side FIFO ordering is meaningful.

    Firestore returns equality-filtered docs in document-id order (random ids), so
    reading only ``capacity`` docs picked arbitrary items and could starve old ones.
    """
    return max(capacity * 10, 50)


def _pending_items(db: Any, runner: str, limit: int = 50):
    """Return pending and recoverable expired-lease items, oldest first.

    Runner and status filters execute in Firestore so completed history can
    never starve new work. Pending and running items use separate equality
    queries to avoid requiring a composite ``in`` index; only expired running
    leases are returned. Ordering stays client-side.
    """
    from google.cloud.firestore_v1 import FieldFilter  # type: ignore

    from pipeline_client.backend.queue_processor import _lease_expired, _now

    collection = db.collection(FIRESTORE_QUEUE_COLLECTION)
    docs = []
    for status in ("pending", "running"):
        query = collection.where(filter=FieldFilter("runner", "==", runner))
        query = query.where(filter=FieldFilter("status", "==", status))
        docs.extend(query.limit(limit).stream())
    now = _now()
    items = []
    seen_ids = set()
    for doc in docs:
        if doc.id in seen_ids:
            continue
        seen_ids.add(doc.id)
        data = doc.to_dict() or {}
        if data.get("status") == "running" and not _lease_expired(data, now):
            continue
        items.append((doc.id, data))
    items.sort(key=lambda pair: str(pair[1].get("created_at") or ""))
    return items[:limit]


async def _process_one(
    db: Any,
    gcs: Any,
    bucket: str,
    item_id: str,
    item_data: dict,
    sem: asyncio.Semaphore,
    runner: str,
    auth_gate: Optional[_AuthFailureGate] = None,
) -> None:
    from pipeline_client.backend.queue_processor import claim_item, process_claimed_item

    async with sem:
        lease_owner = f"{os.getenv('HOSTNAME', 'local-worker')}:{uuid.uuid4()}"
        item_ref = db.collection(FIRESTORE_QUEUE_COLLECTION).document(item_id)
        claimed = await asyncio.to_thread(claim_item, db, item_ref, lease_owner, runner)
        if not claimed:
            return  # lost the race / already terminal
        race_id = claimed.get("race_id", "?")
        logger.info("Worker leased %s (race %s)", item_id, race_id)
        try:
            reason = await process_claimed_item(db, gcs, bucket, item_id, claimed, lease_owner, runner=runner)
            logger.info("Worker finished %s (race %s)", item_id, race_id)
            if auth_gate is not None:
                auth_gate.record(reason)
        except Exception:  # noqa: BLE001
            logger.exception("Worker crashed processing %s (race %s)", item_id, race_id)
            # A crash here is a worker bug, not evidence about the provider, so
            # it clears the streak rather than counting toward the halt.
            if auth_gate is not None:
                auth_gate.record(None)


async def run_worker() -> None:
    db = _get_db()
    gcs = _get_gcs()
    bucket = _bucket_name()
    if not bucket:
        logger.warning("No GCS bucket configured — drafts/checkpoints will not persist")
    logger.info(
        "Pipeline worker started (runner=%s, once=%s, concurrency=%d, poll=%ds, bucket=%s)",
        _RUNNER,
        _ONCE,
        _CONCURRENCY,
        _POLL_SECONDS,
        bucket or "-",
    )

    version_gate = _VersionGate()
    await version_gate.refresh(force=True)

    stop = asyncio.Event()

    def _request_stop(*_a: Any) -> None:
        logger.info("Shutdown requested — finishing in-flight races, no new leases")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if sig is None:
            continue
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:  # Windows
            signal.signal(sig, lambda *_: _request_stop())

    sem = asyncio.Semaphore(_CONCURRENCY)
    auth_gate = _AuthFailureGate()
    in_flight: Set[asyncio.Task] = set()
    last_heartbeat = 0.0
    # WORKER_ONCE (the Cloud Run Job path) already has stdout auto-shipped to Cloud
    # Logging and a per-item lease heartbeat; the Cloud Logging heartbeat below is
    # only meaningful for the long-lived local worker this alert targets.
    emit_heartbeats = not _ONCE

    while not stop.is_set():
        if emit_heartbeats and (time.monotonic() - last_heartbeat) >= _HEARTBEAT_SECONDS:
            _emit_heartbeat()
            last_heartbeat = time.monotonic()
        if not _ONCE:
            await version_gate.refresh()
        try:
            capacity = _CONCURRENCY - len(in_flight)
            if auth_gate.leasing_blocked() or version_gate.leasing_blocked():
                capacity = 0
            queue_item_id = os.getenv("QUEUE_ITEM_ID", "").strip()
            if _ONCE and queue_item_id:
                doc = db.collection(FIRESTORE_QUEUE_COLLECTION).document(queue_item_id).get()
                data = doc.to_dict() if getattr(doc, "exists", False) else None
                items = [(queue_item_id, data)] if isinstance(data, dict) and capacity > 0 else []
            else:
                items = _pending_items(db, _RUNNER, limit=_poll_window(capacity))[:capacity] if capacity > 0 else []
        except Exception:  # noqa: BLE001
            logger.exception("Failed to poll pipeline_queue")
            items = []

        started = False
        seen_ids = {t.get_name() for t in in_flight}
        for item_id, item_data in items:
            if len(in_flight) >= _CONCURRENCY:
                break
            if item_id in seen_ids:
                continue
            task = asyncio.create_task(
                _process_one(db, gcs, bucket, item_id, item_data, sem, _RUNNER, auth_gate), name=item_id
            )
            in_flight.add(task)
            task.add_done_callback(in_flight.discard)
            started = True

        if not started:
            if _ONCE:
                break
            try:
                await asyncio.wait_for(stop.wait(), timeout=_POLL_SECONDS)
            except asyncio.TimeoutError:
                pass

        if _ONCE and in_flight:
            await asyncio.gather(*in_flight, return_exceptions=True)
            in_flight.clear()
            break

    if in_flight:
        logger.info("Waiting for %d in-flight race(s) to finish...", len(in_flight))
        await asyncio.gather(*in_flight, return_exceptions=True)
    logger.info("Local pipeline worker stopped")


def main() -> None:
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
