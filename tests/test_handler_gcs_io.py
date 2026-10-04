"""GCS persistence failures must fail the run instead of being swallowed."""

import json
from unittest.mock import MagicMock, patch

import pytest

from pipeline_client.backend.handlers.agent import AgentHandler


def _client_with_blob(blob):
    bucket = MagicMock()
    bucket.blob.return_value = blob
    client = MagicMock()
    client.bucket.return_value = bucket
    return client


@pytest.mark.asyncio
async def test_upload_raises_when_bucket_configured_but_no_client():
    handler = AgentHandler()
    with (
        patch("pipeline_client.backend.settings.settings.gcs_bucket", "test-bucket"),
        patch.object(handler, "_get_storage_client", return_value=None),
        pytest.raises(RuntimeError, match="no storage client"),
    ):
        await handler._upload_to_gcs("test-race", "{}")


@pytest.mark.asyncio
async def test_upload_raises_on_upload_failure():
    handler = AgentHandler()
    blob = MagicMock()
    blob.upload_from_string.side_effect = OSError("403 forbidden")
    with (
        patch("pipeline_client.backend.settings.settings.gcs_bucket", "test-bucket"),
        patch.object(handler, "_get_storage_client", return_value=_client_with_blob(blob)),
        pytest.raises(RuntimeError, match="403 forbidden"),
    ):
        await handler._upload_to_gcs("test-race", "{}")


@pytest.mark.asyncio
async def test_upload_is_noop_without_bucket():
    handler = AgentHandler()
    with (
        patch("pipeline_client.backend.settings.settings.gcs_bucket", None),
        patch.object(handler, "_get_storage_client") as get_client,
    ):
        await handler._upload_to_gcs("test-race", "{}")
    get_client.assert_not_called()


@pytest.mark.asyncio
async def test_load_existing_raises_on_storage_error_instead_of_returning_none():
    handler = AgentHandler()
    blob = MagicMock()
    blob.exists.side_effect = OSError("network down")
    with (
        patch("pipeline_client.backend.settings.settings.gcs_bucket", "test-bucket"),
        patch.object(handler, "_get_storage_client", return_value=_client_with_blob(blob)),
        pytest.raises(RuntimeError, match="network down"),
    ):
        await handler._load_existing_from_gcs("test-race")


@pytest.mark.asyncio
async def test_load_existing_returns_none_when_not_found():
    handler = AgentHandler()
    blob = MagicMock()
    blob.exists.return_value = False
    with (
        patch("pipeline_client.backend.settings.settings.gcs_bucket", "test-bucket"),
        patch.object(handler, "_get_storage_client", return_value=_client_with_blob(blob)),
    ):
        assert await handler._load_existing_from_gcs("test-race") is None


@pytest.mark.asyncio
async def test_baseline_never_falls_back_to_local_drafts_when_bucket_configured():
    handler = AgentHandler()
    blob = MagicMock()
    blob.exists.return_value = False
    with (
        patch("pipeline_client.backend.settings.settings.gcs_bucket", "test-bucket"),
        patch.object(handler, "_get_storage_client", return_value=_client_with_blob(blob)),
        patch("pipeline_client.agent.agent._load_existing") as local_load,
    ):
        result = await handler._load_baseline("test-race", baseline_source="published")
    assert result == {}
    local_load.assert_not_called()


def test_local_loader_honors_published_baseline(tmp_path, monkeypatch):
    from pipeline_client.agent import agent as agent_module

    data = tmp_path / "data"
    (data / "drafts").mkdir(parents=True)
    (data / "published").mkdir(parents=True)
    (data / "drafts" / "r.json").write_text(json.dumps({"candidates": [{"name": "Draft"}]}))
    fake_file = tmp_path / "pipeline_client" / "agent" / "agent.py"
    monkeypatch.setattr(agent_module, "__file__", str(fake_file))

    assert agent_module._load_existing("r")["candidates"][0]["name"] == "Draft"
    assert agent_module._load_existing("r", baseline_source="published") is None
