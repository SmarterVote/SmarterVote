"""The run token ceiling has a hard stop, not just a finalization nudge."""

import pytest

from pipeline_client.agent import cost
from pipeline_client.agent.run_budget import RunBudgetExceeded
from shared.run_health import RunFailureReason, classify_exception


@pytest.fixture
def acc(monkeypatch):
    monkeypatch.setenv("PIPELINE_MAX_TOTAL_TOKENS", "100000")
    state = {"prompt_tokens": 0, "completion_tokens": 0}
    token = cost._cost_ctx.set(state)
    yield state
    cost._cost_ctx.reset(token)


def test_hard_limit_allows_spend_up_to_the_multiple(acc):
    acc["prompt_tokens"] = 125_000
    cost.enforce_total_token_hard_limit()  # exactly at 1.25x is still allowed


def test_hard_limit_raises_past_the_multiple(acc):
    acc["prompt_tokens"] = 120_000
    acc["completion_tokens"] = 6_000
    with pytest.raises(cost.TokenBudgetExceeded) as excinfo:
        cost.enforce_total_token_hard_limit()
    assert isinstance(excinfo.value, RunBudgetExceeded)
    assert classify_exception(excinfo.value) == RunFailureReason.BUDGET_EXHAUSTED


def test_hard_limit_noop_without_run_context():
    cost.enforce_total_token_hard_limit()


@pytest.mark.asyncio
async def test_call_openrouter_refuses_calls_past_hard_limit(acc, monkeypatch):
    from pipeline_client.agent import llm

    acc["prompt_tokens"] = 10_000_000

    def _no_client():
        raise AssertionError("must not reach the provider")

    monkeypatch.setattr(llm, "_get_openrouter_client", _no_client)
    with pytest.raises(cost.TokenBudgetExceeded):
        await llm._call_openrouter([{"role": "user", "content": "hi"}], model="openai/gpt-5-mini")


@pytest.mark.asyncio
async def test_handler_fails_instead_of_handing_off_on_token_hard_limit(monkeypatch, tmp_path):
    from unittest.mock import AsyncMock, patch

    from pipeline_client.backend.handlers.agent import AgentHandler

    monkeypatch.delenv("FIRESTORE_PROJECT", raising=False)
    handler = AgentHandler()
    with (
        patch.object(handler, "_load_existing_from_gcs", new_callable=AsyncMock, return_value=None),
        patch(
            "pipeline_client.agent.agent.run_agent",
            new_callable=AsyncMock,
            side_effect=cost.TokenBudgetExceeded("over"),
        ),
        patch("pipeline_client.agent.agent._load_existing", return_value=None),
    ):
        with pytest.raises(cost.TokenBudgetExceeded):
            await handler.handle({"race_id": "x-2026"}, {"run_id": "run-1", "deadline_at": 0})
