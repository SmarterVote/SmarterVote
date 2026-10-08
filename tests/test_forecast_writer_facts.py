"""Pre-computed poll and seat facts for the forecast writer, and its single repair retry.

About one forecast run in ten ended ``forecast_text_unverified``: the writer did
its own poll arithmetic (a 61-36 poll as an "18-point lead", NYT/Siena 44-49
with the sides swapped) or guessed seat control (a Republican "hold" of an open
Democratic seat), and the page lost its explanation.
"""

from __future__ import annotations

import pytest

from pipeline_client.agent.agent import _build_run_audit
from pipeline_client.agent.phases.forecast import forecast_facts_block, poll_facts
from shared.run_health import RunHealthStatus, compute_run_health_verdict
from tests.test_forecast_panel_phase import WRITER, _fake_loop, _race, _run, _writer_args


def _ks_race(polling=None, candidates=None):
    return {
        **_race(),
        "id": "ks-governor-2026",
        "office": "Governor",
        "state": "Kansas",
        "candidates": candidates
        or [
            {"name": "Cindy Holscher", "party": "Democratic"},
            {"name": "Ty Masterson", "party": "Republican"},
        ],
        "polling": polling or [],
    }


def _poll(pollster, date, names, shares):
    return {"pollster": pollster, "date": date, "matchups": [{"candidates": names, "percentages": shares}]}


def test_poll_facts_name_the_leader_and_compute_the_margin():
    race = _ks_race(
        polling=[
            _poll("Emerson", "2026-09-10", ["Ty Masterson", "Cindy Holscher"], [45, 45]),
            _poll("NYT/Siena", "2026-09-28", ["Cindy Holscher", "Ty Masterson"], [44, 49]),
            # A primary poll naming one current candidate is not a head-to-head.
            _poll("Primary Poll", "2026-09-30", ["Ty Masterson", "Someone Else"], [40, 20]),
            _poll("SurveyUSA", "2026-09-20", ["Cindy Holscher", "Ty Masterson"], [47.5, 44.2]),
        ]
    )
    facts = poll_facts(race)

    assert [fact["pollster"] for fact in facts] == ["NYT/Siena", "SurveyUSA", "Emerson"]
    siena, surveyusa, emerson = facts
    # The KS-Gov error: the sides must stay with their own shares.
    assert siena["shares"] == {"Cindy Holscher": 44, "Ty Masterson": 49}
    assert siena["leader"] == "Ty Masterson"
    assert siena["margin_points"] == 5
    assert siena["margin"] == "Ty Masterson +5"
    assert siena["end_date"] == "2026-09-28"
    assert surveyusa["margin"] == "Cindy Holscher +3.3"
    assert emerson["leader"] is None and emerson["margin"] == "tied"


def test_a_25_point_poll_is_reported_as_25_points_not_18():
    race = _ks_race(
        polling=[_poll("PPIC", "2026-09-15", ["Cindy Holscher", "Ty Masterson"], [61, 36])],
    )
    block = forecast_facts_block(race)
    assert "- PPIC, ended 2026-09-15: Cindy Holscher 61, Ty Masterson 36 -> margin Cindy Holscher +25" in block
    assert "(1 poll, margins already computed)" in block


def test_open_seat_facts_name_the_holder_and_every_incumbent_flag():
    block = forecast_facts_block(_ks_race())
    assert "Seat status: open seat, currently Democratic-held (incumbent not running)." in block
    assert "Only the Democratic side holds this seat now" in block
    assert "this is an open seat" in block
    assert "- Cindy Holscher (Democratic): not an incumbent." in block
    assert "- Ty Masterson (Republican): not an incumbent." in block
    # The "a primary survey is logged" error: an empty list says so outright.
    assert "Head-to-head polls of the current candidates: none logged." in block


def test_a_running_incumbent_holds_the_seat_and_the_challenger_is_not_an_incumbent():
    race = _ks_race(
        candidates=[
            {"name": "Cindy Holscher", "party": "Democratic", "incumbent": True},
            {"name": "Ty Masterson", "party": "Republican"},
        ]
    )
    block = forecast_facts_block(race)
    assert "Seat status: currently Democratic-held." in block
    assert "Only the Democratic side holds this seat now" in block
    assert "open seat" not in block
    assert "- Cindy Holscher (Democratic): incumbent." in block
    assert "- Ty Masterson (Republican): not an incumbent." in block


