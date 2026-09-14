"""Numeric core of the forecasts: panel consensus, rating bands, and the
correlated seat distribution behind chamber control.

Everything here is deterministic and model-free. The pipeline uses it to turn
independent panel estimates into one race forecast, and the chamber roll-up
uses it to combine race probabilities into seat outcomes.
"""

from __future__ import annotations

import math
import statistics
from typing import Dict, List, Mapping, Optional, Sequence

MAJOR_PARTIES = ("Democratic", "Republican")

#: Rating bands keyed on the leading major party's win probability. They mirror
#: the bands the forecast prompt describes. The rating is *derived* from the
#: probability rather than chosen alongside it, so the two can never disagree —
#: a model once published "tilt_d" beside a 67% probability, which the bands
#: call "lean".
RATING_BANDS = ((0.95, "safe"), (0.80, "likely"), (0.65, "lean"), (0.55, "tilt"))

#: Standard deviation, in log-odds, of the shared national shift applied to
#: every race in a chamber. Polling misses are not independent from race to
#: race: a year that breaks toward one party breaks that way almost everywhere.
#: Treating races as independent coin flips (a plain Poisson binomial) made the
#: tails of the seat distribution far too thin and chamber control far too
#: certain. 0.6 moves a 50/50 race to roughly 35/65 at one standard deviation —
#: in line with a national environment missing by a few points — while every
#: race keeps its own published probability (see `_base_logit`).
NATIONAL_SWING_LOGIT_SD = 0.6

# Trapezoid grid over +/-4 standard deviations. The integrand is a smooth
# Gaussian, for which an evenly spaced grid is already spectrally accurate.
_GRID_STEP = 0.4
_GRID_Z = [i * _GRID_STEP for i in range(-10, 11)]

_PARTY_ALIASES = {
    "d": "Democratic",
    "dem": "Democratic",
    "democrat": "Democratic",
    "democratic": "Democratic",
    "r": "Republican",
    "rep": "Republican",
    "gop": "Republican",
    "republican": "Republican",
    "i": "Independent",
    "ind": "Independent",
    "independent": "Independent",
}


def normalize_party_label(label: object) -> str:
    """Map "Democrat", "GOP", "Libertarian Party" and friends onto one label."""
    raw = str(label or "").strip()
    key = raw.casefold()
    # "No Political Party" is a label, not "No Political" plus a suffix.
    if key.endswith(" party") and not key.startswith("no "):
        key = key[: -len(" party")].strip()
        raw = raw[: -len(" party")].strip()
    return _PARTY_ALIASES.get(key, raw or "Other")


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    z = math.exp(x)
    return z / (1.0 + z)


def _logit(p: float, floor: float = 1e-4) -> float:
    p = min(max(p, floor), 1.0 - floor)
    return math.log(p / (1.0 - p))


def normalize_probabilities(probs: Mapping[object, object]) -> Dict[str, float]:
    """Merge aliased party labels, drop non-numeric values, and rescale to sum to 1."""
    merged: Dict[str, float] = {}
    for party, value in probs.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if value < 0:
            continue
        label = normalize_party_label(party)
        merged[label] = merged.get(label, 0.0) + float(value)
    total = sum(merged.values())
    if total <= 0:
        return {}
    return {party: value / total for party, value in merged.items()}


def aggregate_panel(estimates: Sequence[Mapping[object, object]]) -> Dict[str, float]:
    """Combine independent panel estimates into one set of party probabilities.

    Each member's probabilities are normalized, then every party takes the
    median across members in log-odds space, and the result is renormalized.
    The median rather than the mean is deliberate: one member that misreads the
    race moves a mean but not a median. A party a member did not list counts as
    a near-zero probability from that member.
    """
    normalized = [normalize_probabilities(estimate) for estimate in estimates]
    normalized = [estimate for estimate in normalized if estimate]
    if not normalized:
        return {}
    parties = sorted({party for estimate in normalized for party in estimate})
    combined = {
        party: _sigmoid(statistics.median(_logit(estimate.get(party, 0.0)) for estimate in normalized)) for party in parties
    }
    total = sum(combined.values())
    return {party: round(value / total, 4) for party, value in combined.items()}


def leading_party(probs: Mapping[str, float]) -> Optional[str]:
    if not probs:
        return None
    return max(probs, key=lambda party: (probs[party], party in MAJOR_PARTIES))


