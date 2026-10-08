"""Phase 4b: the race forecast.

Three models from different developers (``FORECAST_PANEL_MODELS``) each
estimate the race independently — numbers only, without seeing one another or
the previous forecast. Their median is the forecast: the rating is derived from
it and confidence from how far apart they were (``shared.forecast_math``). A
writer then explains that consensus in prose without being able to change its
numbers, and a fact-check sends back text that contradicts the race.

Two failures shaped this. A single model's forecast carried that model's lean,
and because the previous forecast was fed back in as context it also carried
the old numbers forward: New Hampshire's 1st stayed "tilt D, primaries
unresolved" for a week after its primary. And the single call could spend its
whole output budget before calling set_forecast, which ended the loop as a
success and left the stale forecast in place while the run reported healthy.
"""

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence

from shared.forecast_math import (
    RATING_BANDS,
    STABILITY_MAX_SHIFT,
    aggregate_panel,
    cap_probability_shift,
    confidence_for,
    consensus_margin,
    leading_party,
    normalize_party_label,
    normalize_probabilities,
    panel_spread,
    poll_identity,
    rating_for,
)
from shared.forecast_summary import _seat_holder, seat_control_note
from shared.model_catalog import FORECAST_PANEL_MODELS, SMALL_MODEL
from shared.run_health import RunFailureReason

from ..handlers import _make_editing_handlers
from ..prompts import (
    FORECAST_CHECK_SYSTEM,
    FORECAST_CHECK_USER,
    FORECAST_PANEL_SAME_PARTY_NOTE,
    FORECAST_PANEL_SYSTEM,
    FORECAST_PANEL_USER,
    FORECAST_REVISION_USER,
    FORECAST_SYSTEM,
    FORECAST_USER,
    FORECAST_WRITER_SAME_PARTY_NOTE,
)
from ..run_budget import RunBudgetExceeded
from ..tools import FORECAST_PANEL_TOOLS, FORECAST_TOOLS, READ_PROFILE_TOOL
from ._common import _await_with_run_budget, _classify_exception, _race_identity_context, _record_step_failure
from .context import PhaseContext

PANEL_METHOD = "panel_median_v1"
#: The panel median, with its move from the baseline forecast capped by the
#: stability guard because nothing the forecast reads had changed.
STABILIZED_PANEL_METHOD = "panel_median_v1_stabilized"
#: Companion cap on the margin, in points, when the stability guard applies.
STABILITY_MAX_MARGIN_SHIFT = 2.0
SINGLE_MODEL_METHOD = "single_model"

#: Output budgets. The writer used to get 4096 tokens, and on some races a model
#: spent all of them reasoning and stopped (finish=length) without a tool call.
PANEL_MAX_TOKENS = 8192
WRITER_MAX_TOKENS = 12288
CHECK_MAX_TOKENS = 4096

_MAX_CHECK_POLLS = 12
_MAX_CHECK_DESCRIPTION_CHARS = 2500
_MAX_CHECK_ISSUES = 6


def _compact_candidates(race_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            "name": candidate.get("name"),
            "party": candidate.get("party"),
            "incumbent": candidate.get("incumbent", False),
            "withdrawn": candidate.get("withdrawn", False),
            "summary": candidate.get("summary", ""),
            "donor_summary": candidate.get("donor_summary"),
            "voting_summary": candidate.get("voting_summary"),
        }
        for candidate in race_json.get("candidates", [])
        if isinstance(candidate, dict)
    ]


def _seat_control_line(race_json: Dict[str, Any]) -> str:
    """Who holds the seat now, so the prose can tell a hold from a flip.

    Candidates carry only their own incumbent flag, so an open seat reached the
    writer with no holder at all. The Kansas governor forecast, an open
    Democratic-held seat, said Republicans were "favored to hold" it, and a goal
    stating the holder did not correct it.
    """
    return f"\nSeat control: {seat_control_note(race_json)}."


def _race_prompt_fields(race_json: Dict[str, Any], race_id: str, market_signals: List[Dict[str, Any]]) -> Dict[str, str]:
    """The race facts every forecast prompt shares. Deliberately excludes the previous forecast."""
    return {
        "race_id": race_id,
        "current_date": datetime.now(timezone.utc).date().isoformat(),
        "office": race_json.get("office") or "",
        "jurisdiction": race_json.get("jurisdiction") or "",
        "state": race_json.get("state") or "",
        "district": race_json.get("district") or "",
        "description": race_json.get("description") or "",
        "race_identity_context": _race_identity_context(race_json) + _seat_control_line(race_json),
        "candidates_json": json.dumps(_compact_candidates(race_json), indent=2, default=str),
        "polling_note": race_json.get("polling_note") or "",
        "polling_json": json.dumps(race_json.get("polling", []), indent=2, default=str),
        "market_signals_json": json.dumps(market_signals, indent=2, default=str),
    }


def _phase_name(ctx: PhaseContext, suffix: str = "") -> str:
    return f"{'update-' if ctx.is_update else ''}forecast{suffix}"


