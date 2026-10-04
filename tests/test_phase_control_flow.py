"""Phases must not swallow control-flow exceptions (handoff, cancellation, budget)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from pipeline_client.agent.phases._common import _is_control_flow_exception
from pipeline_client.agent.phases.context import PhaseContext
from pipeline_client.agent.phases.polling import run_polling_phase
from pipeline_client.agent.phases.voter_resources import run_voter_resources_phase
from pipeline_client.backend.handlers.agent import AgentCancelled, HandoffFailed, HandoffTriggered


def _ctx(race_json):
    return PhaseContext(
        race_json=race_json,
        race_id=race_json["id"],
        model="writer",
        small_model="small",
        on_log=None,
        log=lambda *_a, **_kw: None,
        max_iterations=4,
        step_enabled=lambda _s: True,
        track=lambda *_a, **_kw: None,
        is_update=True,
        candidate_names=["A"],
        selected_name_set={"A"},
    )


def _race():
    return {"id": "x-house-01-2026", "candidates": [{"name": "A", "party": "Independent"}], "polling": []}


@pytest.mark.parametrize("phase", [run_polling_phase, run_voter_resources_phase])
@pytest.mark.parametrize(
    "exc",
    [AgentCancelled("stop"), HandoffFailed("no continuation"), HandoffTriggered("c1", ["polling"])],
)
@pytest.mark.asyncio
async def test_phases_reraise_control_flow(phase, exc):
    async def fake(*_a, **_kw):
        raise exc

    with patch("pipeline_client.agent.phases._agent_loop", new=fake):
        with pytest.raises(type(exc)):
            await phase(_ctx(_race()))


@pytest.mark.asyncio
async def test_phases_still_absorb_ordinary_errors():
    async def fake(*_a, **_kw):
        raise ValueError("provider hiccup")

    race = _race()
    with patch("pipeline_client.agent.phases._agent_loop", new=fake):
        await run_polling_phase(_ctx(race))
    assert any(f["step"] == "polling" for f in race["pipeline_state"]["step_failures"])


def test_control_flow_detection_includes_subclasses():
    from pipeline_client.agent.cost import TokenBudgetExceeded

    assert _is_control_flow_exception(TokenBudgetExceeded("x"))
    assert not _is_control_flow_exception(ValueError("x"))


@pytest.mark.asyncio
async def test_iteration_failures_are_recorded_as_step_failures():
    from pipeline_client.agent.phases.iteration import _run_iteration_pass

    race = {
        "id": "x-house-01-2026",
        "candidates": [{"name": "A", "issues": {}}],
        "pipeline_state": {"completed_units": []},
    }
    calls = {"n": 0}

    async def fake(*_a, **_kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("candidate pass blew up")
        return {}

    with patch("pipeline_client.agent.phases._agent_loop", new=fake):
        improved = await _run_iteration_pass("x-house-01-2026", race, [], model="writer")

    assert improved is not None
    for target in (race, improved):
        failures = target["pipeline_state"]["step_failures"]
        assert any(f["step"] == "iteration" and "candidate pass blew up" in f["detail"] for f in failures)


@pytest.mark.asyncio
async def test_iteration_reraises_handoff():
    from pipeline_client.agent.phases.iteration import _run_iteration_pass

    race = {"id": "x", "candidates": [{"name": "A"}], "pipeline_state": {"completed_units": []}}

    async def fake(*_a, **_kw):
        raise HandoffTriggered("c1", ["iteration"])

    with patch("pipeline_client.agent.phases._agent_loop", new=fake):
        with pytest.raises(HandoffTriggered):
            await _run_iteration_pass("x", race, [], model="writer")
