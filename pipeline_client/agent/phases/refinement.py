"""Phase 3: refinement — tools-mode per-candidate and race-meta cleanup."""

import json
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from shared.neutrality import find_loaded_language, iter_site_voice_text

from ..handlers import _make_editing_handlers
from ..prompts import (
    CANONICAL_ISSUES,
    NEUTRALITY_MUST_FIX,
    NEUTRALITY_RETRY_USER,
    REFINE_META_USER,
    REFINE_SYSTEM,
    REFINE_USER,
)
from ..tools import BACKGROUND_TOOLS, CANDIDATE_TOOLS, DESCRIPTION_TOOLS, ISSUE_TOOLS, READ_PROFILE_TOOL, RECORD_TOOLS
from ._common import (
    _await_advisory_with_run_budget,
    _classify_exception,
    _is_control_flow_exception,
    _mark_pipeline_unit_complete,
    _pipeline_completed_units,
    _record_step_failure,
)
from .context import PhaseContext

#: Iterations for the one targeted neutrality retry; it only rewrites the text it is given.
_NEUTRALITY_RETRY_ITERATIONS = 4

#: ``{field_path: (current_text, lint_hits)}``, field paths as ``iter_site_voice_text`` spells them.
LoadedFields = Dict[str, Tuple[str, List[Dict[str, str]]]]


def _loaded_wording(race_json: Dict[str, Any], fields: Optional[Iterable[str]] = None) -> LoadedFields:
    """Neutrality-lint hits by field path, limited to *fields* when given."""
    wanted = set(fields) if fields is not None else None
    loaded: LoadedFields = {}
    for field, text in iter_site_voice_text(race_json):
        if wanted is not None and field not in wanted:
            continue
        hits = find_loaded_language(text)
        if hits:
            loaded[field] = (text, hits)
    return loaded


def _refinable_loaded_fields(race_json: Dict[str, Any], selected_name_set: Iterable[str]) -> LoadedFields:
    """Loaded fields refinement can rewrite: the selected candidates' text and the race description.

    Forecast text and the polling note belong to their own phases, so they are not forced here.
    """
    selected = set(selected_name_set)
    prefixes = tuple(
        f"candidates[{index}]."
        for index, candidate in enumerate(race_json.get("candidates") or [])
        if isinstance(candidate, dict) and candidate.get("name") in selected
    )
    return {
        field: value
        for field, value in _loaded_wording(race_json).items()
        if field == "description" or (prefixes and field.startswith(prefixes))
    }


def _candidate_fields(race_json: Dict[str, Any], candidate: Dict[str, Any], fields: Iterable[str]) -> List[str]:
    """The subset of *fields* that belong to *candidate*."""
    for index, item in enumerate(race_json.get("candidates") or []):
        if item is candidate:
            prefix = f"candidates[{index}]."
            return [field for field in fields if field.startswith(prefix)]
    return []


def _format_must_fix(loaded: LoadedFields) -> str:
    """The MUST-FIX block: field path, flagged phrases and current text for each hit."""
    lines = []
    for field, (text, hits) in loaded.items():
        phrases = ", ".join(dict.fromkeys(f'"{hit["match"]}"' for hit in hits))
        lines.append(f"- {field} (flagged: {phrases})\n  Current text: {text}")
    return NEUTRALITY_MUST_FIX.format(fields="\n".join(lines))


def _with_must_fix(prompt: str, loaded: LoadedFields) -> str:
    return f"{prompt}\n\n{_format_must_fix(loaded)}" if loaded else prompt