def _active_candidates(race_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        candidate
        for candidate in race_json.get("candidates", [])
        if isinstance(candidate, dict) and not candidate.get("withdrawn") and str(candidate.get("name") or "").strip()
    ]


def same_party_contest(race_json: Dict[str, Any]) -> Optional[str]:
    """The one party every active candidate shares, or None.

    A top-two or jungle general between co-partisans (California's 11th: two
    Democrats) has a certain party outcome, so a party-level estimate is
    meaningless there; the panel has to estimate candidates instead.
    """
    active = _active_candidates(race_json)
    # A candidate with no recorded party is unknown, not a match for another one.
    if len(active) < 2 or any(not str(candidate.get("party") or "").strip() for candidate in active):
        return None
    parties = {normalize_party_label(candidate.get("party")) for candidate in active}
    if len(parties) == 1:
        return next(iter(parties))
    return None


_TRAILING_PARENTHETICAL = re.compile(r"\s*\([^)]*\)\s*$")


def _name_key(value: Any) -> str:
    """The comparison key for a candidate name: case-folded, without a trailing "(Democratic)"."""
    return _TRAILING_PARENTHETICAL.sub("", str(value or "")).strip().casefold()


def _numeric(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return float(value)


def _to_party_probabilities(raw: Dict[str, Any], race_json: Dict[str, Any]) -> Dict[str, float]:
    """A member's party probabilities, with any candidate-name keys mapped to that candidate's party.

    Members sometimes answer by candidate ("Stefany Shaheen": 0.7) even when
    asked by party; left alone, those keys become parties of their own and
    split the consensus.
    """
    party_of = {_name_key(c["name"]): normalize_party_label(c.get("party")) for c in _active_candidates(race_json)}
    merged: Dict[str, float] = {}
    for key, value in (raw or {}).items():
        amount = _numeric(value)
        if amount is None:
            continue
        label = party_of.get(_name_key(key), key)
        merged[label] = merged.get(label, 0.0) + amount
    return normalize_probabilities(merged)


def _to_candidate_probabilities(raw: Dict[str, Any], race_json: Dict[str, Any]) -> Dict[str, float]:
    """A member's per-candidate probabilities, keyed by exact roster name. Unknown keys are dropped."""
    roster = {_name_key(c["name"]): c["name"] for c in _active_candidates(race_json)}
    merged: Dict[str, float] = {}
    for key, value in (raw or {}).items():
        name = roster.get(_name_key(key))
        amount = _numeric(value)
        if name is None or amount is None:
            continue
        merged[name] = merged.get(name, 0.0) + amount
    total = sum(merged.values())
    return {name: round(value / total, 4) for name, value in merged.items()} if total > 0 else {}


def _head_to_head_poll_count(race_json: Dict[str, Any]) -> int:
    """Polls with at least one matchup between two or more current candidates.

    A primary poll that reports one candidate's share ("Jay Feely 25%") says
    nothing about the general election. Arizona's 1st had three and no
    general-election poll, and counting them rated its forecast "high"
    confidence, which an unpolled race never gets.
    """
    roster = {_name_key(candidate["name"]) for candidate in _active_candidates(race_json)}
    count = 0
    for poll in race_json.get("polling") or []:
        matchups = poll.get("matchups") if isinstance(poll, dict) else None
        if any(
            isinstance(matchup, dict) and len({_name_key(name) for name in matchup.get("candidates") or []} & roster) >= 2
            for matchup in matchups or []
        ):
            count += 1
    return count


def _share_text(value: float) -> str:
    return f"{round(value, 1):g}"


def poll_facts(race_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Pre-computed arithmetic for each head-to-head poll of the current candidates, newest first.

    The writer used to read raw percentages and subtract them itself, and got it
    wrong: California's governor "18-point lead" from a 61-36 poll, Kansas's
    NYT/Siena 44-49 written with the sides swapped, a 53-44 Fox poll counted
    among "double-digit" leads. Each fact carries the shares, the leader and the
    margin already computed, so the prose only has to copy them.
    """
    roster = {_name_key(candidate["name"]): candidate["name"] for candidate in _active_candidates(race_json)}
    facts: List[Dict[str, Any]] = []
    for poll in race_json.get("polling") or []:
        if not isinstance(poll, dict):
            continue
        for matchup in poll.get("matchups") or []:
            if not isinstance(matchup, dict):
                continue
            names = matchup.get("candidates") or []
            shares = matchup.get("percentages") or []
            if len(names) != len(shares):
                continue
            pairs = []
            for name, share in zip(names, shares):
                full = roster.get(_name_key(name))
                value = _numeric(share)
                if full and value is not None:
                    pairs.append((full, value))
            if len(pairs) < 2:
                continue
            ranked = sorted(pairs, key=lambda pair: pair[1], reverse=True)
            margin = round(ranked[0][1] - ranked[1][1], 1)
            facts.append(
                {
                    "pollster": str(poll.get("pollster") or "").strip() or "Unnamed pollster",
                    "end_date": str(poll.get("date") or "").strip()[:10] or "undated",
                    "shares": dict(pairs),
                    "leader": ranked[0][0] if margin > 0 else None,
                    "margin_points": margin,
                    "margin": f"{ranked[0][0]} +{_share_text(margin)}" if margin > 0 else "tied",
                }
            )
            break  # One matchup per poll: the first with two current candidates.
    facts.sort(key=lambda fact: "" if fact["end_date"] == "undated" else fact["end_date"], reverse=True)
    return facts


def _poll_fact_line(fact: Dict[str, Any]) -> str:
    shares = ", ".join(f"{name} {_share_text(value)}" for name, value in fact["shares"].items())
    return f"- {fact['pollster']}, ended {fact['end_date']}: {shares} -> margin {fact['margin']}"


def _seat_fact_lines(race_json: Dict[str, Any]) -> List[str]:
    """Seat status, who may be said to "hold" it, and each candidate's incumbent flag.

    The fact-check caught "a safe Democratic hold" for a Republican seat, a
    Republican "hold" of an open seat, and "both nominees are incumbents" when
    the roster marked one as a challenger.
    """
    holder, incumbent_running = _seat_holder(race_json)
    lines = [f"- Seat status: {seat_control_note(race_json)}."]
    if holder is None:
        lines.append(
            "- No party is recorded as holding this seat: never say a party will hold, keep, retain or defend it; "
            "call it an open seat."
        )
    else:
        side = "independent" if holder == "Other" else holder
        lines.append(
            f"- Only the {side} side holds this seat now, so only it can hold, keep, retain or defend it; "
            "a win by anyone else is a pickup (flip)."
        )
        if not incumbent_running:
            lines.append("- No incumbent is on the ballot: this is an open seat.")
    for candidate in _active_candidates(race_json):
        status = "incumbent" if candidate.get("incumbent") else "not an incumbent"
        lines.append(f"- {candidate['name']} ({candidate.get('party') or 'no party listed'}): {status}.")
    return lines


def forecast_facts_block(race_json: Dict[str, Any]) -> str:
    """The pre-computed facts the forecast writer and its fact-check use instead of their own arithmetic."""
    facts = poll_facts(race_json)
    lines = ["Seat and incumbency:", *_seat_fact_lines(race_json), ""]
    if facts:
        lines.append(
            f"Head-to-head polls of the current candidates, newest first ({_plural(len(facts), 'poll')}, "
            "margins already computed):"
        )
        lines.extend(_poll_fact_line(fact) for fact in facts)
    else:
        lines.append(
            "Head-to-head polls of the current candidates: none logged. Do not describe a poll of these candidates "
            "or a poll margin."
        )
    return "\n".join(lines)


async def _panel_member(
    ctx: PhaseContext, agent_loop: Callable, model: str, prompt: str, same_party: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    captured: Dict[str, Any] = {}

    def submit_forecast_estimate(args: Dict[str, Any]) -> str:
        candidate_probabilities: Optional[Dict[str, float]] = None
        if same_party:
            candidate_probabilities = _to_candidate_probabilities(
                args.get("candidate_probabilities") or {}, ctx.race_json
            ) or _to_candidate_probabilities(args.get("party_probabilities") or {}, ctx.race_json)
            if not candidate_probabilities:
                return (
                    f"ERROR: Every candidate in this race is a {same_party} candidate. Put each candidate's chance of "
                    "winning in candidate_probabilities, keyed by the exact names in the roster."
                )
            probabilities = {same_party: 1.0}
        else:
            probabilities = _to_party_probabilities(args.get("party_probabilities") or {}, ctx.race_json)
            if not probabilities:
                return "ERROR: party_probabilities must map at least one party to a probability between 0 and 1."
        margin = args.get("margin_estimate")
        confidence = args.get("confidence")
        captured.update(
            model=model,
            candidate_probabilities=candidate_probabilities,
            party_probabilities={party: round(value, 4) for party, value in probabilities.items()},
            margin_estimate=float(margin) if isinstance(margin, (int, float)) and not isinstance(margin, bool) else None,
            confidence=confidence if confidence in {"high", "medium", "low"} else "unknown",
            key_considerations=[str(item).strip() for item in args.get("key_considerations") or [] if str(item).strip()][:3],
        )
        return "Estimate recorded."

    try:
        await agent_loop(
            FORECAST_PANEL_SYSTEM,
            prompt,
            model=model,
            on_log=ctx.on_log,
            race_id=ctx.race_id,
            max_iterations=3,
            phase_name=_phase_name(ctx, "-panel"),
            max_tokens=PANEL_MAX_TOKENS,
            extra_tools=FORECAST_PANEL_TOOLS,
            extra_tool_handlers={"submit_forecast_estimate": submit_forecast_estimate},
            tools_mode=True,
            run_budget=ctx.run_budget,
            allow_search_tools=False,
            required_final_tool_name="submit_forecast_estimate",
        )
    except RunBudgetExceeded:
        raise
    except Exception as exc:
        ctx.log("warning", f"  Forecast panel: {model} failed: {exc}")
        return None
    if not captured:
        ctx.log("warning", f"  Forecast panel: {model} returned no estimate")
        return None
    return captured


async def run_forecast_panel(
    ctx: PhaseContext,
    agent_loop: Callable,
    prompt: str,
    models: Sequence[str] = FORECAST_PANEL_MODELS,
    same_party: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Ask every panel member for an independent estimate, concurrently. A failed member is dropped."""
    results = await asyncio.gather(
        *(_panel_member(ctx, agent_loop, model, prompt, same_party) for model in models),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, RunBudgetExceeded):
            raise result
    return [result for result in results if isinstance(result, dict)]


def _candidate_rating(party: str, probability: float) -> str:
    """Rating for the leading candidate of a same-party race, in the same bands as a party race."""
    suffix = {"Democratic": "d", "Republican": "r"}.get(party)
    if suffix is None:
        return "other"
    for threshold, band in RATING_BANDS:
        if probability >= threshold:
            return f"{band}_{suffix}"
    return "tossup"


def _build_candidate_consensus(members: Sequence[Dict[str, Any]], poll_count: int, party: str) -> Optional[Dict[str, Any]]:
    """Consensus for a same-party race: the party is certain, so the numbers describe which candidate wins."""
    usable = [member for member in members if member.get("candidate_probabilities")]
    estimates = [member["candidate_probabilities"] for member in usable]
    probabilities = aggregate_panel(estimates)
    if not probabilities:
        return None
    leader = max(probabilities, key=lambda name: probabilities[name])
    probability = probabilities[leader]
    rating = _candidate_rating(party, probability)
    spread = panel_spread(estimates, leader)
    margins = [
        (max(estimate, key=lambda name: estimate[name]), member.get("margin_estimate"))
        for member, estimate in zip(usable, estimates)
    ]
    return {
        "party_probabilities": {party: 1.0},
        "candidate_probabilities": probabilities,
        "rating": rating,
        "leading_party": party,
        "predicted_winner_party": party,
        "predicted_winner_name": None if rating == "tossup" else leader,
        "win_probability": probability,
        "confidence": confidence_for(spread, poll_count, len(usable)),
        "margin_estimate": consensus_margin(margins, leader),
        "panel_spread": spread,
        "members": list(usable),
    }


def build_consensus(
    members: Sequence[Dict[str, Any]], poll_count: int, same_party: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Turn panel estimates into the forecast's numbers."""
    if same_party:
        return _build_candidate_consensus(members, poll_count, same_party)
    estimates = [member["party_probabilities"] for member in members]
    probabilities = aggregate_panel(estimates)
    if not probabilities:
        return None
    leader = leading_party(probabilities)
    rating = rating_for(probabilities)
    spread = panel_spread(estimates, leader)
    margins = [
        (leading_party(normalize_probabilities(member["party_probabilities"])), member.get("margin_estimate"))
        for member in members
    ]
    return {
        "party_probabilities": probabilities,
        "rating": rating,
        "leading_party": leader,
        "predicted_winner_party": "Toss-up" if rating == "tossup" else leader,
        "win_probability": probabilities.get(leader) if leader else None,
        "confidence": confidence_for(spread, poll_count, len(members)),
        "margin_estimate": consensus_margin(margins, leader),
        "panel_spread": spread,
        "members": list(members),
    }


def forecast_evidence_key(race_json: Dict[str, Any]) -> tuple:
    """What a forecast reads that can legitimately move it: the poll set, the roster, and the contest stage.

    Prediction-market prices are left out on purpose: they tick continuously, so
    including them would mean the guard never applies.
    """
    roster = frozenset(
        (_name_key(candidate.get("name")), _evidence_party(candidate.get("party")))
        for candidate in _active_candidates(race_json)
    )
    return (poll_identity(race_json.get("polling")), roster, str(race_json.get("contest_stage") or ""))


#: Ballot labels for a candidate with no party. Discovery re-verification
#: relabels between them (NE-Sen: "Independent" -> "Nonpartisan") without the
#: field changing, so the stability guard must not read that as a new roster.
_UNAFFILIATED_LABELS = frozenset(
    {
        "independent",
        "nonpartisan",
        "non-partisan",
        "unaffiliated",
        "no party",
        "no party affiliation",
        "no party preference",
        "no political party",
        "npa",
    }
)


def _evidence_party(label: Any) -> str:
    party = normalize_party_label(label)
    return "Independent" if party.casefold() in _UNAFFILIATED_LABELS else party


def apply_stability_guard(
    consensus: Dict[str, Any],
    baseline_forecast: Optional[Dict[str, Any]],
    baseline_evidence: Any,
    race_json: Dict[str, Any],
) -> Optional[str]:
    """Cap the consensus's move from the baseline forecast when the evidence is unchanged.

    Reruns on an identical poll set used to move ratings materially just from
    re-reasoning (AR-02 58% -> 66%, tilt_r -> lean_r). When the baseline had a
    forecast and the poll set, roster and contest stage all match it, the
    baseline leader's probability may move at most ``STABILITY_MAX_SHIFT``.
    The rating is re-derived from the capped probability, so it stays the
    baseline rating unless the capped move genuinely crosses a band threshold.

    Mutates *consensus* in place and returns a human-readable note, or None
    when the guard does not apply. Same-party (candidate-level) races are left
    alone: their numbers describe candidates, not parties.
    """
    if not isinstance(baseline_forecast, dict) or baseline_evidence is None:
        return None
    if consensus.get("candidate_probabilities"):
        return None
    if forecast_evidence_key(race_json) != baseline_evidence:
        return None
    prior_probs = normalize_probabilities(baseline_forecast.get("party_probabilities") or {})
    prior_leader = leading_party(prior_probs)
    if prior_leader is None:
        return None
    capped = cap_probability_shift(prior_probs, consensus["party_probabilities"])
    if capped is None:
        return None
    proposed = normalize_probabilities(consensus["party_probabilities"]).get(prior_leader, 0.0)
    leader = leading_party(capped)
    rating = rating_for(capped)
    margin = consensus.get("margin_estimate")
    prior_margin = baseline_forecast.get("margin_estimate")
    if (
        leader == prior_leader
        and isinstance(margin, (int, float))
        and isinstance(prior_margin, (int, float))
        and not isinstance(margin, bool)
        and not isinstance(prior_margin, bool)
    ):
        margin = round(
            min(max(float(margin), prior_margin - STABILITY_MAX_MARGIN_SHIFT), prior_margin + STABILITY_MAX_MARGIN_SHIFT), 1
        )
    consensus.update(
        {
            "party_probabilities": capped,
            "rating": rating,
            "leading_party": leader,
            "predicted_winner_party": "Toss-up" if rating == "tossup" else leader,
            "win_probability": capped.get(leader) if leader else None,
            "margin_estimate": margin,
        }
    )
    return (
        f"Stability guard: poll set, roster and contest stage unchanged since the baseline forecast, so the "
        f"{prior_leader} probability was held to {capped[prior_leader]:.2f} (baseline {prior_probs[prior_leader]:.2f}, "
        f"panel {proposed:.2f}, max move {STABILITY_MAX_SHIFT:.2f}); rating {baseline_forecast.get('rating')} -> {rating}."
    )


def _consensus_for_prompt(consensus: Dict[str, Any]) -> Dict[str, Any]:
    extra = {}
    if consensus.get("candidate_probabilities"):
        extra = {
            "candidate_probabilities": consensus["candidate_probabilities"],
            "predicted_winner_name": consensus.get("predicted_winner_name"),
        }
    return {
        **extra,
        "party_probabilities": consensus["party_probabilities"],
        "rating": consensus["rating"],
        "predicted_winner_party": consensus["predicted_winner_party"],
        "confidence": consensus["confidence"],
        "margin_estimate": consensus["margin_estimate"],
        "panel_members": len(consensus["members"]),
        "largest_gap_between_members": consensus["panel_spread"],
        "member_key_considerations": [member.get("key_considerations") or [] for member in consensus["members"]],
    }


def _winner_name_for(name: Any, consensus: Dict[str, Any], race_json: Dict[str, Any]) -> Optional[str]:
    """Keep a named winner only when they belong to the consensus leader's party. A toss-up names nobody."""
    wanted = str(name or "").strip().casefold()
    if not wanted or consensus["rating"] == "tossup":
        return None
    for candidate in race_json.get("candidates", []):
        if not isinstance(candidate, dict) or candidate.get("withdrawn"):
            continue
        if str(candidate.get("name") or "").strip().casefold() == wanted:
            if normalize_party_label(candidate.get("party")) == consensus["leading_party"]:
                return candidate.get("name")
            return None
    return None


def _pinned_set_forecast(
    original: Callable[[Dict[str, Any]], str],
    consensus: Optional[Dict[str, Any]],
    race_json: Dict[str, Any],
    written: Dict[str, bool],
) -> Callable[[Dict[str, Any]], str]:
    """Wrap set_forecast so the writer supplies prose but the panel supplies every number."""

    def set_forecast(args: Dict[str, Any]) -> str:
        call_args = dict(args)
        if consensus:
            if call_args.get("rating") != consensus["rating"]:
                return (
                    f"ERROR: The panel consensus rating is {consensus['rating']}. Use it exactly, with the consensus "
                    "party_probabilities, and write the prose to match."
                )
            call_args["party_probabilities"] = consensus["party_probabilities"]
            call_args["win_probability"] = consensus["win_probability"]
            call_args["confidence"] = consensus["confidence"]
            call_args["predicted_winner_party"] = consensus["predicted_winner_party"]
            if "predicted_winner_name" in consensus:
                call_args["predicted_winner_name"] = consensus["predicted_winner_name"]
            else:
                call_args["predicted_winner_name"] = _winner_name_for(
                    call_args.get("predicted_winner_name"), consensus, race_json
                )
            if consensus["margin_estimate"] is not None:
                call_args["margin_estimate"] = consensus["margin_estimate"]
        result = original(call_args)
        if not str(result).startswith("ERROR"):
            written["ok"] = True
        return result

    return set_forecast


async def _write_forecast(
    ctx: PhaseContext,
    agent_loop: Callable,
    prompt: str,
    handlers: Dict[str, Any],
    consensus: Optional[Dict[str, Any]],
    writer_models: Sequence[str],
    phase_suffix: str = "",
) -> Optional[str]:
    """Run the writer, falling back through *writer_models*. Returns the model that wrote, or None.

    *phase_suffix* separates a revision's tokens and cost from the first draft's
    in the run's phase breakdown, so how often the repair runs is visible.
    """
    for model in writer_models:
        written: Dict[str, bool] = {}
        tool_handlers = {
            **handlers,
            "set_forecast": _pinned_set_forecast(handlers["set_forecast"], consensus, ctx.race_json, written),
        }
        try:
            await agent_loop(
                FORECAST_SYSTEM,
                prompt,
                model=model,
                on_log=ctx.on_log,
                race_id=ctx.race_id,
                max_iterations=min(ctx.max_iterations, 4),
                phase_name=_phase_name(ctx, phase_suffix),
                max_tokens=WRITER_MAX_TOKENS,
                extra_tools=FORECAST_TOOLS + [READ_PROFILE_TOOL],
                extra_tool_handlers=tool_handlers,
                tools_mode=True,
                run_budget=ctx.run_budget,
                allow_search_tools=False,
                required_final_tool_name="set_forecast",
            )
        except RunBudgetExceeded:
            raise
        except Exception as exc:
            ctx.log("warning", f"  Forecast writer {model} failed: {exc}")
            continue
        if written:
            return model
        ctx.log("warning", f"  Forecast writer {model} finished without setting a forecast")
    return None


_WRITTEN_TEXT_FIELDS = ("rationale", "takeaway", "key_reasons", "uncertainty")


def _written_text(forecast: Dict[str, Any]) -> Dict[str, Any]:
    """The prose a revision must correct, so it fixes the flagged claims instead of starting over."""
    return {field: forecast.get(field) for field in _WRITTEN_TEXT_FIELDS}


def _checked_forecast(forecast: Dict[str, Any], fields: Sequence[str], race_json: Dict[str, Any]) -> Dict[str, Any]:
    checked = {field: forecast.get(field) for field in fields}
    party = same_party_contest(race_json)
    if party:
        # Without this, a 70% win_probability beside a 100% party probability
        # reads as a contradiction.
        checked["note"] = (
            f"Every candidate is {party}, so party_probabilities is certain; win_probability is the predicted "
            "winner's chance of beating the other candidates."
        )
    return checked


async def _check_forecast_text(ctx: PhaseContext, agent_loop: Callable) -> List[str]:
    """Ask an independent model whether the forecast text contradicts the race. [] when it cannot run."""
    race_json = ctx.race_json
    forecast = race_json.get("forecast") or {}
    roster = [
        {"name": c.get("name"), "party": c.get("party"), "incumbent": bool(c.get("incumbent"))}
        for c in race_json.get("candidates", [])
        if isinstance(c, dict) and not c.get("withdrawn")
    ]
    checked_fields = (
        "predicted_winner_name",
        "predicted_winner_party",
        "win_probability",
        "party_probabilities",
        "rating",
        "margin_estimate",
        "rationale",
        "takeaway",
        "key_reasons",
        "uncertainty",
    )
    prompt = FORECAST_CHECK_USER.format(
        current_date=datetime.now(timezone.utc).date().isoformat(),
        contest_stage=race_json.get("contest_stage") or "unknown",
        seat_control=seat_control_note(race_json),
        facts_block=forecast_facts_block(race_json),
        description=(race_json.get("description") or "")[:_MAX_CHECK_DESCRIPTION_CHARS],
        roster_json=json.dumps(roster, indent=2),
        polling_json=json.dumps((race_json.get("polling") or [])[:_MAX_CHECK_POLLS], indent=2, default=str),
        forecast_json=json.dumps(_checked_forecast(forecast, checked_fields, race_json), indent=2, default=str),
    )
    try:
        result = await agent_loop(
            FORECAST_CHECK_SYSTEM,
            prompt,
            model=SMALL_MODEL,
            on_log=ctx.on_log,
            race_id=ctx.race_id,
            max_iterations=2,
            phase_name=_phase_name(ctx, "-check"),
            max_tokens=CHECK_MAX_TOKENS,
            run_budget=ctx.run_budget,
            allow_search_tools=False,
        )
    except RunBudgetExceeded:
        raise
    except Exception as exc:
        ctx.log("warning", f"  Forecast check unavailable: {exc}")
        return []
    issues = result.get("issues") if isinstance(result, dict) else None
    if not isinstance(issues, list):
        return []
    return [str(issue).strip() for issue in issues if str(issue).strip()][:_MAX_CHECK_ISSUES]


_RATING_LABELS = {
    "safe": "Safe",
    "likely": "Likely",
    "lean": "Lean",
    "tilt": "Tilt",
}
_RATING_PARTIES = {"d": "Democratic", "r": "Republican"}


def _rating_label(rating: Any) -> str:
    """Reader label for a rating: lean_d is "Lean Democratic", tossup is "Toss-up"."""
    value = str(rating or "").strip().lower()
    if value == "tossup":
        return "Toss-up"
    band, _, side = value.partition("_")
    if band in _RATING_LABELS and side in _RATING_PARTIES:
        return f"{_RATING_LABELS[band]} {_RATING_PARTIES[side]}"
    return "Unrated"


def _percent(value: Any) -> Optional[str]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
        return None
    pct = round(float(value) * 100)
    if pct >= 100:
        return ">99%"
    if pct <= 0:
        return "<1%"
    return f"{pct}%"


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def deterministic_forecast_text(forecast: Dict[str, Any], race_json: Dict[str, Any]) -> Dict[str, Any]:
    """Plain-language forecast prose built only from the published numbers.

    Used in place of the writer's prose when the fact-check still finds a
    contradiction after a revision. Audit 4 found fifteen races where that
    happened and the flagged text shipped anyway (California's governor "18
    points" against a 25-point poll; Kansas's open Democratic seat described as
    a Republican hold). These sentences can only repeat the rating, the
    probability, the leader and the poll count, so they cannot contradict the
    race the way free prose can.
    """
    rating = str(forecast.get("rating") or "")
    label = _rating_label(rating)
    probability = _percent(forecast.get("win_probability"))
    winner_name = str(forecast.get("predicted_winner_name") or "").strip()
    winner_party = str(forecast.get("predicted_winner_party") or "").strip()
    if winner_party.casefold() in {"toss-up", "tossup"}:
        winner_party = ""
    if winner_name and winner_party:
        leader = f"{winner_name} ({winner_party})"
    elif winner_name:
        leader = winner_name
    elif winner_party:
        leader = f"the {winner_party} candidate"
    else:
        leader = ""
    polls = _head_to_head_poll_count(race_json)
    margin = forecast.get("margin_estimate")
    margin_text = ""
    if isinstance(margin, (int, float)) and not isinstance(margin, bool) and margin > 0 and rating != "tossup":
        margin_text = f", with an estimated margin of about {round(float(margin))} points"

    if rating == "tossup" or not leader:
        takeaway = "This race is rated a toss-up: neither side is clearly favored."
        rationale = "The forecast rates this race a toss-up."
        if rating != "tossup" and label != "Unrated":
            takeaway = f"This race is rated {label}."
            rationale = f"The forecast rates this race {label}."
    else:
        chance = f", with a {probability} chance of winning" if probability else ""
        takeaway = f"{leader[0].upper()}{leader[1:]} is favored{chance}."
        rated = f"rates this race {label} and " if label != "Unrated" else ""
        odds = probability or "better"
        rationale = f"The forecast {rated}gives {leader} a {odds} chance of winning{margin_text}."
    if polls:
        poll_line = (
            f"The estimate draws on {_plural(polls, 'public poll')} with a head-to-head matchup between current candidates."
        )
    else:
        poll_line = (
            "No head-to-head public poll between the current candidates was available, so the estimate rests on "
            "non-polling evidence."
        )
    rationale = f"{rationale} {poll_line}"
    key_reasons: List[str] = []
    if label != "Unrated":
        key_reasons.append(
            f"Rating: {label}" + (f" ({leader}: {probability} chance of winning)." if leader and probability else ".")
        )
    elif leader and probability:
        key_reasons.append(f"Chance of winning: {leader}, {probability}.")
    key_reasons.append(f"Polling: {_plural(polls, 'head-to-head poll')} of the current candidates.")
    members = forecast.get("panel") or []
    if isinstance(members, list) and members:
        key_reasons.append(f"Method: the median of {_plural(len(members), 'independent model estimate')}.")
    uncertainty = "This is an estimate, not a certainty, and it can shift as new polls and information arrive."
    return {
        "takeaway": takeaway,
        "rationale": rationale,
        "key_reasons": key_reasons,
        "uncertainty": uncertainty,
        "based_on_poll_count": polls,
        # The writer's claims belong to the prose that failed its check.
        "evidence_lineage": None,
    }


def replace_unverified_forecast_text(race_json: Dict[str, Any]) -> bool:
    """Swap the forecast's prose for :func:`deterministic_forecast_text`. Returns whether it changed anything."""
    forecast = race_json.get("forecast")
    if not isinstance(forecast, dict) or not forecast.get("rating"):
        return False
    forecast.update(deterministic_forecast_text(forecast, race_json))
    return True


async def run_forecast_phase(ctx: PhaseContext) -> None:
    """Generate a race forecast from an independent model panel, incorporating Kalshi signals when available."""
    race_json = ctx.race_json
    race_id = ctx.race_id
    model = ctx.model
    step_enabled = ctx.step_enabled
    track = ctx.track
    log = ctx.log
    prefix = ctx.prefix
    run_budget = ctx.run_budget
    from . import _agent_loop, fetch_kalshi_market_signals

    if not step_enabled("forecast"):
        track("skip", "forecast")
        return

    track("start", "forecast")
    forecast_t0 = time.perf_counter()
    handlers = _make_editing_handlers(race_json, log)
    log("info", f"{prefix} 4b: Generating race forecast...")
    try:
        market_signals: list[dict[str, Any]] = []
        try:
            market_signals = await _await_with_run_budget(
                fetch_kalshi_market_signals(race_id),
                run_budget=run_budget,
                requested_timeout=10.0,
                operation="Kalshi market data fetch",
            )
            if market_signals:
                log("info", f"  Forecast: loaded {len(market_signals)} Kalshi market signal(s)")
        except RunBudgetExceeded:
            raise
        except Exception as exc:
            log("warning", f"  Forecast: Kalshi market signals unavailable: {exc}")

        fields = _race_prompt_fields(race_json, race_id, market_signals)
        same_party = same_party_contest(race_json)
        panel_prompt = FORECAST_PANEL_USER.format(**fields)
        if same_party:
            log("info", f"  Forecast: every candidate is {same_party}; the panel estimates candidates, not parties")
            panel_prompt += "\n\n" + FORECAST_PANEL_SAME_PARTY_NOTE.format(party=same_party)
        members = await run_forecast_panel(ctx, _agent_loop, panel_prompt, same_party=same_party)
        poll_count = _head_to_head_poll_count(race_json)
        consensus = build_consensus(members, poll_count, same_party=same_party) if members else None
        stability_note = None
        if consensus:
            log(
                "info",
                f"  Forecast panel: {len(members)}/{len(FORECAST_PANEL_MODELS)} members, consensus "
                f"{consensus['rating']} (largest gap {consensus['panel_spread']:.2f})",
            )
            if not ctx.resume_partial:
                # A resumed partial run's "baseline" is its own checkpoint, whose
                # polling may already include this run's new polls.
                stability_note = apply_stability_guard(
                    consensus, ctx.baseline_forecast, ctx.baseline_forecast_evidence, race_json
                )
            if stability_note:
                log("info", f"  Forecast {stability_note}")
        else:
            log("warning", "  Forecast panel produced no estimates; the writer will set the numbers itself")

        writer_prompt = FORECAST_USER.format(
            **fields,
            facts_block=forecast_facts_block(race_json),
            consensus_json=json.dumps(_consensus_for_prompt(consensus), indent=2) if consensus else "null",
        )
        if same_party:
            writer_prompt += "\n\n" + FORECAST_WRITER_SAME_PARTY_NOTE.format(party=same_party)
        writer_models = list(dict.fromkeys([model, SMALL_MODEL]))
        writer_model = await _write_forecast(ctx, _agent_loop, writer_prompt, handlers, consensus, writer_models)
        if writer_model is None:
            raise RuntimeError(f"no forecast writer produced a forecast (tried {', '.join(writer_models)})")

        text_unverified = False
        issues = await _check_forecast_text(ctx, _agent_loop)
        if issues:
            # Exactly one repair: the same writer model, shown its own text and
            # the objections, then one re-check. A second failure falls back to
            # the plain numeric summary below.
            log("warning", f"  Forecast check flagged {len(issues)} issue(s); revising once: {issues}")
            revision_prompt = (
                writer_prompt
                + "\n\n"
                + FORECAST_REVISION_USER.format(
                    previous_text_json=json.dumps(_written_text(race_json.get("forecast") or {}), indent=2, default=str),
                    issues="\n".join(f"- {issue}" for issue in issues),
                )
            )
            revised_by = await _write_forecast(
                ctx, _agent_loop, revision_prompt, handlers, consensus, [writer_model], phase_suffix="-revision"
            )
            remaining = await _check_forecast_text(ctx, _agent_loop) if revised_by else issues
            if not remaining:
                log("info", "  Forecast text passed its fact-check after one revision")
            else:
                text_unverified = True
                _record_step_failure(
                    race_json,
                    "forecast",
                    RunFailureReason.FORECAST_TEXT_UNVERIFIED,
                    "; ".join(remaining) + " (written explanation replaced with a plain summary of the numbers)",
                )

        forecast = race_json["forecast"]
        forecast["model"] = writer_model
        forecast["market_signals"] = market_signals
        if consensus:
            forecast["method"] = STABILIZED_PANEL_METHOD if stability_note else PANEL_METHOD
            forecast["panel"] = [
                {
                    "model": member["model"],
                    "party_probabilities": member["party_probabilities"],
                    **(
                        {"candidate_probabilities": member["candidate_probabilities"]}
                        if member.get("candidate_probabilities")
                        else {}
                    ),
                    "margin_estimate": member.get("margin_estimate"),
                    "confidence": member.get("confidence", "unknown"),
                }
                for member in consensus["members"]
            ]
            forecast["panel_spread"] = consensus["panel_spread"]
        else:
            forecast["method"] = SINGLE_MODEL_METHOD
            forecast.pop("panel", None)
            forecast.pop("panel_spread", None)
        if text_unverified and replace_unverified_forecast_text(race_json):
            log("warning", "  Forecast text failed its fact-check twice; published a plain summary of the numbers instead")
    except RunBudgetExceeded:
        raise
    except Exception as exc:
        log("warning", f"  Forecast phase failed: {exc}")
        _record_step_failure(race_json, "forecast", _classify_exception(exc), str(exc))
    track("complete", "forecast", duration_ms=int((time.perf_counter() - forecast_t0) * 1000), race_json=race_json)
