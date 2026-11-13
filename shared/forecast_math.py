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

# One major-party vocabulary for the pipeline and the chamber roll-up
# (`shared.forecast_summary.classify_party`), mirrored by `partyFromLabel` in
# web/src/lib/utils/forecast.ts. State affiliates of the two major parties
# ("Democratic-Farmer-Labor", "Democratic-NPL", "Republican Party") are the
# national party: kept as labels of their own they split a race's probability
# mass and rate the Democratic nominee "other" (MN Senate 2026).
DEMOCRATIC_PARTY_LABELS = frozenset({"d", "dem", "dfl"})
REPUBLICAN_PARTY_LABELS = frozenset({"r", "rep", "gop"})

_PARTY_ALIASES = {
    "i": "Independent",
    "ind": "Independent",
    "independent": "Independent",
}


def major_party(label: object) -> Optional[str]:
    """The canonical "Democratic" or "Republican" when *label* names either party or a state affiliate of one, else None."""
    value = str(label or "").strip().casefold()
    if value in DEMOCRATIC_PARTY_LABELS or "democrat" in value:
        return "Democratic"
    if value in REPUBLICAN_PARTY_LABELS or "republican" in value:
        return "Republican"
    return None


def normalize_party_label(label: object) -> str:
    """Map "Democrat", "GOP", "Democratic-Farmer-Labor", "Libertarian Party" and friends onto one label."""
    major = major_party(label)
    if major:
        return major
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


#: How far past a band edge a rerun's probability must land before the rating
#: leaves the baseline's band. Panel jitter near an edge used to flip ratings
#: against the new evidence: FL-Gov went Lean R 0.794 -> Likely R 0.800 after a
#: tighter-than-average poll, WI-Gov Lean D 0.79 -> Likely D 0.82, SD-AL Safe R
#: -> Likely R despite a +28 poll. The probability still updates; only the label
#: is sticky, and never more than this far from its own band.
RATING_HYSTERESIS = 0.025


def _rating_band(rating: object) -> Optional[tuple[Optional[str], float, float]]:
    """``(party, low, high)`` for a party rating such as ``"lean_r"``: *party*'s probability spans ``[low, high)``.

    A toss-up has no party, and its range is the leader's. None for "other" or an unknown label.
    """
    if rating == "tossup":
        return None, 0.0, RATING_BANDS[-1][0]
    if not isinstance(rating, str):
        return None
    band, _, suffix = rating.partition("_")
    party = {"d": "Democratic", "r": "Republican"}.get(suffix)
    upper = 1.0
    for threshold, name in RATING_BANDS:
        if name == band and party:
            return party, threshold, upper
        upper = threshold
    return None


def rating_with_hysteresis(probs: Mapping[str, float], prior_rating: object, margin: float = RATING_HYSTERESIS) -> str:
    """The rating for *probs*, kept at *prior_rating* unless the probability clears its band by *margin*.

    Symmetric for both parties and in both directions. A rating that would
    cross from one party to the other, or that "other" describes, is never held.
    """
    rating = rating_for(probs)
    band = _rating_band(prior_rating)
    if rating == prior_rating or rating == "other" or band is None:
        return rating
    party, low, high = band
    normalized = normalize_probabilities(probs)
    if party is None:
        leader = leading_party(normalized)
        held = leader in MAJOR_PARTIES and normalized[leader] < round(high + margin, 4)
    else:
        held = round(low - margin, 4) <= normalized.get(party, 0.0) < round(high + margin, 4)
    return str(prior_rating) if held else rating


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


#: Largest move in the reference party's win probability a rerun may make when
#: nothing it reads has changed. Reruns on an identical poll set moved AR-02 from
#: 58% to 66% and CA-06 from 60% to 77.5% purely by re-reasoning; the panel's
#: run-to-run noise is real, but publishing it as a shift in the race is not.
STABILITY_MAX_SHIFT = 0.04


def _poll_key_text(value: object) -> str:
    return " ".join(str(value or "").casefold().split())


