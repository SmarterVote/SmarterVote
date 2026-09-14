"""The panel forecast phase: independent estimates, a pinned writer, and a fact-check."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from pipeline_client.agent.phases.context import PhaseContext
from pipeline_client.agent.phases.forecast import (
    PANEL_METHOD,
    SINGLE_MODEL_METHOD,
    build_consensus,
    run_forecast_phase,
    same_party_contest,
)
from shared.model_catalog import FORECAST_PANEL_MODELS, SMALL_MODEL

WRITER = "test/writer"
STALE = "primaries remain unresolved (stale sentinel)"

PANEL_ESTIMATES = {
    FORECAST_PANEL_MODELS[0]: {"Democratic": 0.70, "Republican": 0.30},
    FORECAST_PANEL_MODELS[1]: {"Democratic": 0.62, "Republican": 0.38},
    FORECAST_PANEL_MODELS[2]: {"Democratic": 0.68, "Republican": 0.32},
}


def _race():
    return {
        "id": "nh-house-01-2026",
        "office": "U.S. House",
        "state": "New Hampshire",
        "contest_stage": "post_primary_general",
        "description": "Open seat after the September 8 primaries.",
        "candidates": [
            {"name": "Stefany Shaheen", "party": "Democratic"},
            {"name": "Anthony DiLorenzo", "party": "Republican"},
        ],
        "polling": [],
        "forecast": {
            "rating": "tilt_d",
            "confidence": "low",
            "takeaway": STALE,
            "party_probabilities": {"Democratic": 0.58, "Republican": 0.42},
            "generated_at": "2026-08-27T00:00:00Z",
            "model": "old/model",
        },
    }


def _ctx(race_json):
    names = [c["name"] for c in race_json["candidates"]]
    return PhaseContext(
        race_json=race_json,
        race_id=race_json["id"],
        model=WRITER,
        small_model=SMALL_MODEL,
        on_log=None,
        log=lambda *_a, **_kw: None,
        max_iterations=4,
        step_enabled=lambda _s: True,
        track=lambda *_a, **_kw: None,
        run_budget=None,
        is_update=True,
        candidate_names=names,
        selected_name_set=set(names),
        last_updated="",
        max_candidates=None,
        target_no_info=False,
        resume_partial=False,
        continue_incomplete_work=False,
    )


def _writer_args(rating="lean_d"):
    # The writer tries to set its own numbers; the panel's must win.
    return {
        "rating": rating,
        "confidence": "high",
        "rationale": "Shaheen starts with a structural edge.",
        "takeaway": "Shaheen is favored.",
        "based_on_poll_count": 0,
        "party_probabilities": {"Democratic": 0.99, "Republican": 0.01},
        "win_probability": 0.99,
        "predicted_winner_name": "Stefany Shaheen",
        "source_urls": [],
        "evidence_lineage": [],
    }


def _fake_loop(panel=PANEL_ESTIMATES, writer_rating="lean_d", silent_writers=(), check_issues=()):
    state = {"writers": [], "checks": 0, "prompts": [], "replies": []}

    async def fake(system, user, *, model, extra_tool_handlers=None, required_final_tool_name=None, **_kwargs):
        state["prompts"].append(user)
        if required_final_tool_name == "submit_forecast_estimate":
            estimate = panel.get(model)
            if estimate is not None:
                # A bare mapping is party probabilities; a mapping with either
                # probability field is the member's whole answer.
                answer = (
                    estimate
                    if {"party_probabilities", "candidate_probabilities"} & set(estimate)
                    else {"party_probabilities": estimate}
                )
                state["replies"].append(
                    extra_tool_handlers["submit_forecast_estimate"](
                        {
                            **answer,
                            "margin_estimate": 8.0,
                            "confidence": "low",
                            "key_considerations": ["D+2 district"],
                        }
                    )
                )
            return {}
        if required_final_tool_name == "set_forecast":
            state["writers"].append(model)
            if model not in silent_writers:
                extra_tool_handlers["set_forecast"](_writer_args(writer_rating))
            return {}
        state["checks"] += 1
        return {"issues": list(check_issues) if state["checks"] == 1 else []}

    return fake, state


async def _run(race_json, fake):
    with (
        patch("pipeline_client.agent.phases._agent_loop", new=fake),
        patch("pipeline_client.agent.phases.fetch_kalshi_market_signals", new=AsyncMock(return_value=[])),
    ):
        await run_forecast_phase(_ctx(race_json))


@pytest.mark.asyncio
async def test_forecast_publishes_the_panel_median_not_the_writers_numbers():
    race = _race()
    fake, _state = _fake_loop()
    await _run(race, fake)

    forecast = race["forecast"]
    assert forecast["party_probabilities"]["Democratic"] == pytest.approx(0.68, abs=0.005)
    assert forecast["win_probability"] == pytest.approx(0.68, abs=0.005)
    assert forecast["rating"] == "lean_d"
    # Members 8 points apart with no polling: agreement alone does not earn confidence.
    assert forecast["confidence"] == "low"
    assert forecast["margin_estimate"] == 8.0
    assert forecast["predicted_winner_name"] == "Stefany Shaheen"
    assert forecast["takeaway"] == "Shaheen is favored."
    assert forecast["method"] == PANEL_METHOD
    assert [member["model"] for member in forecast["panel"]] == list(FORECAST_PANEL_MODELS)
    assert forecast["panel_spread"] == pytest.approx(0.08)
    assert forecast["model"] == WRITER
    assert not race.get("pipeline_state", {}).get("step_failures")


@pytest.mark.asyncio
async def test_no_prompt_sees_the_previous_forecast():
    race = _race()
    fake, state = _fake_loop()
    await _run(race, fake)
    assert state["prompts"]
    assert not any(STALE in prompt for prompt in state["prompts"])


@pytest.mark.asyncio
async def test_a_writer_that_never_sets_the_forecast_falls_back_to_the_small_model():
    race = _race()
    fake, state = _fake_loop(silent_writers=(WRITER,))
    await _run(race, fake)
    assert state["writers"] == [WRITER, SMALL_MODEL]
    assert race["forecast"]["model"] == SMALL_MODEL
    assert race["forecast"]["takeaway"] == "Shaheen is favored."


@pytest.mark.asyncio
async def test_a_forecast_nobody_writes_is_a_recorded_failure_not_a_silent_success():
    """This is the NH-01 failure: the old forecast survived and the run reported healthy."""
    race = _race()
    fake, _state = _fake_loop(silent_writers=(WRITER, SMALL_MODEL))
    await _run(race, fake)
    assert race["forecast"]["takeaway"] == STALE
    failures = race["pipeline_state"]["step_failures"]
    assert [failure["step"] for failure in failures] == ["forecast"]


@pytest.mark.asyncio
async def test_a_writer_cannot_override_the_panel_rating():
    race = _race()
    fake, _state = _fake_loop(writer_rating="tilt_d")
    await _run(race, fake)
    assert race["forecast"]["takeaway"] == STALE
    assert race["pipeline_state"]["step_failures"][0]["step"] == "forecast"


@pytest.mark.asyncio
async def test_flagged_text_is_revised_and_rechecked():
    race = _race()
    fake, state = _fake_loop(check_issues=("Describes the primaries as unresolved.",))
    await _run(race, fake)
    assert state["writers"] == [WRITER, WRITER]
    assert state["checks"] == 2
    assert any("Describes the primaries as unresolved." in prompt for prompt in state["prompts"])
    assert not race.get("pipeline_state", {}).get("step_failures")


@pytest.mark.asyncio
async def test_text_still_flagged_after_revision_is_recorded():
    race = _race()
    fake, state = _fake_loop(check_issues=("Names a candidate who lost the primary.",))

    async def always_flagging(system, user, **kwargs):
        if kwargs.get("required_final_tool_name"):
            return await fake(system, user, **kwargs)
        state["checks"] += 1
        return {"issues": ["Names a candidate who lost the primary."]}

    await _run(race, always_flagging)
    assert race["pipeline_state"]["step_failures"][0]["reason"] == "forecast_text_unverified"


def test_unverified_forecast_text_degrades_a_run_rather_than_failing_it():
    """The reason must be a real RunFailureReason (an unknown string only warned and
    left the run "healthy"), and a prose quibble must not block publishing."""
    from shared.run_health import _HARD_FAILURE_REASONS, RunFailureReason

    assert RunFailureReason("forecast_text_unverified") is RunFailureReason.FORECAST_TEXT_UNVERIFIED
    assert RunFailureReason.FORECAST_TEXT_UNVERIFIED not in _HARD_FAILURE_REASONS


@pytest.mark.asyncio
async def test_without_a_panel_the_writer_sets_the_numbers_itself():
    race = _race()
    fake, _state = _fake_loop(panel={})
    await _run(race, fake)
    forecast = race["forecast"]
    assert forecast["method"] == SINGLE_MODEL_METHOD
    assert "panel" not in forecast
    assert forecast["party_probabilities"]["Democratic"] == pytest.approx(0.99)


def test_a_tossup_consensus_names_no_winner_party():
    members = [
        {"model": "a", "party_probabilities": {"Democratic": 0.50, "Republican": 0.50}},
        {"model": "b", "party_probabilities": {"Democratic": 0.53, "Republican": 0.47}},
        {"model": "c", "party_probabilities": {"Democratic": 0.49, "Republican": 0.51}},
    ]
    consensus = build_consensus(members, poll_count=6)
    assert consensus["rating"] == "tossup"
    assert consensus["predicted_winner_party"] == "Toss-up"
    assert consensus["confidence"] == "high"


def _same_party_race():
    race = _race()
    race.update(id="ca-house-11-2026", state="California", description="Top-two general between two Democrats.")
    race["candidates"] = [
        {"name": "Scott Wiener", "party": "Democratic"},
        {"name": "Connie Chan", "party": "Democrat"},
        {"name": "Bruce Lou", "party": "Republican", "withdrawn": True},
    ]
    return race


def test_same_party_contest_ignores_withdrawn_candidates():
    assert same_party_contest(_same_party_race()) == "Democratic"
    assert same_party_contest(_race()) is None
    solo = _same_party_race()
    solo["candidates"] = solo["candidates"][:1]
    assert same_party_contest(solo) is None
    # Two unknown parties are not the same party.
    unknown = _same_party_race()
    unknown["candidates"] = [{"name": "Alice Smith"}, {"name": "Bob Jones", "party": ""}]
    assert same_party_contest(unknown) is None


@pytest.mark.asyncio
async def test_a_same_party_race_forecasts_candidates_not_parties():
    # The three shapes members answered California's 11th in; before this fix
    # they became three different "parties" and a 20% "Democratic" consensus.
    answers = {
        FORECAST_PANEL_MODELS[0]: {"party_probabilities": {"Scott Wiener": 0.70, "Connie Chan": 0.30}},
        FORECAST_PANEL_MODELS[1]: {
            "candidate_probabilities": {"Scott Wiener (Democratic)": 0.66, "Connie Chan (Democratic)": 0.34}
        },
        FORECAST_PANEL_MODELS[2]: {
            "party_probabilities": {"Democratic": 1.0},
            "candidate_probabilities": {"Scott Wiener": 0.74, "Connie Chan": 0.26},
        },
    }
    race = _same_party_race()
    fake, state = _fake_loop(panel=answers)
    await _run(race, fake)

    forecast = race["forecast"]
    assert forecast["party_probabilities"] == {"Democratic": 1.0}
    assert forecast["win_probability"] == pytest.approx(0.70, abs=0.005)
    assert forecast["rating"] == "lean_d"
    assert forecast["predicted_winner_name"] == "Scott Wiener"
    assert forecast["predicted_winner_party"] == "Democratic"
    assert forecast["panel_spread"] == pytest.approx(0.08)
    assert [member["candidate_probabilities"]["Scott Wiener"] for member in forecast["panel"]] == [0.70, 0.66, 0.74]
    assert "every candidate in this race is a democratic candidate" in state["prompts"][0].lower()
    assert not race.get("pipeline_state", {}).get("step_failures")


@pytest.mark.asyncio
async def test_a_party_only_answer_to_a_same_party_race_is_refused():
    answers = {
        FORECAST_PANEL_MODELS[0]: {"candidate_probabilities": {"Scott Wiener": 0.70, "Connie Chan": 0.30}},
        FORECAST_PANEL_MODELS[1]: {"candidate_probabilities": {"Scott Wiener": 0.60, "Connie Chan": 0.40}},
        FORECAST_PANEL_MODELS[2]: {"party_probabilities": {"Democratic": 1.0}},
    }
    race = _same_party_race()
    fake, state = _fake_loop(panel=answers)
    await _run(race, fake)

    assert sum(reply.startswith("ERROR") for reply in state["replies"]) == 1
    assert [member["model"] for member in race["forecast"]["panel"]] == list(FORECAST_PANEL_MODELS[:2])


@pytest.mark.asyncio
async def test_candidate_name_keys_in_a_party_race_count_for_the_candidates_party():
    answers = dict(PANEL_ESTIMATES)
    answers[FORECAST_PANEL_MODELS[2]] = {"Stefany Shaheen": 0.68, "Anthony DiLorenzo (R)": 0.32}
    race = _race()
    fake, _state = _fake_loop(panel=answers)
    await _run(race, fake)

    forecast = race["forecast"]
    assert set(forecast["party_probabilities"]) == {"Democratic", "Republican"}
    assert forecast["party_probabilities"]["Democratic"] == pytest.approx(0.68, abs=0.005)
    assert forecast["panel"][2]["party_probabilities"] == {"Democratic": 0.68, "Republican": 0.32}


def test_a_close_same_party_race_names_no_winner():
    members = [
        {
            "model": name,
            "party_probabilities": {"Democratic": 1.0},
            "candidate_probabilities": {"Scott Wiener": wiener, "Connie Chan": round(1 - wiener, 2)},
            "margin_estimate": 1.0,
        }
        for name, wiener in (("a", 0.52), ("b", 0.50), ("c", 0.48))
    ]
    consensus = build_consensus(members, poll_count=0, same_party="Democratic")
    assert consensus["rating"] == "tossup"
    assert consensus["predicted_winner_name"] is None
    assert consensus["predicted_winner_party"] == "Democratic"
    assert consensus["party_probabilities"] == {"Democratic": 1.0}


TIGHT_PANEL = {
    FORECAST_PANEL_MODELS[0]: {"Democratic": 0.70, "Republican": 0.30},
    FORECAST_PANEL_MODELS[1]: {"Democratic": 0.68, "Republican": 0.32},
    FORECAST_PANEL_MODELS[2]: {"Democratic": 0.69, "Republican": 0.31},
}


def _polled_race(matchups):
    race = _race()
    race["polling"] = [
        {"pollster": f"Pollster {index}", "date": "2026-09-01", "sample_size": 500, "matchups": [matchup]}
        for index, matchup in enumerate(matchups)
    ]
    return race


@pytest.mark.asyncio
async def test_three_head_to_head_polls_and_a_tight_panel_earn_high_confidence():
    head_to_head = {"candidates": ["Stefany Shaheen", "Anthony DiLorenzo"], "percentages": [48, 44]}
    race = _polled_race([head_to_head, head_to_head, head_to_head])
    fake, _state = _fake_loop(panel=TIGHT_PANEL)
    await _run(race, fake)
    assert race["forecast"]["confidence"] == "high"


@pytest.mark.asyncio
async def test_single_candidate_primary_polls_do_not_count_toward_confidence():
    # Arizona's 1st: three primary polls, each reporting one candidate's share,
    # and no general-election poll.
    race = _polled_race(
        [
            {"candidates": ["Anthony DiLorenzo"], "percentages": [25]},
            {"candidates": ["Anthony DiLorenzo"], "percentages": [15]},
            {"candidates": ["Stefany Shaheen"], "percentages": [33]},
        ]
    )
    fake, _state = _fake_loop(panel=TIGHT_PANEL)
    await _run(race, fake)
    assert race["forecast"]["confidence"] == "medium"
