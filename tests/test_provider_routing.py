"""Per-model OpenRouter provider preferences reach the request, and only for models that have one."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pipeline_client.agent.llm import _call_openrouter
from shared.model_catalog import MODEL_CATALOG, MODEL_PROVIDER_PREFERENCES, provider_routing_for


def _client():
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.usage = MagicMock(prompt_tokens=1, completion_tokens=1, cost=None)
    client = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=resp)
    return client


def test_every_preference_is_for_a_catalogued_model_and_keeps_fallbacks():
    for model_id, order in MODEL_PROVIDER_PREFERENCES.items():
        assert model_id in MODEL_CATALOG
        assert order
        routing = provider_routing_for(model_id)
        assert routing == {"order": list(order), "allow_fallbacks": True}


def test_routing_resolves_through_legacy_aliases():
    assert provider_routing_for("deepseek-v4.1-flash") == provider_routing_for("deepseek/deepseek-v4.1-flash")


def test_models_without_a_preference_get_no_routing():
    assert provider_routing_for("openai/gpt-6-luna") is None
    assert provider_routing_for(None) is None


@pytest.mark.asyncio
async def test_preference_is_sent_as_openrouter_provider_object():
    client = _client()
    with patch("pipeline_client.agent.llm._get_openrouter_client", return_value=client):
        await _call_openrouter([{"role": "user", "content": "hi"}], model="deepseek/deepseek-v4.1-flash")
    kwargs = client.chat.completions.create.call_args.kwargs
    assert kwargs["extra_body"] == {"provider": {"order": ["inference-net"], "allow_fallbacks": True}}


@pytest.mark.asyncio
async def test_no_extra_body_for_models_without_a_preference():
    client = _client()
    with patch("pipeline_client.agent.llm._get_openrouter_client", return_value=client):
        await _call_openrouter([{"role": "user", "content": "hi"}], model="openai/gpt-6-luna")
    assert "extra_body" not in client.chat.completions.create.call_args.kwargs
