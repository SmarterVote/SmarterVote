"""Phase 6: report the general-election result for one race. Runs only when asked."""

import json
import time
from datetime import datetime, timezone

from shared.election_results import poll_close_utc

from ..handlers import _make_results_handlers
from ..prompts import RESULTS_SYSTEM, RESULTS_USER
from ..tools import RECORD_RACE_RESULT_TOOL
from ..web_tools import fresh_web_reads
from ._common import _classify_exception, _is_control_flow_exception, _record_step_failure
from .context import PhaseContext

#: Bounds one check. A race the model cannot settle in this many turns stays
#: uncalled for a person to look at; this step must never get expensive.
_RESULTS_MAX_ITERATIONS = 6
_RESULTS_MAX_TOKENS = 2048


async def run_results_phase(ctx: PhaseContext) -> None:
    """Record the race's current result on the draft, using uncached reads only."""
    race_json = ctx.race_json
    log = ctx.log
    if not ctx.step_enabled("results"):
        ctx.track("skip", "results")
        return
    from . import _agent_loop

    ctx.track("start", "results")
    results_t0 = time.perf_counter()
    election_date = str(race_json.get("election_date") or "")
    closes_at = poll_close_utc(race_json.get("state"), election_date[:10])
    if datetime.now(timezone.utc) < closes_at:
        # Not a failure, and not worth a model call: there is nothing to report.
        log("info", f"  Polls close at {closes_at.isoformat()}; no results to look for yet")
        ctx.track("complete", "results", duration_ms=0, race_json=race_json)
        return

    candidates = [c.get("name") for c in race_json.get("candidates", []) if isinstance(c, dict) and c.get("name")]
    log("info", f"{ctx.prefix} 6: Checking election results...")
    try:
        with fresh_web_reads():
            await _agent_loop(
                RESULTS_SYSTEM,
                RESULTS_USER.format(
                    race_id=ctx.race_id,
                    office=race_json.get("office") or "",
                    jurisdiction=race_json.get("jurisdiction") or "",
                    state=race_json.get("state") or "",
                    election_date=election_date,
                    candidates=json.dumps(candidates),
                    previous=json.dumps(race_json.get("result"), default=str),
                ),
                model=ctx.small_model,
                on_log=ctx.on_log,
                race_id=ctx.race_id,
                max_iterations=_RESULTS_MAX_ITERATIONS,
                phase_name="results",
                max_tokens=_RESULTS_MAX_TOKENS,
                extra_tools=[RECORD_RACE_RESULT_TOOL],
                extra_tool_handlers=_make_results_handlers(race_json, log),
                tools_mode=True,
                run_budget=ctx.run_budget,
            )
    except Exception as exc:
        if _is_control_flow_exception(exc):
            raise
        log("warning", f"  Results phase failed: {exc}")
        _record_step_failure(race_json, "results", _classify_exception(exc), str(exc))
    ctx.track("complete", "results", duration_ms=int((time.perf_counter() - results_t0) * 1000), race_json=race_json)