async def _retry_loaded_wording(
    ctx: PhaseContext, fields: List[str], *, tools: List[Dict[str, Any]], handlers: Dict[str, Any], phase_name: str
) -> None:
    """One targeted pass, same model, over must-fix fields the first pass left loaded."""
    remaining = _loaded_wording(ctx.race_json, fields)
    if not remaining:
        return
    from . import _agent_loop

    ctx.log("info", f"  Neutrality retry: {len(remaining)} field(s) still use loaded wording")
    try:
        await _agent_loop(
            REFINE_SYSTEM,
            NEUTRALITY_RETRY_USER.format(race_id=ctx.race_id, must_fix=_format_must_fix(remaining)),
            model=ctx.model,
            on_log=ctx.on_log,
            race_id=ctx.race_id,
            max_iterations=_NEUTRALITY_RETRY_ITERATIONS,
            phase_name=f"{phase_name}-neutrality",
            max_tokens=4096,
            extra_tools=tools,
            extra_tool_handlers=handlers,
            tools_mode=True,
            run_budget=ctx.run_budget,
            allow_search_tools=False,
        )
    except Exception as exc:
        if _is_control_flow_exception(exc):
            raise
        ctx.log("warning", f"  Neutrality retry failed: {exc} — keeping current text")


def _record_unfixed_loaded_wording(ctx: PhaseContext, must_fix_fields: Iterable[str]) -> None:
    """Keep must-fix fields that are still loaded in pipeline_state, where run_audit reports them."""
    unfixed = sorted(_loaded_wording(ctx.race_json, must_fix_fields))
    pipeline_state = ctx.race_json.setdefault("pipeline_state", {})
    if unfixed:
        pipeline_state["neutrality_unfixed"] = unfixed
        ctx.log("warning", f"  Neutrality: {len(unfixed)} field(s) still use loaded wording: {', '.join(unfixed[:5])}")
    else:
        pipeline_state.pop("neutrality_unfixed", None)