def poll_identity(polls: object) -> frozenset:
    """The identity of a poll set: one ``(pollster, date)`` per poll, order-insensitive.

    Two races whose polling lists differ only in order, casing, or duplicated
    entries have the same identity. A poll with neither pollster nor date falls
    back to its source URL so it is still counted.
    """
    keys = set()
    for poll in polls if isinstance(polls, list) else []:
        if not isinstance(poll, dict):
            continue
        pollster = _poll_key_text(poll.get("pollster"))
        date = _poll_key_text(poll.get("date"))[:10]
        if pollster or date:
            keys.add((pollster, date))
        elif poll.get("source_url"):
            keys.add(("", _poll_key_text(poll.get("source_url"))))
    return frozenset(keys)


def _forecast_probabilities(forecast: Mapping[str, object]) -> Dict[str, float]:
    candidate = forecast.get("candidate_probabilities")
    if isinstance(candidate, Mapping) and candidate:
        values = {
            str(name): float(value)
            for name, value in candidate.items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        }
        total = sum(values.values())
        return {name: value / total for name, value in values.items()} if total > 0 else {}
    parties = forecast.get("party_probabilities")
    return normalize_probabilities(parties) if isinstance(parties, Mapping) else {}


def forecast_probability_shift(before: object, after: object) -> Optional[float]:
    """How far *after* moved the probability of *before*'s leader. None when either side is unusable."""
    if not isinstance(before, Mapping) or not isinstance(after, Mapping):
        return None
    before_probs = _forecast_probabilities(before)
    after_probs = _forecast_probabilities(after)
    if before_probs and after_probs:
        reference = leading_party(before_probs)
        if reference is not None:
            return abs(after_probs.get(reference, 0.0) - before_probs[reference])
    before_p, after_p = before.get("win_probability"), after.get("win_probability")
    if (
        isinstance(before_p, (int, float))
        and isinstance(after_p, (int, float))
        and before.get("predicted_winner_party") == after.get("predicted_winner_party")
    ):
        return abs(float(after_p) - float(before_p))
    return None


def rating_band_bounds(probability: float) -> tuple[float, float]:
    """The ``[low, high]`` leader-probability range that keeps *probability*'s rating band."""
    upper = 1.0
    for threshold, _band in RATING_BANDS:
        if probability >= threshold:
            return threshold, upper
        upper = round(threshold - 0.0001, 4)
    return 0.0, upper


#: How far renormalizing rounded stored probabilities can move a value; a stored
#: rating further than this from its own probability is not trusted.
_RATING_ROUNDING_TOLERANCE = 0.001


def _rating_bounds(rating: Optional[str], leader: str, probability: float) -> Optional[tuple[float, float]]:
    """The range of a stored rating such as ``"lean_d"``, when it fits *leader* and, up to rounding, *probability*."""
    if not isinstance(rating, str):
        return None
    if rating == "tossup":
        bounds = rating_band_bounds(0.0)
    else:
        band, _, suffix = rating.partition("_")
        threshold = next((threshold for threshold, name in RATING_BANDS if name == band), None)
        if threshold is None or suffix != {"Democratic": "d", "Republican": "r"}.get(leader):
            return None
        bounds = rating_band_bounds(threshold)
    low, high = bounds
    if not low - _RATING_ROUNDING_TOLERANCE <= probability <= high + _RATING_ROUNDING_TOLERANCE:
        return None
    return bounds


def cap_probability_shift(
    prior: Mapping[object, object],
    new: Mapping[object, object],
    max_shift: float = STABILITY_MAX_SHIFT,
    keep_band: bool = False,
    prior_rating: Optional[str] = None,
) -> Optional[Dict[str, float]]:
    """*new* party probabilities with the prior leader's probability held within *max_shift* of *prior*.

    With *keep_band*, the prior leader's probability is also held inside the
    prior's rating band, so a small move cannot change the rating by itself.
    Pass the prior's published *prior_rating* when there is one: stored
    probabilities are rounded, so renormalizing them can nudge a value on a band
    edge into the band below (FL-25: Lean D at 0.65 summed to 1.0001, read as
    0.64994, and the guard let a no-new-poll rerun fall to Tilt D).
    Returns None when no cap is needed (the move is already within the limits)
    or either side is unusable. Other parties are rescaled proportionally so the
    result still sums to 1.
    """
    prior_probs = normalize_probabilities(prior)
    new_probs = normalize_probabilities(new)
    reference = leading_party(prior_probs)
    if not prior_probs or not new_probs or reference is None:
        return None
    anchor = prior_probs[reference]
    proposed = new_probs.get(reference, 0.0)
    low, high = anchor - max_shift, anchor + max_shift
    if keep_band:
        band_low, band_high = _rating_bounds(prior_rating, reference, anchor) or rating_band_bounds(anchor)
        low, high = max(low, band_low), min(high, band_high)
    capped = min(max(proposed, low), high)
    capped = min(max(capped, 0.0), 1.0)
    if abs(capped - proposed) < 1e-9:
        return None
    others = {party: value for party, value in new_probs.items() if party != reference}
    others_total = sum(others.values())
    if others_total <= 0:
        # The new estimate gave everyone else zero; split the remainder as the prior did.
        others = {party: value for party, value in prior_probs.items() if party != reference}
        others_total = sum(others.values())
    result = {reference: capped}
    if others_total > 0:
        for party, value in others.items():
            result[party] = (1.0 - capped) * value / others_total
    return {party: round(value, 4) for party, value in result.items()}


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


