"""Tests for the HandoffTriggered exception and the handoff checkpoint mechanism.

The handoff logic lives inside `AgentHandler.handle()` as a nested closure
(`_on_step_complete` / `_trigger_handoff`).  We test it by:
  1. Verifying the exception class attributes directly.
  2. Exercising the step-tracker callbacks via a specially crafted mock agent
     that calls them with a past deadline so the handoff path triggers.
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pipeline_client.backend.handlers.agent import HandoffTriggered

# ---------------------------------------------------------------------------
# Exception class
# ---------------------------------------------------------------------------


def test_handoff_triggered_attributes():
    """HandoffTriggered stores continuation_item_id and remaining_steps."""
    exc = HandoffTriggered("item-abc", ["refinement", "review"])
    assert exc.continuation_item_id == "item-abc"
    assert exc.remaining_steps == ["refinement", "review"]
    assert "item-abc" in str(exc)


def test_handoff_triggered_is_exception():
    assert issubclass(HandoffTriggered, Exception)


# ---------------------------------------------------------------------------
# run_agent mock factory
# ---------------------------------------------------------------------------


def _make_run_agent_calling_tracker(step: str, *, complete: bool = True):
    """
    Returns an async mock of run_agent that calls step_tracker callbacks for
    the given step, simulating what the real agent does at runtime.
    """

    async def _fake_run_agent(race_id, *, step_tracker=None, enabled_steps=None, **_kw):
        if step_tracker:
            step_tracker["start"](step)
            if complete:
                step_tracker["complete"](step, duration_ms=100)
        return {"id": race_id, "candidates": []}

    return _fake_run_agent


# ---------------------------------------------------------------------------
# Handoff triggered after step completes when deadline has passed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handoff_raised_when_deadline_exceeded():
    """_on_step_complete raises HandoffTriggered when deadline is past and steps remain."""
    from pipeline_client.backend.handlers.agent import AgentHandler

    handler = AgentHandler()
    past_deadline = time.time() - 10.0  # definitely in the past

    options = {
        "run_id": "run-handoff-test",
        "deadline_at": past_deadline,
        "enabled_steps": ["discovery", "issues"],
    }
    payload = {"race_id": "az-01-senate-2026"}

    mock_db = MagicMock()
    mock_db.collection.return_value.document.return_value.set = MagicMock()

    with (
        patch(
            "pipeline_client.agent.agent.run_agent",
            side_effect=_make_run_agent_calling_tracker("discovery"),
        ),
        patch.object(handler, "_save_draft", new_callable=AsyncMock),
        # FirestoreLogger is imported inside handle() from firestore_logger module
        patch("pipeline_client.backend.firestore_logger.FirestoreLogger", MagicMock()),
        patch("pipeline_client.backend.firestore_logger._get_db", return_value=mock_db),
    ):
        with pytest.raises(HandoffTriggered) as exc_info:
            await handler.handle(payload, options)

    exc = exc_info.value
    # "issues" was not yet completed, so it should be in remaining_steps
    assert "issues" in exc.remaining_steps


@pytest.mark.asyncio
async def test_no_handoff_when_last_step_completes():
    """No HandoffTriggered when the last enabled step completes past deadline."""
    from pipeline_client.backend.handlers.agent import AgentHandler

    handler = AgentHandler()
    past_deadline = time.time() - 10.0

    # Only one step — after it completes, _remaining is empty, so no handoff
    options = {
        "run_id": "run-no-handoff",
        "deadline_at": past_deadline,
        "enabled_steps": ["discovery"],
    }
    payload = {"race_id": "az-01-senate-2026"}

    mock_db = MagicMock()

    with (
        patch(
            "pipeline_client.agent.agent.run_agent",
            side_effect=_make_run_agent_calling_tracker("discovery"),
        ),
        patch.object(handler, "_save_draft", new_callable=AsyncMock),
        patch("pipeline_client.backend.firestore_logger.FirestoreLogger", MagicMock()),
        patch("pipeline_client.backend.firestore_logger._get_db", return_value=mock_db),
    ):
        # Should NOT raise HandoffTriggered
        result = await handler.handle(payload, options)

    assert result["status"] == "draft"


@pytest.mark.asyncio
async def test_no_handoff_when_deadline_in_future():
    """No HandoffTriggered when steps remain but deadline has not passed."""
    from pipeline_client.backend.handlers.agent import AgentHandler

    handler = AgentHandler()
    future_deadline = time.time() + 9999.0  # far future

    options = {
        "run_id": "run-future-deadline",
        "deadline_at": future_deadline,
        "enabled_steps": ["discovery", "issues"],
    }
    payload = {"race_id": "az-01-senate-2026"}

    mock_db = MagicMock()

    with (
        patch(
            "pipeline_client.agent.agent.run_agent",
            side_effect=_make_run_agent_calling_tracker("discovery"),
        ),
        patch.object(handler, "_save_draft", new_callable=AsyncMock),
        patch("pipeline_client.backend.firestore_logger.FirestoreLogger", MagicMock()),
        patch("pipeline_client.backend.firestore_logger._get_db", return_value=mock_db),
    ):
        result = await handler.handle(payload, options)

    assert result["status"] == "draft"
