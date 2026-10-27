"""Phase 4: refresh public polling data."""

import copy
import json
import time
from datetime import datetime, timezone

from ..handlers import _make_editing_handlers
from ..polling_quality import restore_dropped_baseline_polls
from ..prompts import POLLING_SYSTEM, POLLING_USER
from ..tools import POLLING_TOOLS, READ_PROFILE_TOOL
from ..wikipedia_polls import wikipedia_poll_context
from ._common import _classify_exception, _is_control_flow_exception, _race_identity_context, _record_step_failure
from .context import PhaseContext


async def run_polling_phase(ctx: PhaseContext) -> None:
    """Refresh available polling data for the race."""
    race_json = ctx.race_json
    race_id = ctx.race_id
    # Polling is race-level: a general-election poll pits every nominee against the
    # others. ctx.candidate_names is the run's *research* scope, which a run targeted
    # at one candidate narrows to that person. Passing that subset to this prompt told
    # the model the other nominees were not in the race, so it rejected every real
    # poll and dropped the ones already stored (oh-house-10-2026, issue #392).
    candidate_names = [
        name
        for candidate in race_json.get("candidates", [])
        if isinstance(candidate, dict) and (name := str(candidate.get("name") or "").strip())
    ]
    small_model = ctx.small_model
    on_log = ctx.on_log
    max_iterations = ctx.max_iterations
    step_enabled = ctx.step_enabled
    track = ctx.track
    is_update = ctx.is_update
    log = ctx.log
    prefix = ctx.prefix
    run_budget = ctx.run_budget
    from . import _agent_loop

    if not step_enabled("polling"):
        track("skip", "polling")
        return

    track("start", "polling")
    polling_t0 = time.perf_counter()
    # Snapshot the stored polls: a valid baseline survey must not be lost silently
    # (ks-senate-2026 dropped InsiderAdvantage 2026-10-10 beside its 2026-10-14 release).
    baseline_polls = copy.deepcopy(race_json.get("polling") or [])
    poll_removals: list = []
    handlers = _make_editing_handlers(race_json, log, poll_removals=poll_removals)
    log("info", f"{prefix} 4: Refreshing public polling...")
    # Wikipedia's poll table lists polls web search keeps missing (PDF-only releases,
    # sponsored polls). It is reference context only; add_poll still validates and dedupes.
    wikipedia_polls = await wikipedia_poll_context(race_json, candidate_names, race_id=race_id)
    if wikipedia_polls:
        log("info", "  Wikipedia poll table supplied as reference context")
    try:
        await _agent_loop(
            POLLING_SYSTEM,
            POLLING_USER.format(
                race_id=race_id,
                current_date=datetime.now(timezone.utc).date().isoformat(),
                candidate_names=", ".join(candidate_names),
                polling_json=json.dumps(race_json.get("polling", []), indent=2, default=str),
                wikipedia_polls=wikipedia_polls,
                race_identity_context=_race_identity_context(race_json),
            ),
            model=small_model,
            on_log=on_log,
            race_id=race_id,
            max_iterations=min(max_iterations, 10),
            phase_name=f"{'update-' if is_update else ''}polling",
            max_tokens=8192,
            extra_tools=POLLING_TOOLS + [READ_PROFILE_TOOL],
            extra_tool_handlers=handlers,
            tools_mode=True,
            run_budget=run_budget,
        )
    except Exception as exc:
        if _is_control_flow_exception(exc):
            raise
        log("warning", f"  Polling phase failed: {exc}")
        _record_step_failure(race_json, "polling", _classify_exception(exc), str(exc))
    finally:
        # Also on a budget stop: race_json may be checkpointed mid-phase.
        restore_dropped_baseline_polls(race_json, baseline_polls, removals=poll_removals, log=log)
    track("complete", "polling", duration_ms=int((time.perf_counter() - polling_t0) * 1000), race_json=race_json)
