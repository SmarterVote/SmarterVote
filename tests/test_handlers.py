"""Tests for AgentHandler integration."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from pipeline_client.backend.handlers.agent import AgentHandler


@pytest.mark.asyncio
async def test_v2_handler_raises_on_missing_race_id():
    """AgentHandler raises ValueError when race_id is missing."""
    handler = AgentHandler()
    with pytest.raises(ValueError, match="Missing 'race_id'"):
        await handler.handle({}, {})


@pytest.mark.asyncio
async def test_v2_handler_runs_agent_and_publishes():
    """AgentHandler calls run_agent and saves draft."""
    handler = AgentHandler()
    fake_result = {"id": "test-race", "candidates": []}

    with (
        patch("pipeline_client.agent.agent.run_agent", new_callable=AsyncMock) as mock_agent,
        patch.object(handler, "_save_draft", new_callable=AsyncMock) as mock_save_draft,
    ):
        mock_agent.return_value = fake_result
        mock_save_draft.return_value = Path("/tmp/test-race.json")

        result = await handler.handle(
            {"race_id": "test-race"},
            {"cheap_mode": True},
        )

    assert result["race_id"] == "test-race"
    assert result["status"] == "draft"
    mock_agent.assert_called_once()


@pytest.mark.asyncio
async def test_v2_handler_passes_enabled_steps():
    """AgentHandler passes enabled_steps option to run_agent."""
    handler = AgentHandler()
    fake_result = {"id": "test-race", "candidates": []}

    with (
        patch("pipeline_client.agent.agent.run_agent", new_callable=AsyncMock) as mock_agent,
        patch.object(handler, "_save_draft", new_callable=AsyncMock) as mock_save_draft,
    ):
        mock_agent.return_value = fake_result
        mock_save_draft.return_value = Path("/tmp/test-race.json")

        await handler.handle(
            {"race_id": "test-race"},
            {
                "cheap_mode": True,
                "enabled_steps": ["discovery", "images", "issues"],
                "candidate_names": ["Jeff Wadlin"],
            },
        )

    mock_agent.assert_called_once()
    call_kwargs = mock_agent.call_args
    assert call_kwargs.kwargs["enabled_steps"] == ["discovery", "images", "issues"]
    assert call_kwargs.kwargs["candidate_names"] == ["Jeff Wadlin"]


@pytest.mark.asyncio
async def test_v2_handler_uses_run_id_for_firestore_logs_when_pipeline_import_fails():
    """run_id from options should still drive Firestore logging if optional imports fail."""
    handler = AgentHandler()
    fake_result = {
        "id": "test-race",
        "candidates": [{"name": "Alice", "issues": {}}],
    }

    async def _fake_run_agent(*_args, **kwargs):
        on_log = kwargs.get("on_log")
        if on_log:
            on_log("info", "hello from test")
        return fake_result

    with (
        patch("pipeline_client.agent.agent.run_agent", new_callable=AsyncMock) as mock_agent,
        patch.object(handler, "_save_draft", new_callable=AsyncMock) as mock_save_draft,
        patch("pipeline_client.backend.firestore_logger.FirestoreLogger") as mock_fs_logger_cls,
        patch.dict(sys.modules, {"pipeline_client.backend.pipeline_runner": None}),
    ):
        mock_agent.side_effect = _fake_run_agent
        mock_save_draft.return_value = Path("/tmp/test-race.json")

        await handler.handle(
            {"race_id": "test-race"},
            {"cheap_mode": True, "run_id": "run-123"},
        )

    mock_fs_logger_cls.assert_called_with("run-123")
    mock_fs_logger_cls.return_value.log.assert_called()
