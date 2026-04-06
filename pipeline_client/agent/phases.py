"""Phase orchestration — discovery, issues, finance, refinement, iteration.

Contains the per-candidate issue sub-agent, shared phase runner, fresh and
update flow runners, patch/merge helpers, and review-iteration logic.
"""

import copy
import json
import time
from typing import Any, Dict, List, Optional

from .handlers import _make_editing_handlers
from .images import resolve_candidate_images
from .llm import _agent_loop, _ensure_dict, _normalize_candidate, CHEAP_MODEL, DEFAULT_MODEL, NANO_MODEL
from .prompts import (
    CANONICAL_ISSUES,
    DISCOVERY_SYSTEM,
    DISCOVERY_USER,
    FINANCE_VOTING_SYSTEM,
    FINANCE_VOTING_USER,
    ISSUE_SUBAGENT_SYSTEM,
    ISSUE_SUBAGENT_USER,
    ITERATE_SYSTEM,
    ITERATE_USER,
    ITERATE_META_USER,
    REFINE_SYSTEM,
    REFINE_USER,
    REFINE_META_USER,
    ROSTER_SYNC_SYSTEM,
    ROSTER_SYNC_USER,
    UPDATE_ISSUE_SUBAGENT_SYSTEM,
    UPDATE_ISSUE_SUBAGENT_USER,
    UPDATE_META_SYSTEM,
    UPDATE_META_USER,
)
from .tools import (
    BACKGROUND_TOOLS,
    CANDIDATE_TOOLS,
    ISSUE_TOOLS,
    RACE_TOOLS,
    READ_PROFILE_TOOL,
    RECORD_TOOLS,
    ROSTER_TOOLS,
)
from .utils import make_logger
from .web_tools import _get_search_cache


# ---------------------------------------------------------------------------
# Candidate selection helpers
# ---------------------------------------------------------------------------


def _scale_iterations(base: int, n_candidates: int, per_candidate: int, minimum: int = 12) -> int:
    """Return an iteration budget scaled to the number of candidates."""
    return max(base, n_candidates * per_candidate + minimum)


def _candidate_info_score(candidate: Dict[str, Any]) -> int:
    """Score a candidate by how much issue data they already have."""
    issues = candidate.get("issues", {})
    score = 0
    for v in issues.values():
        if isinstance(v, dict) and v.get("stance"):
            score += 1
    return score


def _select_candidates_for_research(
    candidate_names: List[str],
    race_json: Dict[str, Any],
    *,
    max_candidates: Optional[int],
    target_no_info: bool,
    log: Any,
) -> List[str]:
    """Return the (possibly truncated) list of candidates to research.

    Sorts candidates by existing info density.  When *target_no_info* is True
    the least-informed candidates come first; otherwise the most-informed do.
    """
    if max_candidates is None and not target_no_info:
        return candidate_names

    cand_by_name: Dict[str, Dict[str, Any]] = {
        c["name"]: c for c in race_json.get("candidates", []) if isinstance(c, dict)
    }
    scored = [(name, _candidate_info_score(cand_by_name.get(name, {}))) for name in candidate_names]
    scored.sort(key=lambda t: t[1], reverse=not target_no_info)

    selected = [name for name, _ in scored]
    if max_candidates is not None and max_candidates < len(selected):
        skipped = selected[max_candidates:]
        selected = selected[:max_candidates]
        log("info", f"  Candidate limit: researching {len(selected)} of {len(candidate_names)} "
            f"(skipped: {', '.join(skipped)})")
    return selected


def _select_target_candidates(
    available_names: List[str],
    target_names: Optional[List[str]],
    log: Any,
) -> List[str]:
    """Filter available candidates to an explicit target list, if provided."""
    if not target_names:
        return available_names

    wanted = [n.strip() for n in target_names if isinstance(n, str) and n.strip()]
    if not wanted:
        return available_names

    by_lower = {n.lower(): n for n in available_names}
    selected: List[str] = []
    missing: List[str] = []
    for name in wanted:
        match = by_lower.get(name.lower())
        if match:
            if match not in selected:
                selected.append(match)
        else:
            missing.append(name)

    if missing:
        log("warning", f"  Candidate filter ignored unknown names: {', '.join(missing)}")
    if not selected:
        raise ValueError(
            "No candidate names in candidate_names matched this race. "
            f"Available: {', '.join(available_names)}"
        )

    log("info", f"  Candidate filter active: {', '.join(selected)}")
    return selected


