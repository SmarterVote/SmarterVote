/**
 * Election night on the forecast page: short result lines for race cards and
 * a results overlay for the map. Kept apart from results.ts so the results
 * page's own wording and status labels stay in one place.
 */
import type { PublicRaceResult, RaceSummary } from "$lib/types";
import {
  getRaceState,
  isRaceInForecastTab,
  type ForecastTab,
} from "$lib/utils/forecast";
import type { StateTooltip } from "$lib/utils/forecastPresentation";
import { partyKey } from "$lib/utils/party";
import {
  formatPctReporting,
  resultGroup,
  resultStatusLabel,
  sortResultRows,
  type ResultGroup,
} from "$lib/utils/results";

/**
 * Whether any race has reported votes or a call: across the whole file, or
 * only among `raceIds` when given.
 */
export function hasAnyResults(
  results: Map<string, PublicRaceResult> | null | undefined,
  raceIds?: Iterable<string>,
): boolean {
  if (!results || results.size === 0) return false;
  if (raceIds) {
    for (const id of raceIds) {
      if (resultGroup(results.get(id)?.status) !== "awaiting") return true;
    }
    return false;
  }
  for (const row of results.values()) {
    if (resultGroup(row?.status) !== "awaiting") return true;
  }
  return false;
}

/** "D", "R", "I"… for a result row; an unknown party keeps its own name. */
export function shortParty(party: string | null | undefined): string {
  if (!party || !party.trim()) return "";
  const key = partyKey(party);
  if (key === "dem") return "D";
  if (key === "rep") return "R";
  if (key === "ind") return "I";
  if (key === "grn") return "G";
  if (key === "lib") return "L";
  return party.trim();
}

function nameWithParty(
  name: string | null | undefined,
  party: string | null | undefined,
): string {
  const abbr = shortParty(party);
  const who = (name ?? "").trim();
  if (who && abbr) return `${who} (${abbr})`;
  return who || abbr;
}

/** A margin in points: one decimal under 10, whole points from 10 up. */
function formatMarginPts(margin: number): string {
  if (margin >= 9.95) return `${Math.round(margin)} pts`;
  const shown = margin.toFixed(1);
  return `${shown} ${shown === "1.0" ? "pt" : "pts"}`;
}

export interface ForecastResultLine {
  group: ResultGroup;
  /** Short, plain line such as "Called: Jane Doe (D)". */
  text: string;
  /** The winner's party when called, else the leader's; null when unknown or tied. */
  party: string | null;
}

/**
 * The one-line result summary a forecast card shows, or null while a race has
 * no votes reported (the forecast alone is then the right thing to show).
 */
export function forecastResultLine(
  result: PublicRaceResult | null | undefined,
): ForecastResultLine | null {
  if (!result) return null;
  const group = resultGroup(result.status);
  if (group === "awaiting") return null;
  const rows = sortResultRows(result.candidates ?? []);
  const top = rows[0];
  const counted = formatPctReporting(result.pct_reporting);

  if (group === "called") {
    // Never pair the named winner with another candidate's party.
    const party =
      result.winner_party ||
      (!result.winner_name || result.winner_name === top?.name
        ? top?.party
        : null) ||
      null;
    const who = nameWithParty(result.winner_name || top?.name, party);
    const verb =
      result.status === "certified"
        ? "Certified"
        : result.status === "unopposed"
          ? "Unopposed"
          : "Called";
    return { group, text: who ? `${verb}: ${who}` : verb, party };
  }

  const parts: string[] = [];
  if (result.status === "too_close") parts.push("Too close to call");
  else if (group === "pending") parts.push(resultStatusLabel(result.status));
  let party: string | null = null;
  if (
    top &&
    typeof top.pct === "number" &&
    Number.isFinite(top.pct) &&
    top.pct > 0
  ) {
    const second = rows[1];
    const margin =
      typeof second?.pct === "number" && Number.isFinite(second.pct)
        ? top.pct - second.pct
        : null;
    if (margin !== null && margin < 0.05) {
      parts.push("Tied");
    } else {
      party = top.party ?? null;
      const who = nameWithParty(top.name, top.party);
      parts.push(
        margin === null
          ? `${who} leads`
          : `${who} leads by ${formatMarginPts(margin)}`,
      );
    }
  } else if (group === "counting") {
    parts.push("Votes being counted");
  }
  if (counted) parts.push(`${counted} counted`);
  return { group, text: parts.join(" · "), party };
}

