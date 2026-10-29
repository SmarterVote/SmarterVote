"""A rerun's rating leaves the baseline's band only when the probability clears it by a margin."""

from __future__ import annotations

import copy

import pytest

from pipeline_client.agent.phases.forecast import (
    PANEL_METHOD,
    apply_rating_hysteresis,
    apply_stability_guard,
    build_consensus,
    forecast_evidence_key,
)
from shared.forecast_math import RATING_HYSTERESIS, rating_for, rating_with_hysteresis
from shared.model_catalog import FORECAST_PANEL_MODELS
from tests.test_forecast_panel_phase import _fake_loop, _race
from tests.test_forecast_stability_guard import _member, _poll, _run_with_baseline


def _r(p):
    return {"Republican": p, "Democratic": round(1 - p, 4)}


def _d(p):
    return {"Democratic": p, "Republican": round(1 - p, 4)}


# --- shared.forecast_math.rating_with_hysteresis --------------------------------------


def test_fl_like_edge_crossing_keeps_lean_r():
    # FL-Gov: Lean R at 0.794, rerun lands at 0.800 (plain bands: Likely R).
    assert rating_for(_r(0.800)) == "likely_r"
    assert rating_with_hysteresis(_r(0.800), "lean_r") == "lean_r"
    assert rating_with_hysteresis(_r(0.824), "lean_r") == "lean_r"


def test_clear_crossing_changes_the_rating():
    assert rating_with_hysteresis(_r(0.83), "lean_r") == "likely_r"
    assert rating_with_hysteresis(_r(0.825), "lean_r") == "likely_r"
    assert rating_with_hysteresis(_r(0.62), "lean_r") == "tilt_r"


def test_symmetric_for_democrats():
    # WI-Gov: Lean D 0.79 -> 0.82 after a tighter-than-average poll.
    assert rating_with_hysteresis(_d(0.82), "lean_d") == "lean_d"
    assert rating_with_hysteresis(_d(0.83), "lean_d") == "likely_d"
    assert rating_with_hysteresis(_d(0.63), "lean_d") == "lean_d"
    assert rating_with_hysteresis(_d(0.62), "lean_d") == "tilt_d"


def test_downgrade_near_the_safe_edge_keeps_safe():
    # SD-AL: Safe R 0.96 -> 0.945 despite a +28 poll.
    assert rating_for(_r(0.945)) == "likely_r"
    assert rating_with_hysteresis(_r(0.945), "safe_r") == "safe_r"
    assert rating_with_hysteresis(_r(0.925), "safe_r") == "safe_r"
    assert rating_with_hysteresis(_r(0.92), "safe_r") == "likely_r"


@pytest.mark.parametrize("prior", [None, "", "other", "bogus", "lean_x", 0.8])
def test_no_usable_prior_rating_uses_plain_bands(prior):
    for probs in (_r(0.800), _d(0.945), _d(0.56), _r(0.5)):
        assert rating_with_hysteresis(probs, prior) == rating_for(probs)


def test_tossup_boundaries():
    # Out of a toss-up: the leader must reach 0.575 either way.
    assert rating_with_hysteresis(_d(0.56), "tossup") == "tossup"
    assert rating_with_hysteresis(_r(0.574), "tossup") == "tossup"
    assert rating_with_hysteresis(_d(0.575), "tossup") == "tilt_d"
    assert rating_with_hysteresis(_r(0.58), "tossup") == "tilt_r"
    # Into a toss-up: the prior party must fall below 0.525.
    assert rating_with_hysteresis(_r(0.53), "tilt_r") == "tilt_r"
    assert rating_with_hysteresis(_r(0.52), "tilt_r") == "tossup"
    assert rating_with_hysteresis(_d(0.53), "tilt_d") == "tilt_d"


def test_never_holds_a_rating_for_the_party_now_trailing():
    assert rating_with_hysteresis(_d(0.52), "tilt_r") == "tossup"
    assert rating_with_hysteresis(_r(0.56), "tilt_d") == "tilt_r"
    assert rating_with_hysteresis(_d(0.70), "lean_r") == "lean_d"


def test_hysteresis_with_third_parties():
    probs = {"Democratic": 0.80, "Republican": 0.18, "Libertarian": 0.02}
    assert rating_with_hysteresis(probs, "lean_d") == "lean_d"
    assert rating_with_hysteresis({"Independent": 0.6, "Republican": 0.4}, "tilt_r") == "other"


def test_margin_constant_is_in_the_requested_range():
    assert 0.02 <= RATING_HYSTERESIS <= 0.03


# --- apply_rating_hysteresis -----------------------------------------------------------


