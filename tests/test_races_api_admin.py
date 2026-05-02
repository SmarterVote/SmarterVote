"""Tests for the races-api admin endpoints added in the pipeline-client migration.

Uses FastAPI TestClient with mocked Firestore/GCS dependencies.
Auth is bypassed by patching `verify_token` to return an empty dict.
"""

import json
import os

# ---------------------------------------------------------------------------
# Ensure the races-api source directory is on sys.path so we can import `main`
# ---------------------------------------------------------------------------
import pathlib
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

RACES_API_DIR = pathlib.Path(__file__).parent.parent / "services" / "races-api"
if str(RACES_API_DIR) not in sys.path:
    sys.path.insert(0, str(RACES_API_DIR))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch):
    """FastAPI TestClient with auth disabled and mocked cloud dependencies."""
    monkeypatch.setenv("SKIP_AUTH", "true")
    monkeypatch.setenv("ADMIN_API_KEY", "test-key")

    # Patch firebase/gcs lazily at import boundary
    with (
        patch("main._get_fs", side_effect=_make_mock_fs),
        patch("main._get_gcs_admin", return_value=None),
        patch("main._GCS_BUCKET", ""),
    ):
        import main as app_module
        from fastapi.testclient import TestClient

        # Reset the Firestore singleton so each test gets a fresh mock
        app_module._fs_db = None
        yield TestClient(app_module.app)


# Store created per test call to make assertions possible
_fs_instances: list = []


def _make_mock_fs():
    db = _build_empty_firestore_mock()
    _fs_instances.append(db)
    return db


def _build_empty_firestore_mock() -> MagicMock:
    """Return a minimal Firestore mock that returns empty collections by default."""
    db = MagicMock()

    def _stream(*a, **kw):
        return iter([])

    def _make_coll(name):
        coll = MagicMock()
        coll.stream.return_value = iter([])
        coll.document.return_value = _make_missing_doc_ref()
        coll.order_by.return_value = coll
        coll.limit.return_value = coll
        coll.where.return_value = coll
        return coll

    db.collection.side_effect = _make_coll
    return db


def _make_missing_doc_ref() -> MagicMock:
    ref = MagicMock()
    doc = MagicMock()
    doc.exists = False
    doc.to_dict.return_value = {}
    ref.get.return_value = doc
    return ref


def _make_existing_doc(data: dict) -> MagicMock:
    doc = MagicMock()
    doc.exists = True
    doc.to_dict.return_value = dict(data)
    return doc


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# /steps
# ---------------------------------------------------------------------------


def test_list_steps(client):
    resp = client.get("/steps")
    assert resp.status_code == 200
    body = resp.json()
    assert "steps" in body
    assert "discovery" in body["steps"]


# ---------------------------------------------------------------------------
# /queue — GET returns empty list when Firestore is empty
# ---------------------------------------------------------------------------


def test_get_queue_empty(client):
    resp = client.get("/queue")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["pending"] == 0
    assert body["running"] is False


# ---------------------------------------------------------------------------
# /api/races/queue — POST queues a valid race ID
# ---------------------------------------------------------------------------


def test_queue_race_success():
    """POST /api/races/queue with SKIP_AUTH writes to Firestore and returns added list."""
    os.environ["SKIP_AUTH"] = "true"
    os.environ["ADMIN_API_KEY"] = "test-key"

    db = _build_empty_firestore_mock()
    added_docs: dict[str, dict] = {}

    def _capture_set(data, **_kw):
        pass  # just accept the call

    queue_doc_ref = MagicMock()
    queue_doc_ref.set.side_effect = _capture_set

    coll_queue = MagicMock()
    coll_queue.document.return_value = queue_doc_ref
    coll_queue.stream.return_value = iter([])
    coll_queue.order_by.return_value = coll_queue

    races_doc_ref = MagicMock()
    races_doc_ref.set.side_effect = lambda *a, **kw: None

    coll_races = MagicMock()
    coll_races.document.return_value = races_doc_ref

    def _coll(name):
        if name == "pipeline_queue":
            return coll_queue
        return coll_races

    db.collection.side_effect = _coll

    import importlib
    import sys

    # Reimport in a clean environment
    if "main" in sys.modules:
        import main as app_module

        app_module._fs_db = None  # reset singleton
    else:
        import main as app_module

    from fastapi.testclient import TestClient

    with (
        patch("main._get_fs", return_value=db),
        patch("main._get_gcs_admin", return_value=None),
        patch("main._GCS_BUCKET", ""),
    ):
        tc = TestClient(app_module.app)
        resp = tc.post(
            "/api/races/queue",
            json={"race_ids": ["az-01-senate-2026"]},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["added"]) == 1
    assert body["added"][0]["race_id"] == "az-01-senate-2026"
    assert body["errors"] == []


