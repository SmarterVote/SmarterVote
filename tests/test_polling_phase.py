"""The polling phase must be offered the whole roster, not a run's research scope."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from pipeline_client.agent.phases.context import PhaseContext
from pipeline_client.agent.phases.polling import run_polling_phase

ROSTER = ["Michael Turner", "Kristina Knickerbocker", "Thomas McMasters"]


def _race():
    return {
        "id": "oh-house-10-2026",
        "candidates": [
            {"name": "Michael Turner", "party": "Republican"},
            {"name": "Kristina Knickerbocker", "party": "Democratic"},
            {"name": "Thomas McMasters", "party": "Libertarian"},
        ],
        "polling": [],
    }


def _ctx(race_json, scope):
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
        candidate_names=scope,
        selected_name_set=set(scope),
    )


async def _polling_prompt(scope):
    captured = {}

    async def fake(system, user, **_kwargs):
        captured["user"] = user
        return {}

    with patch("pipeline_client.agent.phases._agent_loop", new=fake):
        await run_polling_phase(_ctx(_race(), scope))
    return captured["user"]


@pytest.mark.asyncio
async def test_candidate_scoped_run_still_offers_polling_every_nominee():
    """A run scoped to one candidate must not hide the other nominees from polling.

    oh-house-10-2026 was re-researched for Thomas McMasters alone. The polling
    prompt was built from that one-name scope, so the model decided the real July
    2026 polls of Turner and Knickerbocker named candidates outside the race,
    rejected them, and the race lost both stored polls.
    """
    prompt = await _polling_prompt(["Thomas McMasters"])

    for name in ROSTER:
        assert name in prompt


@pytest.mark.asyncio
async def test_unscoped_run_offers_polling_the_same_roster():
    prompt = await _polling_prompt(ROSTER)

    for name in ROSTER:
        assert name in prompt
