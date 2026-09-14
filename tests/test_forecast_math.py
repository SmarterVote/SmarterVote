"""The numeric core behind race and chamber forecasts (shared/forecast_math.py)."""

import pytest

from shared.forecast_math import (
    _poisson_binomial,
    aggregate_panel,
    confidence_for,
    consensus_margin,
    correlated_seat_distribution,
    leading_party,
    normalize_probabilities,
    panel_spread,
    rating_for,
)


def _variance(dist):
    mean = sum(j * p for j, p in enumerate(dist))
    return sum((j - mean) ** 2 * p for j, p in enumerate(dist))


def test_normalize_merges_party_aliases_and_rescales():
    assert normalize_probabilities({"Democrat": 0.5, "GOP": 0.45, "Libertarian Party": 0.05}) == pytest.approx(
        {"Democratic": 0.5, "Republican": 0.45, "Libertarian": 0.05}
    )
    assert normalize_probabilities({"Democratic": 0.6, "Republican": 0.6}) == {"Democratic": 0.5, "Republican": 0.5}


def test_normalize_drops_values_that_are_not_probabilities():
    assert normalize_probabilities({"Democratic": "high", "Republican": True}) == {}


def test_aggregate_panel_takes_the_median_so_one_outlier_cannot_move_it():
    consensus = aggregate_panel(
        [
            {"Democratic": 0.52, "Republican": 0.48},
            {"Democratic": 0.55, "Republican": 0.45},
            {"Democratic": 0.95, "Republican": 0.05},
        ]
    )
    # A mean would land near 0.67; the median stays with the two members that agree.
    assert consensus["Democratic"] == pytest.approx(0.55, abs=0.005)
    assert sum(consensus.values()) == pytest.approx(1.0, abs=1e-3)


def test_aggregate_panel_counts_a_party_a_member_omitted_as_near_zero():
    consensus = aggregate_panel(
        [
            {"Democratic": 0.6, "Republican": 0.4},
            {"Democratic": 0.6, "Republican": 0.35, "Independent": 0.05},
            {"Democratic": 0.62, "Republican": 0.38},
        ]
    )
    assert consensus["Independent"] < 0.01
    assert leading_party(consensus) == "Democratic"


def test_aggregate_panel_of_nothing_is_empty():
    assert aggregate_panel([]) == {}
    assert aggregate_panel([{"Democratic": "n/a"}]) == {}


@pytest.mark.parametrize(
    "dem, expected",
    [
        (0.50, "tossup"),
        (0.549, "tossup"),
        (0.55, "tilt_d"),
        (0.649, "tilt_d"),
        (0.65, "lean_d"),
        (0.80, "likely_d"),
        (0.95, "safe_d"),
        (0.30, "lean_r"),
        (0.04, "safe_r"),
    ],
)
def test_rating_follows_the_published_bands(dem, expected):
    assert rating_for({"Democratic": dem, "Republican": 1 - dem}) == expected


def test_rating_is_other_when_a_non_major_candidate_leads():
    assert rating_for({"Independent": 0.5, "Republican": 0.3, "Democratic": 0.2}) == "other"


def test_panel_spread_is_the_gap_on_the_leaders_probability():
    estimates = [{"Democratic": 0.52, "Republican": 0.48}, {"Democratic": 0.60, "Republican": 0.40}]
    assert panel_spread(estimates, "Democratic") == pytest.approx(0.08)
    assert panel_spread(estimates[:1], "Democratic") == 0.0


@pytest.mark.parametrize(
    "spread, polls, members, expected",
    [
        (0.02, 5, 3, "high"),
        (0.08, 5, 3, "medium"),
        (0.20, 5, 3, "low"),
        (0.02, 0, 3, "medium"),
        (0.08, 0, 3, "low"),
        (0.00, 5, 1, "low"),
    ],
)
def test_confidence_reflects_agreement_and_polling_depth(spread, polls, members, expected):
    assert confidence_for(spread, polls, members) == expected


def test_consensus_margin_counts_a_dissenting_member_against_the_leader():
    assert consensus_margin([("Democratic", 4.0), ("Democratic", 2.0), ("Republican", 3.0)], "Democratic") == 2.0
    assert consensus_margin([("Democratic", None)], "Democratic") is None


def test_zero_national_swing_is_the_independent_poisson_binomial():
    probs = [0.2, 0.5, 0.9, 0.7]
    assert correlated_seat_distribution(probs, national_sd=0) == pytest.approx(_poisson_binomial(probs))


def test_national_swing_keeps_the_expected_seat_count():
    """Each race keeps its own probability, so expected seats cannot move."""
    probs = [0.1, 0.35, 0.5, 0.65, 0.9, 0.97] * 5
    dist = correlated_seat_distribution(probs)
    assert sum(dist) == pytest.approx(1.0)
    assert sum(j * p for j, p in enumerate(dist)) == pytest.approx(sum(probs), abs=1e-6)


def test_national_swing_widens_the_seat_distribution():
    """Forty coin flips that share a national environment spread far wider than forty independent ones."""
    probs = [0.5] * 40
    assert _variance(correlated_seat_distribution(probs)) > 2 * _variance(correlated_seat_distribution(probs, national_sd=0))


def test_national_swing_makes_a_lopsided_chamber_less_certain():
    """The independence assumption is what made House control read 96.6%."""
    probs = [0.7] * 60
    independent = correlated_seat_distribution(probs, national_sd=0)
    correlated = correlated_seat_distribution(probs)
    majority = 31
    assert sum(correlated[majority:]) < sum(independent[majority:])
    assert sum(correlated[majority:]) > 0.5


def test_certain_races_do_not_swing():
    dist = correlated_seat_distribution([1.0, 1.0, 0.0, 0.5])
    assert dist[0] == dist[1] == dist[4] == 0
    assert dist[2] == pytest.approx(0.5)
    assert dist[3] == pytest.approx(0.5)