# ---------------------------------------------------------------------------
# /api/races/queue — invalid race_id rejected
# ---------------------------------------------------------------------------


def test_queue_race_invalid_id():
    """POST /api/races/queue with an invalid race_id returns error, not exception."""
    os.environ["SKIP_AUTH"] = "true"
    os.environ["ADMIN_API_KEY"] = "test-key"

    db = _build_empty_firestore_mock()

    import main as app_module

    app_module._fs_db = None

    from fastapi.testclient import TestClient

    with (
        patch("main._get_fs", return_value=db),
        patch("main._get_gcs_admin", return_value=None),
        patch("main._GCS_BUCKET", ""),
    ):
        tc = TestClient(app_module.app)
        resp = tc.post(
            "/api/races/queue",
            json={"race_ids": ["../../../etc/passwd"]},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["added"] == []
    assert len(body["errors"]) == 1
    assert "invalid" in body["errors"][0]["error"].lower()


# ---------------------------------------------------------------------------
# /runs/{run_id}/logs — returns sliced entries
# ---------------------------------------------------------------------------


def test_get_run_logs_since():
    """GET /runs/{run_id}/logs?since=2 returns only entries from index 2 onward."""
    os.environ["SKIP_AUTH"] = "true"
    os.environ["ADMIN_API_KEY"] = "test-key"

    entries = [{"ts": i, "level": "info", "message": f"msg {i}"} for i in range(5)]

    def _make_log_doc(data):
        doc = MagicMock()
        doc.exists = True
        doc.to_dict.return_value = dict(data)
        return doc

    log_docs = [_make_log_doc(e) for e in entries]

    db = _build_empty_firestore_mock()

    # Build nested subcollection mock: pipeline_runs → {run_id} → logs
    log_coll = MagicMock()
    log_coll.order_by.return_value = log_coll
    log_coll.stream.return_value = iter(log_docs)

    run_doc_ref = MagicMock()
    run_doc_ref.collection.return_value = log_coll

    runs_coll = MagicMock()
    runs_coll.document.return_value = run_doc_ref

    def _coll(name):
        if name == "pipeline_runs":
            return runs_coll
        return MagicMock()

    db.collection.side_effect = _coll

    import main as app_module

    app_module._fs_db = None

    from fastapi.testclient import TestClient

    with (
        patch("main._get_fs", return_value=db),
        patch("main._get_gcs_admin", return_value=None),
        patch("main._GCS_BUCKET", ""),
    ):
        tc = TestClient(app_module.app)
        resp = tc.get("/runs/run-abc/logs?since=2")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert len(body["logs"]) == 3  # entries 2, 3, 4
    assert body["logs"][0]["ts"] == 2


# ---------------------------------------------------------------------------
# verify_token — SKIP_AUTH bypasses JWT validation
# ---------------------------------------------------------------------------


def test_verify_token_skip_auth():
    """With SKIP_AUTH=true, verify_token returns {} without hitting Auth0."""
    os.environ["SKIP_AUTH"] = "true"
    import importlib

    import main as app_module

    # Reload to pick up env changes if module was already imported
    importlib.reload(app_module)

    import asyncio

    result = asyncio.get_event_loop().run_until_complete(app_module.verify_token(None))
    assert result == {}


# ---------------------------------------------------------------------------
# verify_token — missing credentials returns 401 when auth is enabled
# ---------------------------------------------------------------------------


def test_verify_token_missing_credentials():
    """With SKIP_AUTH=false, missing credentials raises 401."""
    os.environ["SKIP_AUTH"] = "false"
    os.environ["AUTH0_DOMAIN"] = "example.auth0.com"
    os.environ["AUTH0_AUDIENCE"] = "https://api.example.com"

    import importlib

    import main as app_module

    importlib.reload(app_module)

    import asyncio

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        asyncio.get_event_loop().run_until_complete(app_module.verify_token(None))

    assert exc_info.value.status_code == 401