def test_a_seat_with_no_recorded_holder_forbids_any_hold_language():
    block = forecast_facts_block(_race())  # NH-01: an open House seat, no holder table.
    assert "No party is recorded as holding this seat" in block
    assert "Only the" not in block


@pytest.mark.asyncio
async def test_writer_and_check_prompts_carry_the_computed_facts():
    race = _ks_race(polling=[_poll("NYT/Siena", "2026-09-28", ["Cindy Holscher", "Ty Masterson"], [44, 49])])
    fake, state = _fake_loop()
    seen = []

    async def recording(system, user, **kwargs):
        if kwargs.get("required_final_tool_name") != "submit_forecast_estimate":
            seen.append(user)
        return await fake(system, user, **kwargs)

    await _run(race, recording)
    assert len(seen) == 2  # writer, then the fact-check
    assert all("margin Ty Masterson +5" in prompt for prompt in seen)


def _repairing_loop(check_results, revised_takeaway="Shaheen is favored in this open seat."):
    """A writer whose second call writes different text, and a check that returns *check_results* in order."""
    fake, state = _fake_loop()
    state["phases"] = []
    results = list(check_results)

    async def loop(system, user, **kwargs):
        if kwargs.get("required_final_tool_name") == "set_forecast":
            state["phases"].append(kwargs.get("phase_name"))
            if len(state["writers"]) == 1:
                state["writers"].append(kwargs["model"])
                state["prompts"].append(user)
                kwargs["extra_tool_handlers"]["set_forecast"]({**_writer_args(), "takeaway": revised_takeaway})
                return {}
        if kwargs.get("required_final_tool_name"):
            return await fake(system, user, **kwargs)
        state["checks"] += 1
        return {"issues": results.pop(0) if results else []}

    return loop, state


@pytest.mark.asyncio
async def test_a_repaired_text_that_passes_is_kept_with_no_fallback():
    race = _race()
    loop, state = _repairing_loop([["Says Fox shows a double-digit lead; Fox is +9."], []])
    await _run(race, loop)

    assert state["writers"] == [WRITER, WRITER]  # same model for the repair
    assert state["checks"] == 2
    assert state["phases"] == ["update-forecast", "update-forecast-revision"]
    revision_prompt = state["prompts"][-1]
    assert "Says Fox shows a double-digit lead; Fox is +9." in revision_prompt
    assert "Correct only the flagged claims" in revision_prompt
    # The repair sees the text it is correcting.
    assert '"takeaway": "Shaheen is favored."' in revision_prompt
    forecast = race["forecast"]
    assert forecast["takeaway"] == "Shaheen is favored in this open seat."
    assert forecast["rationale"] == "Shaheen starts with a structural edge."
    assert not race.get("pipeline_state", {}).get("step_failures")
    verdict = compute_run_health_verdict(race, should_review=False)
    assert verdict.status == RunHealthStatus.HEALTHY


@pytest.mark.asyncio
async def test_a_repair_that_still_fails_falls_back_and_degrades_the_run_after_exactly_one_retry():
    race = _race()
    flagged = ["Calls the open seat a Democratic hold."]
    loop, state = _repairing_loop([flagged, flagged, flagged, flagged])
    await _run(race, loop)

    # One draft, one repair, two checks: never a second repair.
    assert state["writers"] == [WRITER, WRITER]
    assert state["checks"] == 2
    forecast = race["forecast"]
    assert forecast["takeaway"] == "Stefany Shaheen (Democratic) is favored, with a 68% chance of winning."
    failures = race["pipeline_state"]["step_failures"]
    assert [(f["step"], f["reason"]) for f in failures] == [("forecast", "forecast_text_unverified")]
    assert "Calls the open seat a Democratic hold." in failures[0]["detail"]
    verdict = compute_run_health_verdict(race, should_review=False)
    assert verdict.status == RunHealthStatus.DEGRADED
    audit = _build_run_audit(None, race)
    assert any("did not pass its fact-check after one revision" in note for note in audit["forecast_changes"])