def _candidate_source_hints(
    race_json: Dict[str, Any],
    candidate_name: str,
) -> tuple[str, List[str]]:
    """Return known website and likely issue/policy URLs for candidate prompts."""
    candidate = next(
        (c for c in race_json.get("candidates", []) if isinstance(c, dict) and c.get("name") == candidate_name),
        None,
    )
    if not candidate:
        return "(unknown)", []

    website = candidate.get("website") or "(unknown)"
    hints: List[str] = []

    if isinstance(website, str) and website.startswith("http"):
        base = website.rstrip("/")
        hints.extend([
            f"{base}/issues",
            f"{base}/issue",
            f"{base}/policy",
            f"{base}/policies",
            f"{base}/priorities",
            f"{base}/platform",
        ])

    for link in candidate.get("links", []):
        if not isinstance(link, dict):
            continue
        url = link.get("url")
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        lowered = url.lower()
        if any(token in lowered for token in ("/issues", "/issue", "policy", "priorities", "platform")):
            hints.append(url)

    deduped: List[str] = []
    seen: set[str] = set()
    for url in hints:
        if url in seen:
            continue
        deduped.append(url)
        seen.add(url)

    return website, deduped[:8]


# ---------------------------------------------------------------------------
# Per-candidate, per-issue sub-agent
# ---------------------------------------------------------------------------

_HANDOFF_WINDOW = 2


def _build_handoff_context(
    handoffs: List[Dict[str, Any]],
    cached_info: Dict[str, Any] | None,
) -> str:
    """Build a handoff context string for the issue sub-agent."""
    parts: List[str] = []

    recent = handoffs[-_HANDOFF_WINDOW:] if handoffs else []
    if recent:
        parts.append("Previous stances already written for this candidate:")
        for h in recent:
            parts.append(f"  - {h['issue']}: {h['stance'][:120]} [{h['confidence']}]")
        parts.append("")

    if cached_info:
        searches = cached_info.get("searches", [])
        if searches:
            parts.append(f"Cached search queries available (results served instantly, {len(searches)} total):")
            for s in searches[:5]:
                parts.append(f"  - \"{s['query']}\"")
            parts.append("")

    return "\n".join(parts) if parts else "No prior context available."


async def _run_issue_research_for_candidate(
    candidate_name: str,
    race_json: Dict[str, Any],
    *,
    race_id: str,
    model: str,
    on_log: Any | None = None,
    max_iterations: int = 12,
    is_update: bool = False,
    last_updated: str = "",
    on_issue_progress: Any | None = None,
) -> None:
    """Run per-issue research for one candidate, mutating race_json in place."""
    log = make_logger(on_log)
    handlers = _make_editing_handlers(race_json, log)
    cache = _get_search_cache()
    cached_info = cache.list_cached_for_race(race_id) if cache else None
    candidate_website, candidate_issue_urls = _candidate_source_hints(race_json, candidate_name)
    issue_hint_text = ", ".join(candidate_issue_urls) if candidate_issue_urls else "(none found)"

    handoffs: List[Dict[str, Any]] = []

    for issue_idx, issue in enumerate(CANONICAL_ISSUES):
        if on_issue_progress:
            try:
                on_issue_progress(issue_idx, issue)
            except Exception:
                pass

        handoff_ctx = _build_handoff_context(handoffs, cached_info)

        existing_stance = ""
        if is_update:
            for c in race_json.get("candidates", []):
                if c.get("name") == candidate_name:
                    sd = c.get("issues", {}).get(issue)
                    if isinstance(sd, dict):
                        existing_stance = (
                            f"  Stance: {sd.get('stance', '?')}\n"
                            f"  Confidence: {sd.get('confidence', '?')}\n"
                            f"  Sources: {json.dumps(sd.get('sources', []))}"
                        )
                    else:
                        existing_stance = "  MISSING — no existing stance"
                    break

        if is_update:
            sys_prompt = UPDATE_ISSUE_SUBAGENT_SYSTEM
            usr_prompt = UPDATE_ISSUE_SUBAGENT_USER.format(
                candidate_name=candidate_name,
                race_id=race_id,
                issue=issue,
                last_updated=last_updated,
                existing_stance=existing_stance or "  MISSING",
                handoff_context=handoff_ctx,
                candidate_website=candidate_website,
                candidate_issue_urls=issue_hint_text,
            )
        else:
            sys_prompt = ISSUE_SUBAGENT_SYSTEM
            usr_prompt = ISSUE_SUBAGENT_USER.format(
                candidate_name=candidate_name,
                race_id=race_id,
                issue=issue,
                handoff_context=handoff_ctx,
                candidate_website=candidate_website,
                candidate_issue_urls=issue_hint_text,
            )

        log("info", f"    Issue {issue_idx + 1}/12: {issue}")

        try:
            await _agent_loop(
                sys_prompt,
                usr_prompt,
                model=model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=min(max_iterations, 10),
                phase_name=f"issue-{candidate_name[:15]}-{issue[:15]}",
                max_tokens=4096,
                extra_tools=ISSUE_TOOLS + [READ_PROFILE_TOOL],
                extra_tool_handlers=handlers,
                tools_mode=True,
            )
        except RuntimeError as exc:
            error_msg = str(exc)
            if "policy violation" in error_msg.lower():
                log(
                    "error",
                    f"    Issue sub-agent skipped for {candidate_name}/{issue} "
                    f"due to OpenAI policy violation (prompt flagged as inappropriate)"
                )
            else:
                log("warning", f"    Issue sub-agent failed for {candidate_name}/{issue}: {exc}")
        except Exception as exc:
            log("warning", f"    Issue sub-agent failed for {candidate_name}/{issue}: {exc}")

        for c in race_json.get("candidates", []):
            if c.get("name") == candidate_name:
                sd = c.get("issues", {}).get(issue, {})
                handoffs.append({
                    "issue": issue,
                    "stance": sd.get("stance", "(not set)") if isinstance(sd, dict) else "(not set)",
                    "confidence": sd.get("confidence", "?") if isinstance(sd, dict) else "?",
                })
                break

        if cache:
            cached_info = cache.list_cached_for_race(race_id)


