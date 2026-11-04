import { browser } from "$app/environment";
import { readable, writable } from "svelte/store";
import { daysUntilElection } from "$lib/utils/electionDate";
import type {
  PublicRaceResult,
  PublicResultCandidate,
  PublicResultsFile,
  RaceResult,
  RaceResultStatus,
} from "$lib/types";

/** The 2026 U.S. general election, as a calendar date. */
export const GENERAL_ELECTION_DATE = "2026-11-03";

/**
 * Whether results are worth pointing to: Election Day (local calendar date)
 * or any day after it. It never switches back off.
 */
export function isResultsSeason(now: Date = new Date()): boolean {
  const days = daysUntilElection(GENERAL_ELECTION_DATE, now);
  return days !== null && days <= 0;
}

/** How many races the live file names a winner for (called/certified/unopposed). */
export function calledRaceCount(
  results: Map<string, PublicRaceResult> | null | undefined,
): number {
  if (!results) return 0;
  let count = 0;
  for (const row of results.values()) {
    if (resultGroup(row?.status) === "called") count += 1;
  }
  return count;
}

const RESULTS_URL = "/results-live.json";
const REFRESH_MS = 60_000;

export type ResultOffice = "governor" | "senate" | "house" | "other";

/** One row of the results page's full list, trimmed from the race summaries. */
export interface ResultDirectoryRace {
  id: string;
  title: string;
  state: string;
  office: ResultOffice;
  competitive: boolean;
}

const OFFICE_ORDER: Record<ResultOffice, number> = {
  governor: 0,
  senate: 1,
  house: 2,
  other: 3,
};

export function resultOffice(
  office: string | null | undefined,
  id = "",
): ResultOffice {
  const text = `${office ?? ""} ${id}`.toLocaleLowerCase();
  if (text.includes("governor") || text.includes("gubernatorial"))
    return "governor";
  if (text.includes("senate")) return "senate";
  if (text.includes("house") || text.includes("representative")) return "house";
  return "other";
}