/** Map fills for the results overlay (the patterns and variables live in USMap). */
export const RESULT_FILLS = {
  calledD: "var(--color-safe-d)",
  calledR: "var(--color-safe-r)",
  calledOther: "var(--color-result-other)",
  leadD: "url(#map-result-lead-d)",
  leadR: "url(#map-result-lead-r)",
  leadOther: "url(#map-result-lead-other)",
} as const;

function fillFor(party: string | null, called: boolean): string | null {
  if (!party) return null;
  const key = partyKey(party);
  if (key === "dem") return called ? RESULT_FILLS.calledD : RESULT_FILLS.leadD;
  if (key === "rep") return called ? RESULT_FILLS.calledR : RESULT_FILLS.leadR;
  return called ? RESULT_FILLS.calledOther : RESULT_FILLS.leadOther;
}

export interface ResultMapOverlay {
  /** Only the states results recolor; every other state keeps its forecast fill. */
  colors: Record<string, string>;
  /** Result lines to add to the top of a state's forecast tooltip. */
  details: Record<string, string[]>;
  /** States with at least one race with votes or a call. */
  reportingStates: number;
}

/**
 * Per-state colors for the map's "Show results" view. A state is solid in the
 * winner's color once every race it holds in this tab is called for one
 * party, hatched in the leader's color while its single race is still being
 * counted, and otherwise keeps its forecast color, with results in the tooltip.
 */
export function buildResultMapOverlay(
  races: RaceSummary[],
  activeTab: ForecastTab,
  results: Map<string, PublicRaceResult> | null | undefined,
): ResultMapOverlay {
  const colors: Record<string, string> = {};
  const details: Record<string, string[]> = {};
  let reportingStates = 0;
  if (!results || results.size === 0)
    return { colors, details, reportingStates };

  const byState = new Map<string, RaceSummary[]>();
  for (const race of races) {
    if (!isRaceInForecastTab(race, activeTab)) continue;
    const state = getRaceState(race);
    if (!state) continue;
    const list = byState.get(state) ?? [];
    list.push(race);
    byState.set(state, list);
  }

  for (const [state, stateRaces] of byState) {
    const reported = stateRaces
      .map((race) => forecastResultLine(results.get(race.id)))
      .filter((line): line is ForecastResultLine => line !== null);
    if (reported.length === 0) continue;
    reportingStates += 1;

    const called = reported.filter((line) => line.group === "called");
    const total = stateRaces.length;
    if (total > 1) {
      // Several races (House districts, a special Senate election).
      const lines = [`Results: ${called.length} of ${total} called`];
      const tally = new Map<string, number>();
      for (const line of called) {
        const abbr = shortParty(line.party) || "Other";
        tally.set(abbr, (tally.get(abbr) ?? 0) + 1);
      }
      if (tally.size > 0) {
        lines.push(
          `Won so far: ${[...tally].map(([abbr, n]) => `${abbr} ${n}`).join(", ")}`,
        );
      }
      details[state] = lines;
    } else {
      details[state] = [`Result: ${reported[0].text}`];
    }

    const calledParties = new Set(called.map((line) => partyKey(line.party)));
    if (called.length === total && calledParties.size === 1) {
      const fill = fillFor(called[0].party, true);
      if (fill) colors[state] = fill;
    } else if (total === 1 && reported[0].group !== "called") {
      const fill = fillFor(reported[0].party, false);
      if (fill) colors[state] = fill;
    }
  }
  return { colors, details, reportingStates };
}

/** The forecast tooltips with the overlay's result lines on top; inputs untouched. */
export function withResultTooltips(
  tooltips: Record<string, StateTooltip>,
  overlay: ResultMapOverlay,
): Record<string, StateTooltip> {
  const merged: Record<string, StateTooltip> = { ...tooltips };
  for (const [state, lines] of Object.entries(overlay.details)) {
    const base = merged[state] ?? { title: state };
    merged[state] = { ...base, details: [...lines, ...(base.details ?? [])] };
  }
  return merged;
}