def rating_for(probs: Mapping[str, float]) -> str:
    """The rating band implied by a set of party probabilities."""
    leader = leading_party(probs)
    if leader is None:
        return "tossup"
    if leader not in MAJOR_PARTIES:
        return "other"
    probability = probs[leader]
    suffix = "d" if leader == "Democratic" else "r"
    for threshold, band in RATING_BANDS:
        if probability >= threshold:
            return f"{band}_{suffix}"
    return "tossup"


def panel_spread(estimates: Sequence[Mapping[object, object]], party: Optional[str]) -> float:
    """How far apart the members were on the consensus leader's probability."""
    if not party:
        return 0.0
    values = [normalize_probabilities(estimate).get(party, 0.0) for estimate in estimates]
    if len(values) < 2:
        return 0.0
    return round(max(values) - min(values), 4)


def confidence_for(spread: float, poll_count: int, member_count: int) -> str:
    """Confidence in the probability itself, from panel agreement and polling depth.

    Agreement among models reading the same evidence is necessary but not
    sufficient: with no polling they all extrapolate from the same fundamentals,
    so an unpolled race never rates above "medium".
    """
    if member_count < 2 or spread > 0.12:
        return "low"
    if poll_count <= 0:
        return "medium" if spread <= 0.05 else "low"
    if spread <= 0.05 and poll_count >= 3:
        return "high"
    return "medium"


def consensus_margin(
    margins: Sequence[tuple[Optional[str], Optional[float]]], consensus_leader: Optional[str]
) -> Optional[float]:
    """Median margin, signed so a member that picked the other side pulls it toward zero."""
    signed = [
        (float(margin) if leader == consensus_leader else -float(margin))
        for leader, margin in margins
        if isinstance(margin, (int, float)) and not isinstance(margin, bool)
    ]
    if not signed:
        return None
    return round(max(0.0, statistics.median(signed)), 1)


def _grid(national_sd: float) -> List[tuple[float, float]]:
    weights = [math.exp(-0.5 * z * z) for z in _GRID_Z]
    total = sum(weights)
    return [(national_sd * z, weight / total) for z, weight in zip(_GRID_Z, weights)]


def _base_logit(probability: float, grid: Sequence[tuple[float, float]]) -> float:
    """Solve for b so that averaging sigmoid(b + shift) over the grid returns *probability*.

    Adding a symmetric shift to log-odds pulls every probability toward 50%
    (Jensen). Solving for the base instead keeps each race's published
    probability exactly, so the national term widens the joint distribution
    without quietly moving any single race.
    """
    b = _logit(probability, floor=1e-9)
    for _ in range(50):
        values = [(weight, _sigmoid(b + shift)) for shift, weight in grid]
        f = sum(weight * value for weight, value in values) - probability
        df = sum(weight * value * (1.0 - value) for weight, value in values)
        if df <= 1e-15:
            break
        step = f / df
        b -= step
        if abs(step) < 1e-12:
            break
    return b


def _poisson_binomial(probs: Sequence[float]) -> List[float]:
    dp = [1.0]
    for p in probs:
        q = 1.0 - p
        nxt = [0.0] * (len(dp) + 1)
        for j, value in enumerate(dp):
            if value:
                nxt[j] += value * q
                nxt[j + 1] += value * p
        dp = nxt
    return dp


def correlated_seat_distribution(probs: Sequence[float], national_sd: float = NATIONAL_SWING_LOGIT_SD) -> List[float]:
    """Probability of winning exactly j of the given races, for every j.

    Every uncertain race shares one national shift drawn from a normal
    distribution with standard deviation *national_sd* in log-odds; conditional
    on that shift the races are independent. With ``national_sd == 0`` this is
    exactly the Poisson binomial. Races that are already certain (probability 0
    or 1, e.g. uncontested or holdover-equivalent) do not swing.
    """
    if national_sd <= 0:
        return _poisson_binomial(probs)
    certain_wins = sum(1 for p in probs if p >= 1.0)
    uncertain = [p for p in probs if 0.0 < p < 1.0]
    size = len(probs) + 1
    if not uncertain:
        dist = [0.0] * size
        dist[certain_wins] = 1.0
        return dist

    grid = _grid(national_sd)
    bases = [_base_logit(p, grid) for p in uncertain]
    dist = [0.0] * size
    for shift, weight in grid:
        conditional = _poisson_binomial([_sigmoid(b + shift) for b in bases])
        for j, value in enumerate(conditional):
            dist[certain_wins + j] += weight * value
    total = sum(dist)
    return [value / total for value in dist] if total > 0 else dist
