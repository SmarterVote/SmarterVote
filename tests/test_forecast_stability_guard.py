"""Forecast reruns on unchanged evidence may not churn the published numbers."""

from __future__ import annotations

import copy
from dataclasses import replace

import pytest

from pipeline_client.agent.agent import _build_run_audit
from pipeline_client.agent.phases.forecast import (
    PANEL_METHOD,
    STABILIZED_PANEL_METHOD,
    apply_stability_guard,
    build_consensus,
    forecast_evidence_key,
)
from shared.forecast_math import cap_probability_shift, forecast_probability_shift, poll_identity
from tests.test_forecast_panel_phase import _ctx, _fake_loop, _race


def _poll(pollster="Emerson", date="2026-09-20", d=46, r=44):
    return {
        "pollster": pollster,
        "date": date,
        "matchups": [{"candidates": ["Stefany Shaheen", "Anthony DiLorenzo"], "percentages": [d, r]}],
        "source_url": f"https://example.org/{pollster}",
    }


def _member(d):
    return {"model": f"m{d}", "party_probabilities": {"Democratic": d, "Republican": round(1 - d, 4)}, "margin_estimate": 8.0}


# --- shared.forecast_math -------------------------------------------------------------


def test_poll_identity_ignores_order_case_and_duplicates():
    a = [_poll("Emerson", "2026-09-20"), _poll("Siena", "2026-09-01")]
    b = [_poll("siena ", "2026-09-01T00:00:00Z"), _poll("EMERSON", "2026-09-20"), _poll("Emerson", "2026-09-20")]
    assert poll_identity(a) == poll_identity(b)
    assert poll_identity(a) != poll_identity(a + [_poll("Quinnipiac", "2026-09-25")])
    assert poll_identity(None) == poll_identity([]) == frozenset()


def test_cap_probability_shift_holds_the_prior_leader_within_the_band():
    capped = cap_probability_shift({"Republican": 0.58, "Democratic": 0.42}, {"Republican": 0.66, "Democratic": 0.34})
    assert capped == {"Republican": 0.62, "Democratic": 0.38}
    down = cap_probability_shift({"Democratic": 0.60, "Republican": 0.40}, {"Democratic": 0.775, "Republican": 0.225})
    assert down["Democratic"] == pytest.approx(0.64)
    # Within the band: nothing to cap.
    assert cap_probability_shift({"Democratic": 0.60, "Republican": 0.40}, {"Democratic": 0.63, "Republican": 0.37}) is None
    assert cap_probability_shift({}, {"Democratic": 0.6}) is None


def test_forecast_probability_shift_measures_the_prior_leader():
    before = {"party_probabilities": {"Republican": 0.68, "Democratic": 0.32}}
    after = {"party_probabilities": {"Republican": 0.58, "Democratic": 0.42}}
    assert forecast_probability_shift(before, after) == pytest.approx(0.10)
    assert forecast_probability_shift(None, after) is None
    assert forecast_probability_shift(
        {"win_probability": 0.6, "predicted_winner_party": "Republican"},
        {"win_probability": 0.7, "predicted_winner_party": "Republican"},
    ) == pytest.approx(0.1)


# --- apply_stability_guard ----------------------------------------------------------


def _ar02():
    race = _race()
    race["polling"] = [_poll()]
    race["forecast"] = {
        "rating": "tilt_r",
        "party_probabilities": {"Republican": 0.58, "Democratic": 0.42},
        "margin_estimate": 4.0,
    }
    return race


def test_guard_caps_churn_on_an_unchanged_poll_set_and_keeps_the_rating():
    race = _ar02()
    baseline = copy.deepcopy(race["forecast"])
    evidence = forecast_evidence_key(race)
    consensus = build_consensus([_member(0.34), _member(0.34), _member(0.30)], poll_count=1)
    assert consensus["rating"] == "lean_r"  # 66% Republican: the observed churn

    note = apply_stability_guard(consensus, baseline, evidence, race)

    assert note and "Stability guard" in note
    assert consensus["party_probabilities"]["Republican"] == pytest.approx(0.62)
    assert consensus["win_probability"] == pytest.approx(0.62)
    assert consensus["rating"] == "tilt_r"
    assert consensus["predicted_winner_party"] == "Republican"
    assert consensus["margin_estimate"] == 6.0  # held within 2 points of the baseline's 4.0


def test_guard_lets_a_capped_move_cross_a_band_threshold():
    race = _ar02()
    race["forecast"]["party_probabilities"] = {"Republican": 0.63, "Democratic": 0.37}
    consensus = build_consensus([_member(0.25), _member(0.25), _member(0.25)], poll_count=1)
    apply_stability_guard(consensus, copy.deepcopy(race["forecast"]), forecast_evidence_key(race), race)
    assert consensus["party_probabilities"]["Republican"] == pytest.approx(0.67)
    assert consensus["rating"] == "lean_r"


