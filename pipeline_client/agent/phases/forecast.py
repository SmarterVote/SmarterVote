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
    aggregate_panel,
    confidence_for,
    consensus_margin,
    leading_party,
    normalize_party_label,
    normalize_probabilities,
    panel_spread,
    rating_for,
)
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
        "race_identity_context": _race_identity_context(race_json),
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
) -> Optional[str]:
    """Run the writer, falling back through *writer_models*. Returns the model that wrote, or None."""
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
                phase_name=_phase_name(ctx),
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
        poll_count = len(race_json.get("polling") or [])
        consensus = build_consensus(members, poll_count, same_party=same_party) if members else None
        if consensus:
            log(
                "info",
                f"  Forecast panel: {len(members)}/{len(FORECAST_PANEL_MODELS)} members, consensus "
                f"{consensus['rating']} (largest gap {consensus['panel_spread']:.2f})",
            )
        else:
            log("warning", "  Forecast panel produced no estimates; the writer will set the numbers itself")

        writer_prompt = FORECAST_USER.format(
            **fields,
            consensus_json=json.dumps(_consensus_for_prompt(consensus), indent=2) if consensus else "null",
        )
        if same_party:
            writer_prompt += "\n\n" + FORECAST_WRITER_SAME_PARTY_NOTE.format(party=same_party)
        writer_models = list(dict.fromkeys([model, SMALL_MODEL]))
        writer_model = await _write_forecast(ctx, _agent_loop, writer_prompt, handlers, consensus, writer_models)
        if writer_model is None:
            raise RuntimeError(f"no forecast writer produced a forecast (tried {', '.join(writer_models)})")

        issues = await _check_forecast_text(ctx, _agent_loop)
        if issues:
            log("warning", f"  Forecast check flagged {len(issues)} issue(s); revising: {issues}")
            revision_prompt = (
                writer_prompt + "\n\n" + FORECAST_REVISION_USER.format(issues="\n".join(f"- {issue}" for issue in issues))
            )
            revised_by = await _write_forecast(ctx, _agent_loop, revision_prompt, handlers, consensus, [writer_model])
            remaining = await _check_forecast_text(ctx, _agent_loop) if revised_by else issues
            if remaining:
                _record_step_failure(race_json, "forecast", RunFailureReason.FORECAST_TEXT_UNVERIFIED, "; ".join(remaining))

        forecast = race_json["forecast"]
        forecast["model"] = writer_model
        forecast["market_signals"] = market_signals
        if consensus:
            forecast["method"] = PANEL_METHOD
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
    except RunBudgetExceeded:
        raise
    except Exception as exc:
        log("warning", f"  Forecast phase failed: {exc}")
        _record_step_failure(race_json, "forecast", _classify_exception(exc), str(exc))
    track("complete", "forecast", duration_ms=int((time.perf_counter() - forecast_t0) * 1000), race_json=race_json)