def test_apply_keeps_the_label_but_not_the_probability():
    consensus = build_consensus([_member(0.20)] * 3, poll_count=3)  # 0.80 Republican
    assert consensus["rating"] == "likely_r"
    note = apply_rating_hysteresis(consensus, {"rating": "lean_r", "party_probabilities": _r(0.794)})
    assert note and note.startswith("Rating hysteresis")
    assert consensus["rating"] == "lean_r"
    assert consensus["win_probability"] == pytest.approx(0.80)
    assert consensus["predicted_winner_party"] == "Republican"


def test_apply_holds_a_tossup_without_naming_a_winner():
    consensus = build_consensus([_member(0.56)] * 3, poll_count=3)
    assert consensus["rating"] == "tilt_d"
    assert apply_rating_hysteresis(consensus, {"rating": "tossup"})
    assert consensus["rating"] == "tossup"
    assert consensus["predicted_winner_party"] == "Toss-up"


def test_apply_without_a_baseline_or_on_a_clear_move_does_nothing():
    consensus = build_consensus([_member(0.20)] * 3, poll_count=3)
    assert apply_rating_hysteresis(consensus, None) is None
    clear = build_consensus([_member(0.17)] * 3, poll_count=3)
    assert apply_rating_hysteresis(clear, {"rating": "lean_r"}) is None
    assert clear["rating"] == "likely_r"


def test_apply_skips_same_party_races():
    consensus = {"candidate_probabilities": {"A": 0.81, "B": 0.19}, "party_probabilities": {"Republican": 1.0}}
    assert apply_rating_hysteresis(consensus, {"rating": "lean_r"}) is None


# --- directional guard, mirror case: new polls tighter than the baseline margin --------


def _fl_gov():
    race = _race()
    race["polling"] = [_poll("Emerson", "2026-10-01", 42, 50), _poll("Siena", "2026-09-20", 43, 49)]
    race["forecast"] = {"rating": "lean_r", "party_probabilities": _r(0.794), "margin_estimate": 6.0}
    return race


def _rerun(race, added, panel_d):
    baseline = copy.deepcopy(race["forecast"])
    evidence = forecast_evidence_key(race)
    race["polling"].append(added)
    consensus = build_consensus([_member(panel_d)] * 3, poll_count=len(race["polling"]))
    note = apply_stability_guard(consensus, baseline, evidence, race)
    return note, apply_rating_hysteresis(consensus, baseline), consensus


def test_mirror_guard_stops_a_rise_on_a_tighter_poll():
    # Donalds 48-46 (+2), tighter than the baseline's +6, yet the panel rose to 0.83.
    note, hysteresis, consensus = _rerun(_fl_gov(), _poll("Cygnal", "2026-10-20", 46, 48), 0.17)
    assert note and note.startswith("Directional guard: 1 new poll(s) all show Republican below baseline margin 6")
    assert consensus["party_probabilities"]["Republican"] == pytest.approx(0.7999)
    assert consensus["rating"] == "lean_r"
    assert hysteresis is None


def test_mirror_guard_leaves_a_rise_backed_by_a_stronger_poll():
    note, hysteresis, consensus = _rerun(_fl_gov(), _poll("Cygnal", "2026-10-20", 40, 52), 0.17)
    assert note is None and hysteresis is None
    assert consensus["rating"] == "likely_r"
    assert consensus["party_probabilities"]["Republican"] == pytest.approx(0.83)


def test_mirror_guard_is_symmetric_for_democrats():
    # WI-Gov: Crowley 48-45 (+3) vs a Marquette +7 baseline.
    race = _race()
    race["polling"] = [_poll("Marquette", "2026-10-01", 50, 43)]
    race["forecast"] = {"rating": "lean_d", "party_probabilities": _d(0.79), "margin_estimate": 7.0}
    note, _hysteresis, consensus = _rerun(race, _poll("Wick", "2026-10-20", 48, 45), 0.82)
    assert note and "show Democratic below baseline margin 7" in note
    assert consensus["rating"] == "lean_d"
    assert consensus["party_probabilities"]["Democratic"] == pytest.approx(0.7999)


# --- the phase end to end -----------------------------------------------------------


@pytest.mark.asyncio
async def test_phase_publishes_the_held_rating_with_the_panel_probability():
    race = _race()  # the fixture's generated_at is past the guard's age limit
    race["forecast"].update({"rating": "lean_d", "party_probabilities": _d(0.79)})
    panel = {model: _d(0.81) for model in FORECAST_PANEL_MODELS}
    fake, _state = _fake_loop(panel=panel, writer_rating="lean_d")
    await _run_with_baseline(race, fake)
    forecast = race["forecast"]
    assert forecast["rating"] == "lean_d"
    assert forecast["win_probability"] == pytest.approx(0.81)
    assert forecast["method"] == PANEL_METHOD
