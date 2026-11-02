"""Election-night chamber projection: called races are certain, everything else stays as forecast."""

import pytest

from shared.election_results import RESULT_STATUSES, WINNER_STATUSES
from shared.forecast_math import correlated_seat_distribution
from shared.forecast_summary import (
    LIVE_WINNER_STATUSES,
    SEAT_HOLDERS_UP,
    SENATE_HOLDOVERS,
    THRESHOLDS,
    apply_called_results,
    build_live_chamber_projection,
    called_result_party,
    summarize_chamber,
)

LIVE_FIELDS = ("control_party", "control_probability", "outcome_probabilities", "projected_seats", "seat_distribution")


def _slug(state):
    return state.lower().replace(" ", "-")


def _senate_race(state, index):
    dem_favored = index % 2 == 0
    dem = 0.55 + (index % 5) * 0.08 if dem_favored else 0.45 - (index % 5) * 0.08
    return {
        "id": f"{_slug(state)}-senate-2026",
        "title": f"{state} Senate",
        "office": "United States Senate",
        "state": state,
        "candidates": [
            {"name": f"Dana {state}", "party": "Democratic"},
            {"name": f"Riley {state}", "party": "Republican"},
        ],
        "forecast": {
            "predicted_winner_party": "Democratic" if dem_favored else "Republican",
            "party_probabilities": {"Democratic": round(dem, 3), "Republican": round(1 - dem, 3)},
            "rating": "lean_d" if dem_favored else "lean_r",
        },
    }


SENATE_STATES = sorted(SEAT_HOLDERS_UP["senate"])
SENATE_RACES = [_senate_race(state, index) for index, state in enumerate(SENATE_STATES)]


def _call(race, party="Democratic", status="called", **overrides):
    first = "Dana" if party == "Democratic" else "Riley"
    return {
        "id": race["id"],
        "status": status,
        "winner_name": f"{first} {race['state']}",
        "winner_party": party,
        "as_of": "2026-11-04T03:00:00Z",
        **overrides,
    }


def _index(*rows):
    return {"generated_at": "2026-11-04T03:01:00Z", "races": list(rows)}


def test_winner_statuses_match_the_results_module():
    assert LIVE_WINNER_STATUSES == WINNER_STATUSES


def test_a_called_race_becomes_certain_for_the_winner_party():
    race = SENATE_RACES[0]
    updated = apply_called_results(SENATE_RACES, _index(_call(race, "Republican")))
    called = next(row for row in updated if row["id"] == race["id"])
    assert called["forecast"]["party_probabilities"] == {"Democratic": 0.0, "Republican": 1.0, "Other": 0.0}
    assert called["forecast"]["predicted_winner_party"] == "Republican"
    # Every other race and the input itself are untouched.
    assert [row for row in updated if row["id"] != race["id"]] == SENATE_RACES[1:]
    assert race["forecast"]["predicted_winner_party"] == "Democratic"


@pytest.mark.parametrize("status", sorted(RESULT_STATUSES - WINNER_STATUSES))
def test_statuses_without_a_winner_are_ignored(status):
    race = SENATE_RACES[0]
    row = {"id": race["id"], "status": status, "winner_name": f"Riley {race['state']}", "winner_party": "Republican"}
    assert called_result_party(race, row) is None
    assert apply_called_results(SENATE_RACES, _index(row)) == SENATE_RACES


@pytest.mark.parametrize(
    "overrides",
    [
        {"winner_name": "Someone Else"},  # not on the roster
        {"winner_name": ""},
        {"winner_party": "Democratic"},  # contradicts the roster's Republican
    ],
)
def test_a_winner_whose_party_cannot_be_read_is_left_uncalled(overrides):
    race = SENATE_RACES[0]
    row = _call(race, "Republican", **overrides)
    assert called_result_party(race, row) is None
    live = build_live_chamber_projection(SENATE_RACES, _index(row))
    assert live["chambers"]["senate"]["called_count"] == 0


def test_an_unlabeled_roster_falls_back_to_the_result_party_but_not_to_nothing():
    race = {**SENATE_RACES[0], "candidates": [{"name": "Dana X", "party": None}, {"name": "Riley X", "party": "TBD"}]}
    assert called_result_party(race, {"status": "called", "winner_name": "Riley X", "winner_party": "Republican"}) == (
        "Republican"
    )
    assert called_result_party(race, {"status": "called", "winner_name": "Riley X"}) is None


