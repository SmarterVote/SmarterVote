"""Tests for FirestoreLogger (pipeline_client/backend/firestore_logger.py)."""

from unittest.mock import MagicMock, call, patch

import pytest

from pipeline_client.backend.firestore_logger import FirestoreLogger


@pytest.fixture
def mock_db():
    """Return a mock Firestore client."""
    with patch("pipeline_client.backend.firestore_logger._get_db") as mock_get_db:
        db = MagicMock()
        mock_get_db.return_value = db
        yield db


def test_log_writes_to_subcollection(mock_db):
    """log() writes a document to pipeline_runs/{run_id}/logs/."""
    logger = FirestoreLogger("run-001")
    logger.log("info", "Test message", step="issues")

    run_ref = mock_db.collection.return_value.document.return_value
    logs_col = run_ref.collection.return_value
    doc_ref = logs_col.document.return_value
    doc_ref.set.assert_called_once()
    written = doc_ref.set.call_args[0][0]
    assert written["level"] == "info"
    assert written["message"] == "Test message"
    assert written["step"] == "issues"
    assert written["run_id"] == "run-001"


def test_log_swallows_exceptions():
    """log() silently handles Firestore errors."""
    with patch("pipeline_client.backend.firestore_logger._get_db", side_effect=RuntimeError("boom")):
        logger = FirestoreLogger("run-002")
        logger.log("error", "Should not raise")  # must not propagate


def test_update_progress_merges_run_doc(mock_db):
    """update_progress() merges fields into pipeline_runs/{run_id}."""
    logger = FirestoreLogger("run-003")
    logger.update_progress(42, current_step="issues", status="running")

    run_ref = mock_db.collection.return_value.document.return_value
    run_ref.set.assert_called_once()
    merged = run_ref.set.call_args[0][0]
    assert merged["progress"] == 42
    assert merged["current_step"] == "issues"
    assert merged["status"] == "running"


def test_mark_completed(mock_db):
    """mark_completed() sets status=completed and progress=100."""
    logger = FirestoreLogger("run-004")
    logger.mark_completed(duration_ms=5000)

    run_ref = mock_db.collection.return_value.document.return_value
    run_ref.set.assert_called_once()
    data = run_ref.set.call_args[0][0]
    assert data["status"] == "completed"
    assert data["progress"] == 100
    assert data["duration_ms"] == 5000


def test_mark_failed(mock_db):
    """mark_failed() sets status=failed with error message."""
    logger = FirestoreLogger("run-005")
    logger.mark_failed("Something went wrong")

    run_ref = mock_db.collection.return_value.document.return_value
    run_ref.set.assert_called_once()
    data = run_ref.set.call_args[0][0]
    assert data["status"] == "failed"
    assert "Something went wrong" in data["error"]


def test_mark_continued(mock_db):
    """mark_continued() sets status=continued with continuation run id."""
    logger = FirestoreLogger("run-006")
    logger.mark_continued("run-007")

    run_ref = mock_db.collection.return_value.document.return_value
    run_ref.set.assert_called_once()
    data = run_ref.set.call_args[0][0]
    assert data["status"] == "continued"
    assert data["continuation_run_id"] == "run-007"