# ---------------------------------------------------------------------------
# Shared phase runner — images → issues → finance → refinement
# ---------------------------------------------------------------------------


async def _run_shared_phases(
    race_json: Dict[str, Any],
    race_id: str,
    *,
    candidate_names: List[str],
    selected_name_set: set,
    model: str,
    small_model: str,
    on_log: Any,
    max_iterations: int,
    step_enabled: Any,
    track: Any,
    max_candidates: Optional[int],
    target_no_info: bool,
    is_update: bool,
    last_updated: str,
    refine_iters: int,
    log: Any,
) -> None:
    """Run images, issues, finance, and refinement phases.

    Mutates *race_json* in place.
    """
    prefix = "Update Phase" if is_update else "Phase"
    n = len(candidate_names)

    # --- Phase 1b: Image URL verification & resolution (parallel) ---
    if step_enabled("images"):
        track("start", "images")
        img_t0 = time.perf_counter()
        log("info", f"{prefix} 1b: Verifying and resolving candidate image URLs...")

        def _on_image_progress(pct: int, cand_name: str) -> None:
            track("progress", "images", pct=pct, message=f"Image Resolution: {cand_name}")

        await resolve_candidate_images(
            {
                "candidates": [c for c in race_json.get("candidates", []) if c.get("name") in selected_name_set],
                "office": race_json.get("office", ""),
                "jurisdiction": race_json.get("jurisdiction", ""),
            },
            agent_loop_fn=_agent_loop,
            model=small_model,
            on_log=on_log,
            race_id=race_id,
            max_iterations=min(max_iterations, 10),
            on_progress=_on_image_progress,
        )
        track("complete", "images", duration_ms=int((time.perf_counter() - img_t0) * 1000))
    else:
        log("info", f"{prefix} 1b: Image resolution — SKIPPED")
        track("skip", "images")

    # --- Phase 2: Per-candidate, per-issue research (tools mode) ---
    if step_enabled("issues"):
        track("start", "issues")
        iss_t0 = time.perf_counter()
        research_names = _select_candidates_for_research(
            candidate_names, race_json,
            max_candidates=max_candidates, target_no_info=target_no_info, log=log,
        )
        rn = len(research_names)
        n_issues = len(CANONICAL_ISSUES)
        total_units = max(rn * n_issues, 1)
        log("info", f"{prefix} 2: Researching issues for {rn} candidates ({n_issues} issues each)...")
        for ci, cand_name in enumerate(research_names):
            log("info", f"  {'Updating' if is_update else 'Researching'} issues for {cand_name}...")

            def _make_issue_tracker(ci=ci, cand_name=cand_name):
                def _on_issue(issue_idx: int, issue: str) -> None:
                    combined_pct = int((ci * n_issues + issue_idx) / total_units * 100)
                    track("progress", "issues", pct=combined_pct,
                          message=f"Issues · {cand_name} ({ci + 1}/{rn}) · {issue} ({issue_idx + 1}/{n_issues})")
                return _on_issue

            await _run_issue_research_for_candidate(
                cand_name,
                race_json,
                race_id=race_id,
                model=small_model,
                on_log=on_log,
                max_iterations=max_iterations,
                is_update=is_update,
                last_updated=last_updated,
                on_issue_progress=_make_issue_tracker(),
            )
        track("complete", "issues", duration_ms=int((time.perf_counter() - iss_t0) * 1000))
    else:
        log("info", f"{prefix} 2: Issue research — SKIPPED")
        track("skip", "issues")

    # --- Phase 2b: Dedicated finance & voting record research ---
    if step_enabled("finance"):
        track("start", "finance")
        fin_t0 = time.perf_counter()
        finance_iters = _scale_iterations(max_iterations, n, per_candidate=4, minimum=15)
        log("info", f"{prefix} 2b: Researching donors & voting records for {n} candidates...")
        try:
            finance_result = await _agent_loop(
                FINANCE_VOTING_SYSTEM,
                FINANCE_VOTING_USER.format(
                    race_id=race_id,
                    candidate_names=", ".join(candidate_names),
                ),
                model=model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=finance_iters,
                phase_name=f"{'update-' if is_update else ''}finance-voting",
                max_tokens=16384,
            )
            if isinstance(finance_result, dict):
                _apply_finance_patch(race_json, finance_result, log)
            else:
                log("warning", "  Finance/voting phase returned non-dict — skipping")
        except Exception as exc:
            log("warning", f"  Finance/voting phase failed: {exc} — continuing without")
        track("complete", "finance", duration_ms=int((time.perf_counter() - fin_t0) * 1000))
    else:
        log("info", f"{prefix} 2b: Finance & voting — SKIPPED")
        track("skip", "finance")

    # --- Phase 3: Refinement (tools mode — per-candidate + meta) ---
    if step_enabled("refinement"):
        track("start", "refinement")
        ref_t0 = time.perf_counter()
        handlers = _make_editing_handlers(race_json, log)
        cand_list = [c for c in race_json.get("candidates", []) if c.get("name") in selected_name_set]
        cand_names_in_json = [c["name"] for c in cand_list]
        n_cands = len(cand_list)
        log("info", f"{prefix} 3: Refining profile (one candidate at a time, tools mode)...")
        for ci, candidate in enumerate(cand_list):
            cname = candidate["name"]
            candidate_website, candidate_issue_urls = _candidate_source_hints(race_json, cname)
            issue_hint_text = ", ".join(candidate_issue_urls) if candidate_issue_urls else "(none found)"
            log("info", f"  Refining {cname}...")
            track("progress", "refinement", pct=int((ci / max(n_cands, 1)) * 100), message=f"Refinement: {cname} ({ci + 1}/{n_cands})")
            try:
                refine_prefix = "upd-refine" if is_update else "refine"
                await _agent_loop(
                    REFINE_SYSTEM,
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
                    model=model,
                    on_log=on_log,
                    race_id=race_id,
                    max_iterations=max(8, refine_iters // max(n_cands, 1)),
                    phase_name=f"{refine_prefix}-{cname[:20]}",
                    max_tokens=8192,
                    extra_tools=CANDIDATE_TOOLS + ISSUE_TOOLS + RECORD_TOOLS + BACKGROUND_TOOLS + [READ_PROFILE_TOOL],
                    extra_tool_handlers=handlers,
                    tools_mode=True,
                )
            except Exception as exc:
                log("warning", f"  Refine failed for {cname}: {exc} — keeping existing")

        # Meta refinement (description + polling) — tools mode
        log("info", "  Refining race metadata...")
        try:
            await _agent_loop(
                REFINE_SYSTEM,
                REFINE_META_USER.format(
                    race_id=race_id,
                    race_description=race_json.get("description", ""),
                    polling_json=json.dumps(race_json.get("polling", []), indent=2, default=str),
                ),
                model=model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=max(6, refine_iters // 3),
                phase_name=f"{'upd-' if is_update else ''}refine-meta",
                max_tokens=4096,
                extra_tools=RACE_TOOLS + [READ_PROFILE_TOOL],
                extra_tool_handlers=handlers,
                tools_mode=True,
            )
        except Exception as exc:
            log("warning", f"  Refine meta failed: {exc} — keeping existing meta")
        track("complete", "refinement", duration_ms=int((time.perf_counter() - ref_t0) * 1000))
    else:
        log("info", f"{prefix} 3: Refinement — SKIPPED")
        track("skip", "refinement")


# ---------------------------------------------------------------------------
# Fresh run (new race)
# ---------------------------------------------------------------------------


async def _run_fresh(
    race_id: str,
    *,
    model: str,
    small_model: str,
    on_log: Any | None = None,
    max_iterations: int = 15,
    step_enabled: Any = None,
    track: Any = None,
    max_candidates: Optional[int] = None,
    target_no_info: bool = False,
    target_candidate_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Phase 1 → 2 → 3: Discovery → Issue research → Refinement."""
    log = make_logger(on_log)
    if step_enabled is None:
        step_enabled = lambda s: True
    if track is None:
        track = lambda a, s, **kw: None

    # --- Phase 1: Discovery ---
    track("start", "discovery")
    disc_t0 = time.perf_counter()
    log("info", "Phase 1/3: Discovering race and candidates...")
    race_json = _ensure_dict(await _agent_loop(
        DISCOVERY_SYSTEM,
        DISCOVERY_USER.format(race_id=race_id),
        model=model,
        on_log=on_log,
        race_id=race_id,
        max_iterations=max_iterations,
        phase_name="discovery",
        max_tokens=16384,
    ), "discovery", log)

    candidate_names = [c["name"] for c in race_json.get("candidates", [])]
    candidate_names = _select_target_candidates(candidate_names, target_candidate_names, log)
    selected_name_set = set(candidate_names)
    n = len(candidate_names)
    if not candidate_names:
        log("warning", "No candidates found in discovery phase")
        track("complete", "discovery", duration_ms=int((time.perf_counter() - disc_t0) * 1000))
        return race_json

    refine_iters = _scale_iterations(max_iterations, n, per_candidate=2, minimum=12)
    log("info", f"  Iteration budgets — refine:{refine_iters}  (n={n} candidates)")
    track("complete", "discovery", duration_ms=int((time.perf_counter() - disc_t0) * 1000))

    await _run_shared_phases(
        race_json,
        race_id,
        candidate_names=candidate_names,
        selected_name_set=selected_name_set,
        model=model,
        small_model=small_model,
        on_log=on_log,
        max_iterations=max_iterations,
        step_enabled=step_enabled,
        track=track,
        max_candidates=max_candidates,
        target_no_info=target_no_info,
        is_update=False,
        last_updated="",
        refine_iters=refine_iters,
        log=log,
    )

    return race_json


# ---------------------------------------------------------------------------
# Update run (existing race)
# ---------------------------------------------------------------------------


async def _run_update(
    race_id: str,
    existing: Dict[str, Any],
    *,
    model: str,
    small_model: str,
    on_log: Any | None = None,
    max_iterations: int = 15,
    step_enabled: Any = None,
    track: Any = None,
    max_candidates: Optional[int] = None,
    target_no_info: bool = False,
    target_candidate_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Phase-based update mirroring _run_fresh but starting from existing data."""
    log = make_logger(on_log)
    if step_enabled is None:
        step_enabled = lambda s: True
    if track is None:
        track = lambda a, s, **kw: None

    race_json: Dict[str, Any] = copy.deepcopy(existing)

    existing_candidates = existing.get("candidates", [])
    candidate_names = [c["name"] for c in existing_candidates]
    candidate_names = _select_target_candidates(candidate_names, target_candidate_names, log)
    selected_name_set = set(candidate_names)
    n = len(candidate_names)
    last_updated = existing.get("updated_utc", "unknown")

    if not candidate_names:
        log("warning", "No candidates in existing data — falling back to fresh run")
        return await _run_fresh(
            race_id,
            model=model,
            small_model=small_model,
            on_log=on_log,
            max_iterations=max_iterations,
            step_enabled=step_enabled,
            track=track,
            max_candidates=max_candidates,
            target_no_info=target_no_info,
            target_candidate_names=target_candidate_names,
        )

    refine_iters = _scale_iterations(max_iterations, n, per_candidate=2, minimum=12)
    handlers = _make_editing_handlers(race_json, log)

    # --- Phase 0+1: Discovery (roster sync + meta update) ---
    if step_enabled("discovery"):
        track("start", "discovery")
        disc_t0 = time.perf_counter()

        log("info", "Update Phase 0: Verifying candidate roster...")
        try:
            await _agent_loop(
                ROSTER_SYNC_SYSTEM,
                ROSTER_SYNC_USER.format(
                    race_id=race_id,
                    last_updated=last_updated,
                    candidate_names=", ".join(candidate_names),
                ),
                model=small_model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=max(12, max_iterations // 2),
                phase_name="roster-sync",
                max_tokens=8192,
                extra_tools=ROSTER_TOOLS + [READ_PROFILE_TOOL],
                extra_tool_handlers=handlers,
                tools_mode=True,
            )
        except Exception as exc:
            log("warning", f"  Roster sync failed: {exc} — keeping existing roster")

        candidate_names = [c["name"] for c in race_json.get("candidates", [])]
        candidate_names = _select_target_candidates(candidate_names, target_candidate_names, log)
        selected_name_set = set(candidate_names)
        n = len(candidate_names)

        if not candidate_names:
            log("warning", "No candidates after roster sync — falling back to fresh run")
            track("skip", "discovery")
            return await _run_fresh(
                race_id,
                model=model,
                small_model=small_model,
                on_log=on_log,
                max_iterations=max_iterations,
                step_enabled=step_enabled,
                track=track,
                max_candidates=max_candidates,
                target_no_info=target_no_info,
                target_candidate_names=target_candidate_names,
            )

        track("progress", "discovery", pct=50, message="Discovery: updating race metadata")

        # --- Phase 1: Meta update (tools mode) ---
        meta_iters = _scale_iterations(max_iterations, n, per_candidate=2, minimum=10)
        log("info", "Update Phase 1: Searching for new summaries, donors, polls, voting records...")
        try:
            await _agent_loop(
                UPDATE_META_SYSTEM,
                UPDATE_META_USER.format(
                    race_id=race_id,
                    last_updated=last_updated,
                    candidate_names=", ".join(candidate_names),
                ),
                model=model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=meta_iters,
                phase_name="update-meta",
                max_tokens=16384,
                extra_tools=RACE_TOOLS + CANDIDATE_TOOLS + RECORD_TOOLS + [READ_PROFILE_TOOL],
                extra_tool_handlers=handlers,
                tools_mode=True,
            )
        except Exception as exc:
            log("warning", f"  Update meta phase failed: {exc} — keeping existing meta")

        track("complete", "discovery", duration_ms=int((time.perf_counter() - disc_t0) * 1000))
    else:
        log("info", "Update Phase 0+1: Discovery — SKIPPED")
        track("skip", "discovery")
        candidate_names = [c["name"] for c in race_json.get("candidates", [])]
        candidate_names = _select_target_candidates(candidate_names, target_candidate_names, log)
        selected_name_set = set(candidate_names)
        n = len(candidate_names)

    await _run_shared_phases(
        race_json,
        race_id,
        candidate_names=candidate_names,
        selected_name_set=selected_name_set,
        model=model,
        small_model=small_model,
        on_log=on_log,
        max_iterations=max_iterations,
        step_enabled=step_enabled,
        track=track,
        max_candidates=max_candidates,
        target_no_info=target_no_info,
        is_update=True,
        last_updated=last_updated,
        refine_iters=refine_iters,
        log=log,
    )

    return race_json


# ---------------------------------------------------------------------------
# Patch / merge helpers
# ---------------------------------------------------------------------------


def _apply_meta_patch(race_json: Dict[str, Any], patch: Dict[str, Any], log: Any) -> None:
    if "description" in patch and patch["description"]:
        race_json["description"] = patch["description"]

    if "polling" in patch and isinstance(patch["polling"], list) and patch["polling"]:
        existing_polls = race_json.get("polling", [])
        race_json["polling"] = patch["polling"] + existing_polls

    if patch.get("polling_note"):
        race_json["polling_note"] = patch["polling_note"]

    patch_candidates = {c["name"]: c for c in patch.get("candidates", []) if isinstance(c, dict)}
    for candidate in race_json.get("candidates", []):
        name = candidate.get("name")
        pc = patch_candidates.get(name)
        if not pc:
            continue
        if pc.get("summary"):
            candidate["summary"] = pc["summary"]
        if pc.get("donor_summary"):
            candidate["donor_summary"] = pc["donor_summary"]
    log("info", f"  Meta patch applied — {len(patch_candidates)} candidates updated")


def _apply_issue_patch(race_json: Dict[str, Any], patch: Dict[str, Any], log: Any) -> None:
    """Merge an issue patch into race_json candidates in-place."""
    updated = 0
    candidates_by_name = {c["name"]: c for c in race_json.get("candidates", [])}
    for cand_name, issues in patch.items():
        if not isinstance(issues, dict) or cand_name not in candidates_by_name:
            continue
        candidate = candidates_by_name[cand_name]
        candidate.setdefault("issues", {}).update(issues)
        updated += 1
    log("info", f"  Issue patch applied — {updated} candidates updated")


def _summarize_existing_stances(candidates: List[Dict[str, Any]], issues: List[str]) -> str:
    """Format existing stances for a set of issues as compact text for the prompt."""
    lines = []
    for c in candidates:
        name = c.get("name", "?")
        for issue in issues:
            stance_data = c.get("issues", {}).get(issue)
            if stance_data and isinstance(stance_data, dict):
                stance = stance_data.get("stance", "")
                conf = stance_data.get("confidence", "low")
                lines.append(f"  {name} / {issue} [{conf}]: {stance[:120]}")
            else:
                lines.append(f"  {name} / {issue}: MISSING")
    return "\n".join(lines) if lines else "  (no existing stances)"


def _apply_candidate_patch(candidate: Dict[str, Any], patch: Dict[str, Any], log: Any) -> None:
    """Merge a per-candidate patch dict into the candidate in-place."""
    cname = candidate.get("name", "?")
    for key in ("summary", "image_url", "website", "incumbent", "party",
                "donor_summary", "donor_source_url", "voting_summary", "voting_source_url"):
        if key in patch:
            candidate[key] = patch[key]
    for key in ("summary_sources", "career_history", "education"):
        val = patch.get(key)
        if isinstance(val, list) and val:
            candidate[key] = val
    new_links = patch.get("links")
    if isinstance(new_links, list) and new_links:
        existing_urls = {lnk.get("url") for lnk in candidate.get("links", [])}
        for lnk in new_links:
            if isinstance(lnk, dict) and lnk.get("url") not in existing_urls:
                candidate.setdefault("links", []).append(lnk)
                existing_urls.add(lnk.get("url"))
    new_issues = patch.get("issues")
    if isinstance(new_issues, dict) and new_issues:
        candidate.setdefault("issues", {}).update(new_issues)
    log("debug", f"  Candidate patch applied for {cname}")


def _apply_refine_patch(race_json: Dict[str, Any], meta_patch: Dict[str, Any],
                        candidate_patches: List[Dict[str, Any]], log: Any,
                        iteration_notes: List[str]) -> None:
    """Apply refine meta + per-candidate patches to race_json in-place."""
    if meta_patch.get("description"):
        race_json["description"] = meta_patch["description"]
    if isinstance(meta_patch.get("polling"), list) and meta_patch["polling"]:
        race_json["polling"] = meta_patch["polling"]
    candidates_by_name = {c["name"]: c for c in race_json.get("candidates", [])}
    for patch in candidate_patches:
        name = patch.get("name")
        if name and name in candidates_by_name:
            _apply_candidate_patch(candidates_by_name[name], patch, log)
            notes = patch.get("iteration_notes", [])
            if isinstance(notes, list):
                iteration_notes.extend(notes)


def _apply_finance_patch(race_json: Dict[str, Any], patch: Dict[str, Any], log: Any) -> None:
    """Merge finance/voting research results into race_json candidates in-place."""
    candidates_by_name = {c["name"]: c for c in race_json.get("candidates", [])}
    updated = 0
    for cand_name, data in patch.items():
        if not isinstance(data, dict) or cand_name not in candidates_by_name:
            continue
        candidate = candidates_by_name[cand_name]

        if data.get("donor_summary"):
            candidate["donor_summary"] = data["donor_summary"]
        if data.get("donor_source_url"):
            candidate["donor_source_url"] = data["donor_source_url"]
        if data.get("voting_summary"):
            candidate["voting_summary"] = data["voting_summary"]
        if data.get("voting_source_url"):
            candidate["voting_source_url"] = data["voting_source_url"]

        new_links = data.get("links", [])
        if isinstance(new_links, list) and new_links:
            existing_urls = {lnk.get("url") for lnk in candidate.get("links", []) if isinstance(lnk, dict)}
            for lnk in new_links:
                if isinstance(lnk, dict) and lnk.get("url") not in existing_urls:
                    candidate.setdefault("links", []).append(lnk)
                    existing_urls.add(lnk.get("url"))

        updated += 1
    log("info", f"  Finance/voting patch applied — {updated} candidates updated")


def _deduplicate_donors(donors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Kept for backward-compat with any update-run paths that may load old data."""
    best: Dict[str, Dict[str, Any]] = {}
    for d in donors:
        key = d.get("name", "").strip().lower()
        if not key:
            continue
        existing = best.get(key)
        if existing is None:
            best[key] = d
        else:
            new_amt = d.get("amount") or 0
            old_amt = existing.get("amount") or 0
            if new_amt > old_amt:
                best[key] = d
    return list(best.values())


# ---------------------------------------------------------------------------
# Review iteration
# ---------------------------------------------------------------------------


def _format_review_flags(reviews: List[Dict[str, Any]]) -> str:
    """Format review flags into a readable text block for the iteration prompt."""
    lines = []
    for review in reviews:
        model = review.get("model", "unknown")
        verdict = review.get("verdict", "unknown")
        lines.append(f"\n--- Review by {model} (verdict: {verdict}) ---")
        if review.get("summary"):
            lines.append(f"Summary: {review['summary']}")
        for flag in review.get("flags", []):
            severity = flag.get("severity", "info").upper()
            field = flag.get("field", "?")
            concern = flag.get("concern", "")
            suggestion = flag.get("suggestion", "")
            lines.append(f"  [{severity}] {field}: {concern}")
            if suggestion:
                lines.append(f"    Suggestion: {suggestion}")
    return "\n".join(lines) if lines else "  (no specific flags)"


def _has_actionable_flags(
    reviews: List[Dict[str, Any]],
    min_severity: str = "warning",
    exclude_fields: set | None = None,
) -> bool:
    """Return True if any review has actionable flags at or above *min_severity*."""
    severity_rank = {"info": 0, "warning": 1, "error": 2}
    threshold = severity_rank.get(min_severity, 1)
    _excluded = exclude_fields or set()
    for review in reviews:
        for flag in review.get("flags", []):
            rank = severity_rank.get(flag.get("severity", "info"), 0)
            if rank >= threshold and flag.get("field", "") not in _excluded:
                return True
    return False


async def _run_iteration_pass(
    race_id: str,
    race_json: Dict[str, Any],
    reviews: List[Dict[str, Any]],
    *,
    model: str,
    on_log: Any | None = None,
    max_iterations: int = 20,
) -> Optional[Dict[str, Any]]:
    """Run a single iteration pass addressing review flags (tools mode)."""
    log = make_logger(on_log)

    flags_text = _format_review_flags(reviews)
    candidates = race_json.get("candidates", [])
    n = len(candidates)
    iterate_iters = _scale_iterations(max_iterations, n, per_candidate=5, minimum=15)
    iters_per_cand = max(10, iterate_iters // max(n, 1))

    log("info", f"  Iteration: addressing review flags for {n} candidates (tools mode)")

    working = copy.deepcopy(race_json)
    handlers = _make_editing_handlers(working, log)
    all_tools = ROSTER_TOOLS + CANDIDATE_TOOLS + ISSUE_TOOLS + RECORD_TOOLS + BACKGROUND_TOOLS + RACE_TOOLS + [READ_PROFILE_TOOL]
    any_success = False

    for candidate in working.get("candidates", []):
        cname = candidate["name"]
        candidate_website, candidate_issue_urls = _candidate_source_hints(working, cname)
        issue_hint_text = ", ".join(candidate_issue_urls) if candidate_issue_urls else "(none found)"
        log("info", f"  Iterating on {cname}...")
        try:
            await _agent_loop(
                ITERATE_SYSTEM,
                ITERATE_USER.format(
                    race_id=race_id,
                    candidate_name=cname,
                    candidate_website=candidate_website,
                    candidate_issue_urls=issue_hint_text,
                    candidate_json=json.dumps(candidate, indent=2, default=str),
                    review_flags=flags_text,
                    all_issues=", ".join(CANONICAL_ISSUES),
                ),
                model=model,
                on_log=on_log,
                race_id=race_id,
                max_iterations=iters_per_cand,
                phase_name=f"iterate-{cname[:20]}",
                max_tokens=8192,
                extra_tools=all_tools,
                extra_tool_handlers=handlers,
                tools_mode=True,
            )
            any_success = True
        except Exception as exc:
            log("warning", f"  Iteration failed for {cname}: {exc} — keeping existing")

    log("info", "  Iterating on race metadata...")
    try:
        await _agent_loop(
            ITERATE_SYSTEM,
            ITERATE_META_USER.format(
                race_id=race_id,
                race_description=working.get("description", ""),
                polling_json=json.dumps(working.get("polling", []), indent=2, default=str),
                review_flags=flags_text,
            ),
            model=model,
            on_log=on_log,
            race_id=race_id,
            max_iterations=max(5, iters_per_cand // 2),
            phase_name="iterate-meta",
            max_tokens=4096,
            extra_tools=RACE_TOOLS + [READ_PROFILE_TOOL],
            extra_tool_handlers=handlers,
            tools_mode=True,
        )
        any_success = True
    except Exception as exc:
        log("warning", f"  Iteration meta failed: {exc} — keeping existing meta")

    if not any_success:
        log("warning", "  All iteration calls failed — keeping original")
        return None

    working.setdefault("id", race_id)
    return working