async def run_refinement_phase(ctx: PhaseContext) -> None:
    """Refine each selected candidate one at a time, then refine race metadata."""
    race_json = ctx.race_json
    race_id = ctx.race_id
    selected_name_set = ctx.selected_name_set
    model = ctx.model
    on_log = ctx.on_log
    step_enabled = ctx.step_enabled
    track = ctx.track
    is_update = ctx.is_update
    refine_iters = ctx.refine_iters
    log = ctx.log
    prefix = ctx.prefix
    resume_partial = ctx.resume_partial
    run_budget = ctx.run_budget
    from . import _agent_loop, _candidate_source_hints

    if not step_enabled("refinement"):
        log("info", f"{prefix} 3: Refinement — SKIPPED")
        track("skip", "refinement")
        return

    track("start", "refinement")
    ref_t0 = time.perf_counter()
    handlers = _make_editing_handlers(race_json, log)
    cand_list = [c for c in race_json.get("candidates", []) if isinstance(c, dict) and c.get("name") in selected_name_set]
    cand_names_in_json = [c["name"] for c in cand_list]
    n_cands = len(cand_list)
    # Neutrality-lint hits are required edits. Refinement otherwise revisits only
    # weak or unsourced fields, so a well-sourced loaded stance stayed verbatim.
    must_fix = _refinable_loaded_fields(race_json, selected_name_set)
    if must_fix:
        log("info", f"  Neutrality lint: {len(must_fix)} field(s) must be rewritten: {', '.join(list(must_fix)[:5])}")
    refinement_units = _pipeline_completed_units(race_json)
    log("info", f"{prefix} 3: Refining profile (one candidate at a time, tools mode)...")
    for ci, candidate in enumerate(cand_list):
        cname = candidate["name"]
        unit_id = f"refinement:{cname}"
        if resume_partial and unit_id in refinement_units:
            track(
                "progress",
                "refinement",
                pct=int(((ci + 1) / max(n_cands, 1)) * 100),
                message=f"Refinement checkpoint: {cname} ({ci + 1}/{n_cands})",
                race_json=race_json,
            )
            continue
        source_hints = await _await_advisory_with_run_budget(
            _candidate_source_hints(race_json, cname),
            run_budget=run_budget,
            requested_timeout=20.0,
            operation="candidate source hint crawl",
            log=log,
            continuation="continuing refinement with the candidate website only",
        )
        if source_hints is None:
            candidate_website, candidate_issue_urls = candidate.get("website") or "(unknown)", []
        else:
            candidate_website, candidate_issue_urls = source_hints
        issue_hint_text = ", ".join(candidate_issue_urls) if candidate_issue_urls else "(none found)"
        log("info", f"  Refining {cname}...")
        track(
            "progress",
            "refinement",
            pct=int((ci / max(n_cands, 1)) * 100),
            message=f"Refinement: {cname} ({ci + 1}/{n_cands})",
            race_json=race_json,
        )
        candidate_must_fix = {field: must_fix[field] for field in _candidate_fields(race_json, candidate, must_fix)}
        refine_prefix = "upd-refine" if is_update else "refine"
        try:
            await _agent_loop(
                REFINE_SYSTEM,
                _with_must_fix(
                    REFINE_USER.format(
                        race_id=race_id,
                        candidate_name=cname,
                        candidate_website=candidate_website,
                        candidate_issue_urls=issue_hint_text,
                        candidate_json=json.dumps(candidate, indent=2, default=str),
                        race_description=race_json.get("description", ""),
                        other_candidates=", ".join(cn for cn in cand_names_in_json if cn != cname),
                        all_issues=", ".join(CANONICAL_ISSUES),
                    ),
                    candidate_must_fix,
                ),
                model=model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=max(8, refine_iters // max(n_cands, 1)),
                phase_name=f"{refine_prefix}-{cname[:20]}",
                max_tokens=8192,
                extra_tools=CANDIDATE_TOOLS + ISSUE_TOOLS + RECORD_TOOLS + BACKGROUND_TOOLS + [READ_PROFILE_TOOL],
                extra_tool_handlers=handlers,
                tools_mode=True,
                run_budget=run_budget,
            )
        except Exception as exc:
            if _is_control_flow_exception(exc):
                raise
            log("warning", f"  Refine failed for {cname}: {exc} — keeping existing")
            _record_step_failure(race_json, "refinement", _classify_exception(exc), f"{cname}: {exc}")
        if candidate_must_fix:
            await _retry_loaded_wording(
                ctx,
                list(candidate_must_fix),
                tools=CANDIDATE_TOOLS + ISSUE_TOOLS + RECORD_TOOLS,
                handlers=handlers,
                phase_name=f"{refine_prefix}-{cname[:20]}",
            )
        _mark_pipeline_unit_complete(race_json, unit_id)
        refinement_units.add(unit_id)
        track(
            "progress",
            "refinement",
            pct=int(((ci + 1) / max(n_cands, 1)) * 100),
            message=f"Refinement checkpoint: {cname} ({ci + 1}/{n_cands})",
            race_json=race_json,
        )

    # Meta refinement (description only) — tools mode
    meta_unit_id = "refinement:meta"
    if not (resume_partial and meta_unit_id in refinement_units):
        log("info", "  Refining race metadata...")
        meta_must_fix = {field: value for field, value in must_fix.items() if field == "description"}
        meta_phase = f"{'upd-' if is_update else ''}refine-meta"
        try:
            await _agent_loop(
                REFINE_SYSTEM,
                _with_must_fix(
                    REFINE_META_USER.format(
                        race_id=race_id,
                        race_description=race_json.get("description", ""),
                    ),
                    meta_must_fix,
                ),
                model=model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=max(6, refine_iters // 3),
                phase_name=meta_phase,
                max_tokens=4096,
                extra_tools=DESCRIPTION_TOOLS + [READ_PROFILE_TOOL],
                extra_tool_handlers=handlers,
                tools_mode=True,
                run_budget=run_budget,
            )
        except Exception as exc:
            if _is_control_flow_exception(exc):
                raise
            log("warning", f"  Refine meta failed: {exc} — keeping existing meta")
            _record_step_failure(race_json, "refinement", _classify_exception(exc), f"meta: {exc}")
        if meta_must_fix:
            await _retry_loaded_wording(
                ctx, list(meta_must_fix), tools=DESCRIPTION_TOOLS, handlers=handlers, phase_name=meta_phase
            )
        _mark_pipeline_unit_complete(race_json, meta_unit_id)
        refinement_units.add(meta_unit_id)
        track(
            "progress",
            "refinement",
            pct=100,
            message="Refinement checkpoint: race metadata",
            race_json=race_json,
        )
    _record_unfixed_loaded_wording(ctx, must_fix)
    track("complete", "refinement", duration_ms=int((time.perf_counter() - ref_t0) * 1000), race_json=race_json)
