/**
 * Queue presets used by the admin Races tab.
 *
 * Queuing with empty options makes the worker run EVERY step (full issue
 * research), which costs ~5-10x a refresh. The admin UI therefore always sends
 * an explicit step list: the lightweight core refresh by default, and the
 * combined full-research list only when the operator picks it explicitly.
 * Both mirror CLAUDE.md "Pipeline run cost" and `refresh_race_core` in
 * smartervote_mcp/server.py.
 */
import type { RunOptions } from "$lib/types";

/** Canonical lightweight refresh (roster, headshots, polls, forecast, resources). */
export const REFRESH_STEPS = [
  "discovery",
  "images",
  "polling",
  "forecast",
  "voter_resources",
] as const;

/** Combined full-research run; never split issues from review/iteration. */
export const FULL_RESEARCH_STEPS = [
  "issues",
  "finance",
  "refinement",
  "polling",
  "forecast",
  "voter_resources",
  "review",
  "iteration",
] as const;

/** Approximate USD per race for the refresh core. */
export const REFRESH_COST_PER_RACE_USD = 0.09;
/** Approximate USD per candidate for full issue research. */
export const FULL_COST_PER_CANDIDATE_USD: [number, number] = [0.2, 0.3];
/** Hard cap on races queued from one batch action. */
export const MAX_BATCH_QUEUE = 10;

export function refreshRunOptions(): RunOptions {
  return {
    enabled_steps: [...REFRESH_STEPS],
    model_profile: "default",
    cheap_mode: true,
    baseline_source: "latest",
  };
}

export function fullResearchRunOptions(): RunOptions {
  return {
    enabled_steps: [...FULL_RESEARCH_STEPS],
    model_profile: "default",
    cheap_mode: true,
    baseline_source: "latest",
  };
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function refreshCostEstimate(raceCount: number): string {
  return `~${usd(raceCount * REFRESH_COST_PER_RACE_USD)} (${raceCount} × ~${usd(
    REFRESH_COST_PER_RACE_USD,
  )}/race)`;
}

export function fullResearchCostEstimate(candidateCount: number): string {
  const [low, high] = FULL_COST_PER_CANDIDATE_USD;
  const n = Math.max(1, candidateCount);
  return `~${usd(n * low)}–${usd(n * high)} (${n} candidate${
    n === 1 ? "" : "s"
  } × ${usd(low)}–${usd(high)})`;
}
