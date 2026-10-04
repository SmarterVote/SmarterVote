"""Behavioral tests for pipeline_client.worker's helper functions.

run_worker() itself installs process-wide SIGTERM/SIGINT handlers and runs an
indefinite poll loop, which is unsafe to exercise directly inside the shared
pytest process; this file targets the pure/isolated helpers around it instead:
_get_gcs, _bucket_name, _pending_items, and _process_one.
"""

import types
from unittest.mock import AsyncMock, MagicMock

import pytest

import pipeline_client.worker as worker

# ---------------------------------------------------------------------------
# _get_db
# ---------------------------------------------------------------------------


def test_get_db_returns_shared_firestore_logger_client_when_available(monkeypatch):
    import pipeline_client.backend.firestore_logger as firestore_logger

    fake_db = MagicMock()
    monkeypatch.setattr(firestore_logger, "_get_db", lambda: fake_db)

    assert worker._get_db() is fake_db


def test_get_db_falls_back_to_new_firestore_client_when_shared_db_is_none(monkeypatch):
    import pipeline_client.backend.firestore_logger as firestore_logger

    monkeypatch.setattr(firestore_logger, "_get_db", lambda: None)
    fake_client = MagicMock()
    # Other modules perform a real (unmocked) `from google.cloud import firestore`
    # earlier in the suite, which permanently binds `firestore` as an attribute of
    # the already-imported `google.cloud` package. That makes a sys.modules swap
    # for "google.cloud.firestore" ineffective here, so patch the real module's
    # Client attribute directly instead.
    from google.cloud import firestore as real_firestore

    monkeypatch.setattr(real_firestore, "Client", lambda project=None: fake_client)
    monkeypatch.setenv("FIRESTORE_PROJECT", "my-project")

    assert worker._get_db() is fake_client


# ---------------------------------------------------------------------------
# _get_gcs
# ---------------------------------------------------------------------------


def test_get_gcs_delegates_to_the_shared_factory(monkeypatch):
    """The worker no longer builds its own client.

    Construction and its failure modes (missing library, bad credentials,
    build-once memoization) are covered in tests/test_gcs_client.py, which is
    where that code now lives. What matters here is that the worker asks the
    shared factory instead of constructing a sixth independent client.
    """
    from pipeline_client.backend import gcs_client

    fake_client = MagicMock()
    monkeypatch.setattr(gcs_client, "get_gcs_client", lambda: fake_client)

    assert worker._get_gcs() is fake_client


def test_get_gcs_propagates_factory_unavailability(monkeypatch):
    """A None from the factory must reach the caller — every call site branches on it."""
    from pipeline_client.backend import gcs_client

    monkeypatch.setattr(gcs_client, "get_gcs_client", lambda: None)

    assert worker._get_gcs() is None


# ---------------------------------------------------------------------------
# _bucket_name
# ---------------------------------------------------------------------------


def test_bucket_name_prefers_settings_value(monkeypatch):
    from pipeline_client.backend.settings import settings

    monkeypatch.setattr(settings, "gcs_bucket", "settings-bucket")
    monkeypatch.setenv("GCS_BUCKET", "env-bucket")

    assert worker._bucket_name() == "settings-bucket"


def test_bucket_name_falls_back_to_env_var(monkeypatch):
    from pipeline_client.backend.settings import settings

    monkeypatch.setattr(settings, "gcs_bucket", None)
    monkeypatch.setenv("GCS_BUCKET", "env-bucket")

    assert worker._bucket_name() == "env-bucket"


def test_bucket_name_empty_when_neither_configured(monkeypatch):
    from pipeline_client.backend.settings import settings

    monkeypatch.setattr(settings, "gcs_bucket", None)
    monkeypatch.delenv("GCS_BUCKET", raising=False)

    assert worker._bucket_name() == ""


# ---------------------------------------------------------------------------
# _pending_items
# ---------------------------------------------------------------------------


class _FakeDocSnapshot:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