/** Every Election Day race, sorted by state, then governor, Senate, House. */
export function resultDirectory(
  races: {
    id: string;
    title?: string | null;
    office?: string | null;
    state?: string | null;
    election_date?: string | null;
    forecast?: { rating?: string | null } | null;
  }[],
): ResultDirectoryRace[] {
  return races
    .filter((race) => race.election_date === GENERAL_ELECTION_DATE)
    .map((race) => ({
      id: race.id,
      title: race.title ?? race.id,
      state: race.state ?? "Other",
      office: resultOffice(race.office, race.id),
      competitive: /^(tossup|tilt_|lean_)/.test(race.forecast?.rating ?? ""),
    }))
    .sort(
      (a, b) =>
        a.state.localeCompare(b.state) ||
        OFFICE_ORDER[a.office] - OFFICE_ORDER[b.office] ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
}

/** The races Phase 1 covers first: already drawing traffic before Election Day. */
export const PRIORITY_RESULT_RACES: {
  id: string;
  title: string;
  state: string;
}[] = [
  { id: "co-governor-2026", title: "Colorado Governor", state: "Colorado" },
  { id: "co-senate-2026", title: "Colorado U.S. Senate", state: "Colorado" },
  { id: "fl-governor-2026", title: "Florida Governor", state: "Florida" },
  {
    id: "fl-senate-2026-special",
    title: "Florida U.S. Senate (special)",
    state: "Florida",
  },
  {
    id: "ma-governor-2026",
    title: "Massachusetts Governor",
    state: "Massachusetts",
  },
  {
    id: "ma-senate-2026",
    title: "Massachusetts U.S. Senate",
    state: "Massachusetts",
  },
  { id: "oh-governor-2026", title: "Ohio Governor", state: "Ohio" },
  {
    id: "oh-senate-2026-special",
    title: "Ohio U.S. Senate (special)",
    state: "Ohio",
  },
  { id: "tn-governor-2026", title: "Tennessee Governor", state: "Tennessee" },
  { id: "tn-senate-2026", title: "Tennessee U.S. Senate", state: "Tennessee" },
];

const STATUS_LABELS: Record<RaceResultStatus, string> = {
  not_yet_reported: "No votes reported yet",
  counting: "Votes counted so far: not a call",
  too_close: "Too close to call",
  called: "Projected winner",
  runoff_required: "Headed to a runoff",
  rcv_pending: "Ranked-choice count pending",
  certified: "Certified winner",
  unopposed: "Unopposed",
};

export function resultStatusLabel(status: RaceResultStatus): string {
  return STATUS_LABELS[status] ?? "Results pending";
}

/** Every result is unofficial until the election authority certifies it. */
export function isUnofficial(status: RaceResultStatus): boolean {
  return status !== "certified";
}

export function namesWinner(status: RaceResultStatus): boolean {
  return (
    status === "called" || status === "certified" || status === "unopposed"
  );
}

export function isStillCounting(status: RaceResultStatus): boolean {
  return status === "counting" || status === "too_close";
}

export type ResultGroup = "called" | "counting" | "pending" | "awaiting";

/** The bucket the results page counts and filters a race under. */
export function resultGroup(
  status: RaceResultStatus | null | undefined,
): ResultGroup {
  if (!status || status === "not_yet_reported") return "awaiting";
  if (namesWinner(status)) return "called";
  if (isStillCounting(status)) return "counting";
  return "pending";
}

/** Deliberately not party colors: a status says nothing about who is ahead. */
export function resultStatusClass(
  status: RaceResultStatus | null | undefined,
): string {
  switch (resultGroup(status)) {
    case "called":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200";
    case "counting":
      return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100";
    case "pending":
      return "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800/60 dark:bg-purple-950/40 dark:text-purple-200";
    default:
      return "border-stroke bg-surface-alt text-content-subtle";
  }
}

/** Highest share first; ties and missing counts keep the order they came in. */
export function sortResultRows(
  rows: PublicResultCandidate[],
): PublicResultCandidate[] {
  return [...rows].sort(
    (a, b) =>
      (b.pct ?? -1) - (a.pct ?? -1) || (b.votes ?? -1) - (a.votes ?? -1),
  );
}

export function compareHref(raceId: string): string {
  return `/races/${encodeURIComponent(raceId)}/compare/`;
}

/** The fresher of the copy built into the page and the live file. */
export function newestResult(
  built: RaceResult | PublicRaceResult | null | undefined,
  live: PublicRaceResult | null | undefined,
): RaceResult | PublicRaceResult | null {
  if (!built) return live ?? null;
  if (!live) return built;
  return String(live.as_of ?? "") >= String(built.as_of ?? "") ? live : built;
}

export async function fetchLiveResults(
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, PublicRaceResult> | null> {
  try {
    const response = await fetchFn(RESULTS_URL);
    if (!response.ok) return null;
    const file = (await response.json()) as PublicResultsFile;
    if (!Array.isArray(file?.races)) return null;
    return new Map(file.races.map((row) => [row.id, row]));
  } catch {
    return null;
  }
}

/** Whether the live file has loaded, for the page's freshness line. */
export const liveResultsState = writable<{
  status: "loading" | "ready" | "error";
  updatedAt: Date | null;
}>({ status: "loading", updatedAt: null });

/**
 * Live results, refreshed each minute while the tab is visible. A failed fetch
 * keeps the last good copy, which shows its own as-of time.
 */
export const liveResults = readable<Map<string, PublicRaceResult>>(
  new Map(),
  (set) => {
    if (!browser) return;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await fetchLiveResults();
      if (next) {
        set(next);
        liveResultsState.set({ status: "ready", updatedAt: new Date() });
      } else {
        liveResultsState.update((state) => ({ ...state, status: "error" }));
      }
    };
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  },
);