def test_zero_calls_matches_the_pre_election_chamber_math():
    live = build_live_chamber_projection(SENATE_RACES, _index())
    baseline = summarize_chamber(SENATE_RACES, "senate")
    assert 0.01 < baseline["control_probability"] < 0.99
    for key in LIVE_FIELDS:
        assert live["chambers"]["senate"][key] == baseline[key], key
    assert live["chambers"]["senate"]["called_count"] == 0
    assert live["chambers"]["senate"]["total_count"] == len(SENATE_RACES)
    assert live["chambers"]["senate"]["as_of"] is None


def test_called_races_move_the_projection_and_report_progress():
    rows = [_call(race, "Republican", as_of=f"2026-11-04T0{i}:00:00Z") for i, race in enumerate(SENATE_RACES[:3])]
    live = build_live_chamber_projection(SENATE_RACES, _index(*rows))
    baseline = summarize_chamber(SENATE_RACES, "senate")
    senate = live["chambers"]["senate"]
    assert senate["called_count"] == 3
    assert senate["as_of"] == "2026-11-04T02:00:00Z"
    assert senate["outcome_probabilities"]["Republican"] > baseline["outcome_probabilities"]["Republican"]
    assert live["results_updated_at"] == "2026-11-04T03:01:00Z"
    # Other chambers have nothing to call here.
    assert live["chambers"]["house"]["called_count"] == 0


@pytest.mark.parametrize("winner", ["Democratic", "Republican"])
def test_every_race_called_makes_control_certain_and_counts_holdovers(winner):
    live = build_live_chamber_projection(SENATE_RACES, _index(*[_call(race, winner) for race in SENATE_RACES]))
    senate = live["chambers"]["senate"]
    assert senate["called_count"] == senate["total_count"] == len(SENATE_RACES)

    # Holdovers stay in the count: one seat per active state, both seats elsewhere.
    holdover_r = sum(
        parties[:1].count("Republican") if state in SEAT_HOLDERS_UP["senate"] else parties.count("Republican")
        for state, parties in SENATE_HOLDOVERS.items()
    )
    republican_seats = holdover_r + (len(SENATE_RACES) if winner == "Republican" else 0)
    assert senate["projected_seats"]["Republican"] == republican_seats
    assert senate["projected_seats"]["Democratic"] == 100 - republican_seats
    assert sum(senate["seat_distribution"].values()) == pytest.approx(1.0)
    assert len(senate["seat_distribution"]) == 1

    republican_control = republican_seats >= 50  # a 50-50 Senate goes to the VP tie-break party
    assert senate["control_party"] == ("Republican" if republican_control else "Democratic")
    assert senate["control_probability"] == 1.0
    assert senate["outcome_probabilities"]["Republican"] == (1.0 if republican_control else 0.0)
    assert senate["outcome_probabilities"]["Democratic"] == (0.0 if republican_control else 1.0)
    assert (republican_seats >= THRESHOLDS["senate"]) == (republican_control and republican_seats != 50)


def test_a_called_independent_seat_is_not_a_major_party_coin_flip():
    race = {
        **SENATE_RACES[0],
        "candidates": [{"name": "Indy Lane", "party": "Independent"}, {"name": "Riley X", "party": "Republican"}],
    }
    row = {"id": race["id"], "status": "called", "winner_name": "Indy Lane"}
    assert called_result_party(race, row) == "Other"
    called = apply_called_results([race], _index(row))[0]
    one = summarize_chamber([called], "senate", report_decided_exactly=True)
    # The Republican side gains nothing from this seat: the distribution is a point mass.
    assert len(one["seat_distribution"]) == 1


def test_a_same_party_contest_is_left_as_published():
    race = {
        "id": "ca-07-house-2026",
        "office": "U.S. House",
        "state": "California",
        "candidates": [{"name": "Ann A", "party": "Democratic"}, {"name": "Ben B", "party": "Democratic"}],
        "forecast": {"party_probabilities": {"Democratic": 1.0}, "win_probability": 0.6, "rating": "lean_d"},
    }
    row = {"id": race["id"], "status": "called", "winner_name": "Ben B", "winner_party": "Democratic"}
    assert apply_called_results([race], _index(row)) == [race]
    assert build_live_chamber_projection([race], _index(row))["chambers"]["house"]["called_count"] == 1


def test_certain_seats_shift_the_correlated_distribution_without_smearing():
    uncertain = correlated_seat_distribution([0.4, 0.7])
    with_certain = correlated_seat_distribution([1.0, 0.4, 0.0, 0.7, 1.0])
    assert with_certain[:2] == [0.0, 0.0]
    assert with_certain[2:5] == pytest.approx(uncertain)
    assert with_certain[5] == 0.0