class _FakeQuery:
    def __init__(self, docs):
        self._docs = docs

    def where(self, *_a, **_k):
        return self

    def order_by(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def stream(self):
        return iter(self._docs)


class _FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def where(self, *_a, **_k):
        return _FakeQuery(self._docs)


class _FakeDb:
    def __init__(self, docs):
        self._docs = docs

    def collection(self, _name):
        return _FakeCollection(self._docs)


def test_pending_items_sorts_by_created_at_ascending(monkeypatch):
    monkeypatch.setitem(
        __import__("sys").modules,
        "google.cloud.firestore_v1",
        types.SimpleNamespace(FieldFilter=lambda *a, **k: ("filter", a, k)),
    )
    docs = [
        _FakeDocSnapshot("item-b", {"created_at": "2026-01-02T00:00:00Z", "race_id": "race-b"}),
        _FakeDocSnapshot("item-a", {"created_at": "2026-01-01T00:00:00Z", "race_id": "race-a"}),
    ]
    db = _FakeDb(docs)

    items = worker._pending_items(db, "local", limit=10)

    assert [item_id for item_id, _ in items] == ["item-a", "item-b"]


def _firestore_stub(monkeypatch):
    monkeypatch.setitem(
        __import__("sys").modules,
        "google.cloud.firestore_v1",
        types.SimpleNamespace(FieldFilter=lambda *a, **k: ("filter", a, k)),
    )


class _OrderedQuery:
    """Records whether the poll asked Firestore to order by created_at."""

    def __init__(self, docs, *, ordered_error=None, calls=None):
        self._docs = docs
        self._ordered_error = ordered_error
        self._ordered = False
        self.calls = calls if calls is not None else []

    def where(self, *_a, **_k):
        return self

    def order_by(self, field, *_a, **_k):
        self.calls.append(("order_by", field))
        clone = _OrderedQuery(self._docs, ordered_error=self._ordered_error, calls=self.calls)
        clone._ordered = True
        return clone

    def limit(self, n):
        self.calls.append(("limit", n))
        return self

    def stream(self):
        if self._ordered and self._ordered_error is not None:
            raise self._ordered_error
        self.calls.append(("stream", "ordered" if self._ordered else "unordered"))
        return iter(self._docs)


def _ordered_db(query):
    return types.SimpleNamespace(collection=lambda _n: types.SimpleNamespace(where=lambda *a, **k: query))


def test_pending_items_orders_server_side_by_created_at(monkeypatch):
    _firestore_stub(monkeypatch)
    query = _OrderedQuery([_FakeDocSnapshot("item-a", {"status": "pending", "created_at": "2026-01-01T00:00:00Z"})])

    items = worker._pending_items(_ordered_db(query), "local", limit=7)

    assert [item_id for item_id, _ in items] == ["item-a"]
    assert query.calls.count(("order_by", "created_at")) == 2
    assert ("stream", "unordered") not in query.calls
    assert query.calls.count(("stream", "ordered")) == 2


def test_pending_items_falls_back_when_index_missing(monkeypatch, caplog):
    from google.api_core.exceptions import FailedPrecondition

    _firestore_stub(monkeypatch)
    monkeypatch.setattr(worker, "_ordered_poll_fallback_logged", False)
    docs = [
        _FakeDocSnapshot("item-b", {"status": "pending", "created_at": "2026-01-02T00:00:00Z"}),
        _FakeDocSnapshot("item-a", {"status": "pending", "created_at": "2026-01-01T00:00:00Z"}),
    ]
    query = _OrderedQuery(docs, ordered_error=FailedPrecondition("The query requires an index."))

    with caplog.at_level("WARNING", logger="pipeline_worker"):
        items = worker._pending_items(_ordered_db(query), "local", limit=10)
        worker._pending_items(_ordered_db(query), "local", limit=10)

    # Client-side sort still yields FIFO from the unordered read.
    assert [item_id for item_id, _ in items] == ["item-a", "item-b"]
    assert query.calls.count(("stream", "unordered")) == 4
    fallback_logs = [r for r in caplog.records if "Ordered queue poll unavailable" in r.getMessage()]
    assert len(fallback_logs) == 1


def test_pending_items_does_not_swallow_other_errors(monkeypatch):
    _firestore_stub(monkeypatch)
    query = _OrderedQuery([], ordered_error=RuntimeError("boom"))

    with pytest.raises(RuntimeError):
        worker._pending_items(_ordered_db(query), "local")


def test_pending_items_handles_missing_created_at(monkeypatch):
    monkeypatch.setitem(
        __import__("sys").modules,
        "google.cloud.firestore_v1",
        types.SimpleNamespace(FieldFilter=lambda *a, **k: ("filter", a, k)),
    )
    docs = [
        _FakeDocSnapshot("item-no-date", {"race_id": "race-x"}),
        _FakeDocSnapshot("item-dated", {"created_at": "2026-01-01T00:00:00Z", "race_id": "race-y"}),
    ]
    db = _FakeDb(docs)

    items = worker._pending_items(db, "local")

    # Missing created_at sorts as "" (empty string), i.e. first.
    assert [item_id for item_id, _ in items] == ["item-no-date", "item-dated"]


def test_pending_items_includes_only_expired_running_leases(monkeypatch):
    monkeypatch.setitem(
        __import__("sys").modules,
        "google.cloud.firestore_v1",
        types.SimpleNamespace(FieldFilter=lambda *a, **k: ("filter", a, k)),
    )
    docs = [
        _FakeDocSnapshot("pending", {"status": "pending", "created_at": "2026-01-01T00:00:00Z"}),
        _FakeDocSnapshot(
            "expired",
            {
                "status": "running",
                "created_at": "2026-01-02T00:00:00Z",
                "lease_expires_at": "2026-01-03T00:00:00Z",
            },
        ),
        _FakeDocSnapshot(
            "live",
            {
                "status": "running",
                "created_at": "2026-01-03T00:00:00Z",
                "lease_expires_at": "2999-01-01T00:00:00Z",
            },
        ),
    ]

    items = worker._pending_items(_FakeDb(docs), "local")

    assert [item_id for item_id, _ in items] == ["pending", "expired"]


# ---------------------------------------------------------------------------
# _process_one
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_process_one_returns_early_when_claim_fails(monkeypatch):
    import pipeline_client.backend.queue_processor as queue_processor

    monkeypatch.setattr(queue_processor, "claim_item", MagicMock(return_value=None))
    process_mock = AsyncMock()
    monkeypatch.setattr(queue_processor, "process_claimed_item", process_mock)

    db = MagicMock()
    sem = worker.asyncio.Semaphore(1)

    await worker._process_one(db, MagicMock(), "bucket", "item-1", {"race_id": "race-1"}, sem, "local")

    process_mock.assert_not_called()


@pytest.mark.asyncio
async def test_process_one_processes_claimed_item(monkeypatch):
    import pipeline_client.backend.queue_processor as queue_processor

    monkeypatch.setattr(queue_processor, "claim_item", MagicMock(return_value={"race_id": "race-1"}))
    process_mock = AsyncMock()
    monkeypatch.setattr(queue_processor, "process_claimed_item", process_mock)

    db = MagicMock()
    gcs = MagicMock()
    sem = worker.asyncio.Semaphore(1)

    await worker._process_one(db, gcs, "bucket", "item-1", {"race_id": "race-1"}, sem, "local")

    process_mock.assert_awaited_once()
    call_args = process_mock.call_args
    assert call_args.args[0] is db
    assert call_args.args[1] is gcs
    assert call_args.args[2] == "bucket"
    assert call_args.args[3] == "item-1"
    assert call_args.kwargs["runner"] == "local"


@pytest.mark.asyncio
async def test_process_one_logs_exception_without_raising(monkeypatch):
    import pipeline_client.backend.queue_processor as queue_processor

    monkeypatch.setattr(queue_processor, "claim_item", MagicMock(return_value={"race_id": "race-1"}))
    monkeypatch.setattr(queue_processor, "process_claimed_item", AsyncMock(side_effect=RuntimeError("boom")))

    db = MagicMock()
    sem = worker.asyncio.Semaphore(1)

    # Must not raise even though process_claimed_item blew up.
    await worker._process_one(db, MagicMock(), "bucket", "item-1", {"race_id": "race-1"}, sem, "local")


# ---------------------------------------------------------------------------
# _AuthFailureGate
# ---------------------------------------------------------------------------


AUTH = "provider_auth_failure"


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_auth_gate_does_not_trip_on_a_single_failure():
    """One race failing auth is not evidence the provider is down."""
    gate = worker._AuthFailureGate(threshold=3, cooldown_seconds=900, clock=_FakeClock())

    gate.record(AUTH)

    assert gate.consecutive == 1
    assert gate.leasing_blocked() is False


def test_auth_gate_blocks_leasing_after_consecutive_auth_failures():
    gate = worker._AuthFailureGate(threshold=3, cooldown_seconds=900, clock=_FakeClock())

    for _ in range(3):
        gate.record(AUTH)

    assert gate.leasing_blocked() is True


def test_auth_gate_streak_is_broken_by_any_other_outcome():
    """Only a *run* of auth failures counts — the 2026-08-30 signature."""
    gate = worker._AuthFailureGate(threshold=3, cooldown_seconds=900, clock=_FakeClock())

    gate.record(AUTH)
    gate.record(AUTH)
    gate.record(None)  # a healthy race
    gate.record(AUTH)

    assert gate.consecutive == 1
    assert gate.leasing_blocked() is False


def test_auth_gate_streak_is_broken_by_an_unrelated_failure_reason():
    gate = worker._AuthFailureGate(threshold=2, cooldown_seconds=900, clock=_FakeClock())

    gate.record(AUTH)
    gate.record("review_not_passed")
    gate.record(AUTH)

    assert gate.leasing_blocked() is False


def test_auth_gate_clears_itself_after_the_cooldown():
    """The worker restarts under `restart: unless-stopped`, so blocking is
    time-boxed rather than terminal: a topped-up balance resumes on its own."""
    clock = _FakeClock()
    gate = worker._AuthFailureGate(threshold=2, cooldown_seconds=900, clock=clock)

    gate.record(AUTH)
    gate.record(AUTH)
    assert gate.leasing_blocked() is True

    clock.now = 899.0
    assert gate.leasing_blocked() is True

    clock.now = 900.0
    assert gate.leasing_blocked() is False
    assert gate.consecutive == 0


def test_auth_gate_threshold_zero_disables_the_halt():
    gate = worker._AuthFailureGate(threshold=0, cooldown_seconds=900, clock=_FakeClock())

    for _ in range(10):
        gate.record(AUTH)

    assert gate.leasing_blocked() is False


@pytest.mark.asyncio
async def test_process_one_feeds_the_terminal_reason_to_the_auth_gate(monkeypatch):
    import pipeline_client.backend.queue_processor as queue_processor

    monkeypatch.setattr(queue_processor, "claim_item", MagicMock(return_value={"race_id": "race-1"}))
    monkeypatch.setattr(queue_processor, "process_claimed_item", AsyncMock(return_value=AUTH))

    gate = worker._AuthFailureGate(threshold=2, cooldown_seconds=900, clock=_FakeClock())
    sem = worker.asyncio.Semaphore(1)

    for item_id in ("item-1", "item-2"):
        await worker._process_one(MagicMock(), MagicMock(), "bucket", item_id, {"race_id": "race-1"}, sem, "local", gate)

    assert gate.leasing_blocked() is True


@pytest.mark.asyncio
async def test_process_one_crash_clears_the_auth_streak(monkeypatch):
    """A worker-side crash says nothing about the provider's credit."""
    import pipeline_client.backend.queue_processor as queue_processor

    monkeypatch.setattr(queue_processor, "claim_item", MagicMock(return_value={"race_id": "race-1"}))
    monkeypatch.setattr(queue_processor, "process_claimed_item", AsyncMock(side_effect=RuntimeError("boom")))

    gate = worker._AuthFailureGate(threshold=2, cooldown_seconds=900, clock=_FakeClock())
    gate.record(AUTH)
    sem = worker.asyncio.Semaphore(1)

    await worker._process_one(MagicMock(), MagicMock(), "bucket", "item-1", {"race_id": "race-1"}, sem, "local", gate)

    assert gate.consecutive == 0


# ---------------------------------------------------------------------------
# _VersionGate (local worker staleness vs GitHub main)
# ---------------------------------------------------------------------------


def _fake_clock(start=0.0):
    now = {"t": start}
    return now, (lambda: now["t"])


@pytest.mark.asyncio
async def test_version_gate_blocks_leasing_when_worker_code_changed(monkeypatch):
    monkeypatch.setenv("WORKER_GIT_COMMIT", "a" * 40)
    monkeypatch.setattr(worker, "_fetch_latest_main_commit", AsyncMock(return_value="b" * 40))
    monkeypatch.setattr(worker, "_worker_code_changed", AsyncMock(return_value=True))
    gate = worker._VersionGate(runner="local", stop_claiming=True)

    await gate.refresh(force=True)

    assert gate.is_stale is True
    assert gate.leasing_blocked() is True


@pytest.mark.asyncio
async def test_version_gate_stop_claiming_is_toggleable(monkeypatch):
    monkeypatch.setenv("WORKER_GIT_COMMIT", "a" * 40)
    monkeypatch.setattr(worker, "_fetch_latest_main_commit", AsyncMock(return_value="b" * 40))
    monkeypatch.setattr(worker, "_worker_code_changed", AsyncMock(return_value=None))
    gate = worker._VersionGate(runner="local", stop_claiming=False)

    await gate.refresh(force=True)

    assert gate.is_stale is True
    assert gate.leasing_blocked() is False


@pytest.mark.asyncio
async def test_version_gate_ignores_non_worker_commits(monkeypatch):
    monkeypatch.setenv("WORKER_GIT_COMMIT", "a" * 40)
    monkeypatch.setattr(worker, "_fetch_latest_main_commit", AsyncMock(return_value="b" * 40))
    monkeypatch.setattr(worker, "_worker_code_changed", AsyncMock(return_value=False))
    gate = worker._VersionGate(runner="local", stop_claiming=True)

    await gate.refresh(force=True)

    assert gate.is_stale is False
    assert gate.leasing_blocked() is False


@pytest.mark.asyncio
async def test_version_gate_network_failure_is_unknown_not_stale(monkeypatch):
    monkeypatch.setenv("WORKER_GIT_COMMIT", "a" * 40)
    monkeypatch.setattr(worker, "_fetch_latest_main_commit", AsyncMock(return_value=None))
    gate = worker._VersionGate(runner="local", stop_claiming=True)

    await gate.refresh(force=True)

    assert gate.is_stale is None
    assert gate.leasing_blocked() is False


@pytest.mark.asyncio
async def test_version_gate_unstamped_image_logs_error(monkeypatch, caplog):
    monkeypatch.delenv("WORKER_GIT_COMMIT", raising=False)
    monkeypatch.delenv("GIT_COMMIT", raising=False)
    fetch = AsyncMock(return_value="b" * 40)
    monkeypatch.setattr(worker, "_fetch_latest_main_commit", fetch)
    gate = worker._VersionGate(runner="local", stop_claiming=True)

    with caplog.at_level("ERROR", logger="pipeline_worker"):
        await gate.refresh(force=True)

    assert any("WORKER VERSION UNKNOWN" in r.message for r in caplog.records)
    assert gate.leasing_blocked() is False


@pytest.mark.asyncio
async def test_version_gate_rechecks_only_after_interval(monkeypatch):
    monkeypatch.setenv("WORKER_GIT_COMMIT", "a" * 40)
    fetch = AsyncMock(return_value="a" * 40)
    monkeypatch.setattr(worker, "_fetch_latest_main_commit", fetch)
    now, clock = _fake_clock()
    gate = worker._VersionGate(runner="local", interval=1800, clock=clock)

    await gate.refresh()
    now["t"] = 100
    await gate.refresh()
    assert fetch.await_count == 1
    now["t"] = 1801
    await gate.refresh()
    assert fetch.await_count == 2
    assert gate.is_stale is False


@pytest.mark.asyncio
async def test_version_gate_skips_network_for_cloud_run(monkeypatch):
    fetch = AsyncMock()
    monkeypatch.setattr(worker, "_fetch_latest_main_commit", fetch)
    gate = worker._VersionGate(runner="cloud_run")

    await gate.refresh(force=True)

    fetch.assert_not_awaited()
    assert gate.leasing_blocked() is False


@pytest.mark.asyncio
async def test_fetch_latest_main_commit_parses_sha(monkeypatch):
    import httpx

    def handler(request):
        assert request.url.path.endswith("/repos/SmarterVote/SmarterVote/commits/main")
        return httpx.Response(200, json={"sha": "c" * 40})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))

    assert await worker._fetch_latest_main_commit() == "c" * 40


def test_poll_window_reads_more_than_capacity():
    assert worker._poll_window(1) == 50
    assert worker._poll_window(8) == 80