@pytest.mark.parametrize(
    "change",
    [
        lambda race: race["polling"].append(_poll("Siena", "2026-10-01")),
        lambda race: race["candidates"].append({"name": "New Independent", "party": "Independent"}),
        lambda race: race.update({"contest_stage": "runoff"}),
    ],
)
def test_guard_stands_aside_when_evidence_changed(change):
    race = _ar02()
    baseline = copy.deepcopy(race["forecast"])
    evidence = forecast_evidence_key(race)
    change(race)
    consensus = build_consensus([_member(0.34)] * 3, poll_count=1)
    assert apply_stability_guard(consensus, baseline, evidence, race) is None
    assert consensus["rating"] == "lean_r"


@pytest.mark.parametrize("relabel", ["Nonpartisan", "No Party Affiliation", "unaffiliated", "Independent Party"])
def test_guard_treats_unaffiliated_ballot_labels_as_the_same_roster(relabel):
    # NE-Sen: discovery relabeled Dan Osborn "Independent" -> "Nonpartisan" and the
    # guard read it as a roster change, letting the forecast drift 0.58 -> 0.64.
    race = _ar02()
    race["candidates"].append({"name": "Dan Osborn", "party": "Independent"})
    baseline = copy.deepcopy(race["forecast"])
    evidence = forecast_evidence_key(race)
    race["candidates"][-1]["party"] = relabel
    consensus = build_consensus([_member(0.34)] * 3, poll_count=1)
    assert apply_stability_guard(consensus, baseline, evidence, race)
    assert consensus["party_probabilities"]["Republican"] == pytest.approx(0.62)


def test_guard_still_sees_a_real_party_change():
    race = _ar02()
    race["candidates"].append({"name": "Dan Osborn", "party": "Independent"})
    evidence = forecast_evidence_key(race)
    race["candidates"][-1]["party"] = "Democratic"
    assert forecast_evidence_key(race) != evidence


def test_guard_does_nothing_without_a_baseline_or_inside_the_band():
    race = _ar02()
    evidence = forecast_evidence_key(race)
    consensus = build_consensus([_member(0.34)] * 3, poll_count=1)
    assert apply_stability_guard(consensus, None, evidence, race) is None
    assert apply_stability_guard(consensus, copy.deepcopy(race["forecast"]), None, race) is None
    small = build_consensus([_member(0.40)] * 3, poll_count=1)
    assert apply_stability_guard(small, copy.deepcopy(race["forecast"]), evidence, race) is None
    assert small["party_probabilities"]["Republican"] == pytest.approx(0.60)


def test_guard_skips_same_party_races():
    race = _ar02()
    consensus = {"candidate_probabilities": {"A": 0.8, "B": 0.2}, "party_probabilities": {"Republican": 1.0}}
    assert apply_stability_guard(consensus, copy.deepcopy(race["forecast"]), forecast_evidence_key(race), race) is None


# --- the phase end to end -----------------------------------------------------------


async def _run_with_baseline(race_json, fake, *, resume_partial=False):
    from unittest.mock import AsyncMock, patch

    from pipeline_client.agent.phases.forecast import run_forecast_phase

    ctx = replace(
        _ctx(race_json),
        baseline_forecast=copy.deepcopy(race_json["forecast"]),
        baseline_forecast_evidence=forecast_evidence_key(race_json),
        resume_partial=resume_partial,
    )
    with (
        patch("pipeline_client.agent.phases._agent_loop", new=fake),
        patch("pipeline_client.agent.phases.fetch_kalshi_market_signals", new=AsyncMock(return_value=[])),
    ):
        await run_forecast_phase(ctx)


@pytest.mark.asyncio
async def test_phase_publishes_the_capped_numbers_and_records_the_guard():
    race = _race()  # baseline tilt_d at 58% D, no polls; the panel median is 68% D (lean_d)
    baseline = copy.deepcopy(race)
    fake, _state = _fake_loop(writer_rating="tilt_d")
    await _run_with_baseline(race, fake)

    forecast = race["forecast"]
    assert forecast["party_probabilities"]["Democratic"] == pytest.approx(0.62)
    assert forecast["rating"] == "tilt_d"
    assert forecast["method"] == STABILIZED_PANEL_METHOD
    audit = _build_run_audit(baseline, race)
    assert any("Stability guard applied" in change for change in audit["forecast_changes"])


@pytest.mark.asyncio
async def test_phase_does_not_cap_a_resumed_partial_run():
    race = _race()
    fake, _state = _fake_loop(writer_rating="lean_d")
    await _run_with_baseline(race, fake, resume_partial=True)
    assert race["forecast"]["rating"] == "lean_d"
    assert race["forecast"]["method"] == PANEL_METHOD