def correlated_seat_distribution(
    probs: Sequence[float],
    national_sd: float = NATIONAL_SWING_LOGIT_SD,
    swing_weights: Optional[Sequence[float]] = None,
) -> List[float]:
    """Probability of winning exactly j of the given races, for every j.

    Every uncertain race shares one national shift drawn from a normal
    distribution with standard deviation *national_sd* in log-odds; conditional
    on that shift the races are independent. With ``national_sd == 0`` this is
    exactly the Poisson binomial. Races that are already certain (probability 0
    or 1, e.g. uncontested or holdover-equivalent) do not swing.

    *swing_weights*, when given, replaces the prior weight of each grid point
    (one per point, in grid order; see :func:`swing_posterior`). *probs* stay
    the pre-election probabilities: each race's base logit is solved against
    the prior grid exactly as without weights, and only the weighting of the
    national shift changes.
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
    for shift, weight in _weighted(grid, swing_weights):
        conditional = _poisson_binomial([_sigmoid(b + shift) for b in bases])
        for j, value in enumerate(conditional):
            dist[certain_wins + j] += weight * value
    total = sum(dist)
    return [value / total for value in dist] if total > 0 else dist


# ---------------------------------------------------------------------------
# Learning the national swing from called races (election night)
# ---------------------------------------------------------------------------
#
# The shared national shift above is a prior: before any votes are counted it
# is N(0, NATIONAL_SWING_LOGIT_SD) on the quadrature grid. A called race is a
# noisy observation of that shift. Conditional on shift z, the winning party
# had probability sigmoid(b + s*z) of winning, where b is the race's base logit
# for that party (solved on the prior grid, exactly as in the seat math) and s
# is +1 for Republicans, -1 for Democrats (positive z is a Republican-ward
# shift). Multiplying the prior grid weights by those likelihoods and
# normalizing gives the posterior over the same grid, which the chamber math
# then uses for every uncalled race.

#: Below this many informative calls the posterior is not used at all.
SWING_MIN_INFORMATIVE_CALLS = 5
#: A call is informative when the winner's pre-election probability was below this.
SWING_INFORMATIVE_MAX_PROBABILITY = 0.97
#: Power applied to the log-likelihood. Calls are not independent draws given
#: the national shift: neighbouring races share regional and demographic
#: swings the one-factor model leaves out, so treating each call as a full
#: observation would overstate the evidence. 0.5 counts each call as half an
#: independent race, so one or two surprises (or one region reporting first)
#: cannot swing everything.
SWING_LIKELIHOOD_POWER = 0.5
#: Floor on the posterior standard deviation of the shift, in log-odds. Early
#: calls are biased toward easy, lopsided races and toward the states that
#: count first, so the evidence is never allowed to pin the national shift
#: down more tightly than this. When the tempered posterior is narrower, the
#: likelihood power is lowered further (by bisection) until it is not.
SWING_POSTERIOR_MIN_SD = 0.15


def _weighted(grid: Sequence[tuple[float, float]], weights: Optional[Sequence[float]]) -> List[tuple[float, float]]:
    if weights is None:
        return list(grid)
    if len(weights) != len(grid):
        raise ValueError(f"expected {len(grid)} swing weights, got {len(weights)}")
    return [(shift, float(weight)) for (shift, _), weight in zip(grid, weights)]


def _log_sigmoid(x: float) -> float:
    return -(max(-x, 0.0) + math.log1p(math.exp(-abs(x))))


def _moments(shifts: Sequence[float], weights: Sequence[float]) -> tuple[float, float]:
    mean = sum(w * z for z, w in zip(shifts, weights))
    var = sum(w * (z - mean) ** 2 for z, w in zip(shifts, weights))
    return mean, math.sqrt(max(var, 0.0))


def _tempered(log_prior: Sequence[float], log_lik: Sequence[float], power: float) -> List[float]:
    logs = [lp + power * ll for lp, ll in zip(log_prior, log_lik)]
    top = max(logs)
    raw = [math.exp(value - top) for value in logs]
    total = sum(raw)
    return [value / total for value in raw]


def swing_posterior(
    evidence: Sequence[tuple[float, str]],
    national_sd: float = NATIONAL_SWING_LOGIT_SD,
    *,
    min_informative: int = SWING_MIN_INFORMATIVE_CALLS,
    likelihood_power: float = SWING_LIKELIHOOD_POWER,
    min_sd: float = SWING_POSTERIOR_MIN_SD,
) -> Dict[str, object]:
    """Posterior over the national shift given called races.

    *evidence* holds one ``(probability, party)`` pair per called race: the
    winning major party and its pre-election probability of winning. Pairs
    whose probability is not strictly between 0 and 1, or whose party is not
    Democratic or Republican, carry no information and are dropped.

    Returns ``weights`` (one per grid point, for
    :func:`correlated_seat_distribution`; the prior's when ``applied`` is
    False), the posterior ``mean_logit`` / ``sd_logit`` of the shift (positive
    is Republican-ward), ``informative_calls``, ``calls`` (usable calls) and the
    ``likelihood_power`` actually used.
    """
    grid = _grid(national_sd)
    shifts = [shift for shift, _ in grid]
    prior = [weight for _, weight in grid]
    usable = [
        (float(p), 1.0 if party == "Republican" else -1.0)
        for p, party in evidence
        if party in MAJOR_PARTIES and isinstance(p, (int, float)) and 0.0 < float(p) < 1.0
    ]
    informative = sum(1 for p, _ in usable if p < SWING_INFORMATIVE_MAX_PROBABILITY)
    prior_mean, prior_sd = _moments(shifts, prior)
    result: Dict[str, object] = {
        "applied": False,
        "weights": prior,
        "mean_logit": prior_mean,
        "sd_logit": prior_sd,
        "prior_sd_logit": prior_sd,
        "informative_calls": informative,
        "calls": len(usable),
        "likelihood_power": 0.0,
    }
    if national_sd <= 0 or informative < min_informative:
        return result

    log_prior = [math.log(weight) for weight in prior]
    log_lik = [0.0] * len(grid)
    for p, sign in usable:
        base = _base_logit(p, grid)
        for k, shift in enumerate(shifts):
            log_lik[k] += _log_sigmoid(base + sign * shift)

    power = likelihood_power
    weights = _tempered(log_prior, log_lik, power)
    mean, sd = _moments(shifts, weights)
    if sd < min_sd < prior_sd:
        low, high = 0.0, power
        for _ in range(60):
            mid = 0.5 * (low + high)
            if _moments(shifts, _tempered(log_prior, log_lik, mid))[1] >= min_sd:
                low = mid
            else:
                high = mid
        power = low
        weights = _tempered(log_prior, log_lik, power)
        mean, sd = _moments(shifts, weights)
    result.update(applied=True, weights=weights, mean_logit=mean, sd_logit=sd, likelihood_power=power)
    return result


def posterior_probability(
    probability: float, swing_weights: Sequence[float], sign: float = 1.0, national_sd: float = NATIONAL_SWING_LOGIT_SD
) -> float:
    """A race's win probability under *swing_weights* instead of the prior.

    *probability* is the pre-election probability for a party whose chances
    rise with the shift when *sign* is +1 (Republican) and fall when it is -1
    (Democratic). Certain probabilities (0 or 1) come back unchanged.
    """
    if not 0.0 < probability < 1.0 or national_sd <= 0:
        return probability
    grid = _grid(national_sd)
    base = _base_logit(probability, grid)
    return sum(weight * _sigmoid(base + sign * shift) for shift, weight in _weighted(grid, swing_weights))
