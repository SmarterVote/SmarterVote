import { browser } from "$app/env";
import { readable, writable } from "svelte/store";
import { daysUntilElection } from "$lib/utils/electionDate";
import { canonicalRaceState } from "$lib/utils/states";
import {
  CHAMBER_SEAT_TOTALS,
  GOVERNOR_HOLDOVERS,
  SENATE_HOLDOVERS,
} from "$lib/utils/holdovers";
import { fetchLiveFeed } from "$lib/utils/liveFeedUrl";
import { partyKey } from "$lib/utils/party";
import type {
  LiveChamberProjection,
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

const RESULTS_FILE = "results-live.json";
const REFRESH_MS = 60_000;

export type ResultOffice = "governor" | "senate" | "house" | "other";

/** One row of the results page's full list, trimmed from the race summaries. */
export interface ResultDirectoryRace {
  id: string;
  title: string;
  state: string;
  office: ResultOffice;
  competitive: boolean;
  /** The pre-election forecast's pick, kept only when the summary has one. */
  predicted_winner_name?: string | null;
  predicted_winner_party?: string | null;
  /**
   * The party holding the seat now, kept only when exactly one candidate is
   * flagged as the incumbent and their party is a named one. Open seats and
   * member-vs-member races carry nothing, so no flip is ever guessed.
   */
  holder_party?: string | null;
}

/**
 * The seat's current party from the candidate list: the lone incumbent's
 * party, or null when there is no incumbent, more than one, or the party
 * label does not name a party.
 */
export function seatHolderParty(
  candidates:
    { incumbent?: boolean | null; party?: string | null }[] | null | undefined,
): string | null {
  const incumbents = (candidates ?? []).filter((c) => c?.incumbent === true);
  if (incumbents.length !== 1) return null;
  const party = incumbents[0].party?.trim() ?? "";
  return party && partyKey(party) !== "other" ? party : null;
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

/** A forecast's named pick, or null for a blank or a "Toss-up" placeholder. */
function forecastPick(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text && !/^toss[\s-]?up$/i.test(text) ? text : null;
}

/** Every Election Day race, sorted by state, then governor, Senate, House. */
export function resultDirectory(
  races: {
    id: string;
    title?: string | null;
    office?: string | null;
    state?: string | null;
    election_date?: string | null;
    candidates?: { incumbent?: boolean | null; party?: string | null }[] | null;
    forecast?: {
      rating?: string | null;
      predicted_winner_name?: string | null;
      predicted_winner_party?: string | null;
    } | null;
  }[],
): ResultDirectoryRace[] {
  return races
    .filter((race) => race.election_date === GENERAL_ELECTION_DATE)
    .map((race) => {
      const name = forecastPick(race.forecast?.predicted_winner_name);
      const party = forecastPick(race.forecast?.predicted_winner_party);
      const holder = seatHolderParty(race.candidates);
      return {
        id: race.id,
        title: race.title ?? race.id,
        state: canonicalRaceState(race) ?? "Other",
        office: resultOffice(race.office, race.id),
        competitive: /^(tossup|tilt_|lean_)/.test(race.forecast?.rating ?? ""),
        ...(name || party
          ? { predicted_winner_name: name, predicted_winner_party: party }
          : {}),
        ...(holder ? { holder_party: holder } : {}),
      };
    })
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
  counting: "Counting",
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

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
  if (parts.length > 1 && suffix.test(parts[parts.length - 1])) parts.pop();
  let start = parts.length - 1;
  // Keep surname particles: "Beth Van Duyne" is Van Duyne, "Ray De La Cruz" is De La Cruz.
  const particle = /^(van|von|de|del|della|der|den|di|da|du|la|le|st\.?)$/i;
  while (start > 1 && particle.test(parts[start - 1])) start -= 1;
  return parts.slice(start).join(" ").replace(/,$/, "");
}

/**
 * Who is ahead in a race still being counted, e.g. "Wittman leads by 0.7 pts",
 * from the candidates' shares (or votes when no shares are reported). Rows
 * are compared on one basis only: shares when every row has one, else votes
 * when every row has one, else the rows that have a share. When the shares
 * round to a tie, the vote counts break it ("Colom leads by 43 votes").
 */
export function resultLeadLabel(
  result:
    | {
        status: RaceResultStatus;
        candidates?:
          { name: string; pct?: number | null; votes?: number | null }[] | null;
      }
    | null
    | undefined,
): string | null {
  if (!result || !isStillCounting(result.status)) return null;
  const all = (result.candidates ?? []).filter(
    (row) => finiteNumber(row.pct) || finiteNumber(row.votes),
  );
  const usePct =
    all.every((row) => finiteNumber(row.pct)) ||
    !all.every((row) => finiteNumber(row.votes));
  const rows = usePct ? all.filter((row) => finiteNumber(row.pct)) : all;
  if (rows.length < 2) return null;
  const value = (row: (typeof rows)[number]) =>
    (usePct ? row.pct : row.votes) ?? 0;
  const [first, second] = [...rows].sort(
    (a, b) => value(b) - value(a) || (b.votes ?? -1) - (a.votes ?? -1),
  );
  const margin = value(first) - value(second);
  if (usePct && margin < TIE_POINTS) {
    const votes =
      finiteNumber(first.votes) && finiteNumber(second.votes)
        ? first.votes - second.votes
        : 0;
    return votes > 0
      ? `${lastName(first.name)} leads by ${votes.toLocaleString("en-US")} ${votes === 1 ? "vote" : "votes"}`
      : "Tied";
  }
  if (margin <= 0) return "Tied";
  const amount = usePct
    ? `${margin.toFixed(1)} pts`
    : `${margin.toLocaleString("en-US")} votes`;
  return `${lastName(first.name)} leads by ${amount}`;
}

/** A share lead below this rounds to "0.0 pts", so it reads as a tie. */
export const TIE_POINTS = 0.05;

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A lead for a compact card: "+2.4" pts, "+43" votes when the shares round
 * to a tie, or "Tied". Null when there is no margin to show.
 */
export function formatLead(
  margin: number | null | undefined,
  voteMargin: number | null | undefined = null,
): { value: string; unit: "pts" | "votes" | "" } | null {
  if (!finiteNumber(margin)) return null;
  if (margin < TIE_POINTS) {
    return finiteNumber(voteMargin) && voteMargin > 0
      ? { value: `+${voteMargin.toLocaleString("en-US")}`, unit: "votes" }
      : { value: "Tied", unit: "" };
  }
  if (margin < 0.1) return { value: "+<0.1", unit: "pts" };
  return { value: `+${margin.toFixed(1)}`, unit: "pts" };
}

// ---------------------------------------------------------------------------
// Data-quality guards. The feed is assembled from many sources on election
// night; these keep a bad row from being drawn as if it were a real count.

/** The earliest poll close on general Election Day (6 p.m. ET in Indiana and Kentucky). */
export const FIRST_POLL_CLOSE = `${GENERAL_ELECTION_DATE}T23:00:00Z`;
/** How far past the feed's own clock a timestamp may run (clock skew). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * A call time that can be shown, in ms, or null. Rejects unparseable values,
 * a bare date or a zone-less midnight (the extractor's "time unknown"),
 * anything before the first polls closed, and anything later than
 * `reference` (the feed's generated time, else now) plus a few minutes.
 */
export function trustedCallTime(
  value: string | null | undefined,
  reference: Date | number = Date.now(),
): number | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}(T00:00(:00(\.0+)?)?)?$/.test(text)) return null;
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return null;
  const ref = typeof reference === "number" ? reference : reference.getTime();
  if (time < Date.parse(FIRST_POLL_CLOSE)) return null;
  if (Number.isFinite(ref) && time > ref + FUTURE_TOLERANCE_MS) return null;
  return time;
}

/** A row still counting whose count has not moved in this long may be behind. */
export const ROW_STALE_AFTER_MS = 12 * 60 * 60_000;

/** Whether a race still being counted has an `as_of` older than 12 hours. */
export function isRowStale(
  result:
    { status: RaceResultStatus; as_of?: string | null } | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (!result || !isStillCounting(result.status) || !result.as_of) return false;
  const time = Date.parse(result.as_of);
  if (!Number.isFinite(time)) return false;
  const ref = typeof now === "number" ? now : now.getTime();
  return ref - time > ROW_STALE_AFTER_MS;
}

/** More votes than any one House district casts (2024's largest was under 450k). */
export const HOUSE_MAX_VOTES = 600_000;
/** The implied full count for a House district, from votes and share counted. */
export const HOUSE_MAX_IMPLIED_VOTES = 1_000_000;

/**
 * Whether a House row's vote total is impossible for one district: above
 * 600k counted, or above 1M once scaled up by the share counted (from 20%
 * counted on, so a tiny early count is not blown up). Such rows are almost
 * always statewide or wrong-race numbers, so they are held "under review".
 */
export function implausibleCount(
  result:
    | {
        id?: string;
        title?: string | null;
        pct_reporting?: number | null;
        candidates?: { votes?: number | null }[] | null;
      }
    | null
    | undefined,
  id = result?.id ?? "",
): boolean {
  if (!result || resultOffice(result.title, id) !== "house") return false;
  const total = (result.candidates ?? []).reduce(
    (sum, row) =>
      sum + (finiteNumber(row.votes) && row.votes > 0 ? row.votes : 0),
    0,
  );
  if (total > HOUSE_MAX_VOTES) return true;
  const counted = result.pct_reporting;
  return (
    finiteNumber(counted) &&
    counted >= 20 &&
    counted <= 100 &&
    total / (counted / 100) > HOUSE_MAX_IMPLIED_VOTES
  );
}

/**
 * Whether the reported shares cover far less than the whole vote (below
 * 90%), e.g. a winner listed alone at 51% or two of five candidates.
 */
export function isPartialCount(
  rows: { pct?: number | null }[] | null | undefined,
): boolean {
  const shares = (rows ?? []).filter(
    (row) => finiteNumber(row.pct) && row.pct > 0,
  );
  if (!shares.length) return false;
  return shares.reduce((sum, row) => sum + (row.pct as number), 0) < 90;
}

/** Whether no candidate has a vote count or share to draw. */
export function hasNoCount(
  rows: { pct?: number | null; votes?: number | null }[] | null | undefined,
): boolean {
  return (rows ?? []).every((row) => row.pct == null && row.votes == null);
}

const SOCIAL_HOSTS =
  /(^|\.)(facebook|fb|instagram|twitter|x|threads|tiktok|youtube|reddit)\.com$|(^|\.)t\.co$/i;
const AUTHORITATIVE_HOSTS =
  /(^|\.)(gov|us)$|(^|\.)(ap\.org|apnews\.com|nbcnews\.com|decisiondeskhq\.com)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Result sources in the order worth reading: official (.gov) and wire or
 * network desks first, then the rest. Social media posts are dropped, since
 * they are not one of the two independent sources a result rests on.
 */
export function rankResultSources<T extends { url: string | URL }>(
  sources: T[],
): T[] {
  const rank = (host: string) => (AUTHORITATIVE_HOSTS.test(host) ? 0 : 1);
  return sources
    .map((source, index) => ({
      source,
      index,
      host: hostOf(String(source.url)),
    }))
    .filter(({ host }) => !SOCIAL_HOSTS.test(host))
    .sort((a, b) => rank(a.host) - rank(b.host) || a.index - b.index)
    .map(({ source }) => source);
}

/** Maine counts its federal races by ranked choice when no one passes 50%. */
export function usesFederalRcv(id: string): boolean {
  return /^me-(senate|house)-/.test(id);
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

/**
 * The share of the expected vote counted, as a short label, or "" when the
 * feed has no usable figure. Never rounds a partial count up to 100%.
 */
export function formatPctReporting(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "";
  if (value >= 100) return "100%";
  if (value > 0 && value < 1) return "<1%";
  const shown = value >= 99 ? Math.floor(value) : Math.round(value);
  return `${shown}%`;
}

export function compareHref(raceId: string): string {
  return `/races/${encodeURIComponent(raceId)}/compare/`;
}

/**
 * Clean one feed row before it is drawn:
 * - placeholder zeros (every candidate at 0 votes and 0%) mean no count has
 *   come in, so they become blanks, not a called winner at 0.0%;
 * - an explicit 0% beside a positive vote count is a blank share too;
 * - a blank share is filled from that candidate's votes, scaled by a
 *   candidate who has both (votes and share come from the same count);
 * - with no such candidate, when every candidate has votes, shares are each
 *   candidate's part of the votes listed.
 */
export function normalizeResult<T extends RaceResult | PublicRaceResult>(
  result: T,
): T {
  const original = result?.candidates ?? [];
  if (!original.length) return result;
  if (original.every((row) => (row.votes ?? 0) === 0 && (row.pct ?? 0) === 0)) {
    return original.some((row) => row.votes != null || row.pct != null)
      ? {
          ...result,
          candidates: original.map((row) => ({
            ...row,
            votes: null,
            pct: null,
          })),
        }
      : result;
  }
  let rows = original.map((row) =>
    row.pct === 0 && (row.votes ?? 0) > 0 ? { ...row, pct: null } : row,
  );
  if (!rows.some((row) => row.pct == null && (row.votes ?? 0) > 0)) {
    return rows.some((row, i) => row !== original[i])
      ? { ...result, candidates: rows }
      : result;
  }
  const reference = rows
    .filter((row) => (row.votes ?? 0) > 0 && (row.pct ?? 0) > 0)
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0];
  const round = (value: number) => Math.round(value * 10) / 10;
  if (reference) {
    const perVote = (reference.pct as number) / (reference.votes as number);
    rows = rows.map((row) =>
      row.pct == null && (row.votes ?? 0) > 0
        ? { ...row, pct: round((row.votes as number) * perVote) }
        : row,
    );
  } else if (rows.every((row) => finiteNumber(row.votes) && row.pct == null)) {
    const total = rows.reduce((sum, row) => sum + (row.votes as number), 0);
    rows = rows.map((row) => ({
      ...row,
      pct: round(((row.votes as number) / total) * 100),
    }));
  }
  return { ...result, candidates: rows };
}

/** The same clean-up under its earlier name. */
export const fillMissingShares = normalizeResult;

/** The fresher of the copy built into the page and the live file. */
export function newestResult(
  built: RaceResult | PublicRaceResult | null | undefined,
  live: PublicRaceResult | null | undefined,
): RaceResult | PublicRaceResult | null {
  if (!built) return live ? normalizeResult(live) : null;
  if (!live) return normalizeResult(built);
  return normalizeResult(
    String(live.as_of ?? "") >= String(built.as_of ?? "") ? live : built,
  );
}

/** The live file's rows by id, plus when the feed itself was written. */
export async function fetchLiveResultsFile(
  fetchFn: typeof fetch = fetch,
): Promise<{
  results: Map<string, PublicRaceResult>;
  generatedAt: Date | null;
} | null> {
  try {
    const response = await fetchLiveFeed(RESULTS_FILE, fetchFn);
    if (!response.ok) return null;
    const file = (await response.json()) as PublicResultsFile;
    if (!Array.isArray(file?.races)) return null;
    const stamp = file.generated_at ? new Date(file.generated_at) : null;
    return {
      results: new Map(file.races.map((row) => [row.id, normalizeResult(row)])),
      generatedAt: stamp && Number.isFinite(stamp.getTime()) ? stamp : null,
    };
  } catch {
    return null;
  }
}

export async function fetchLiveResults(
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, PublicRaceResult> | null> {
  return (await fetchLiveResultsFile(fetchFn))?.results ?? null;
}

/**
 * Whether the live file has loaded, for the page's freshness line.
 * `updatedAt` is when this tab last fetched it; `generatedAt` is when the
 * feed was written, which is what goes stale if the pipeline stalls.
 */
export const liveResultsState = writable<{
  status: "loading" | "ready" | "error";
  updatedAt: Date | null;
  generatedAt: Date | null;
}>({ status: "loading", updatedAt: null, generatedAt: null });

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
      const next = await fetchLiveResultsFile();
      if (next) {
        set(next.results);
        liveResultsState.set({
          status: "ready",
          updatedAt: new Date(),
          generatedAt: next.generatedAt,
        });
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

// ---------------------------------------------------------------------------
// Results-page statistics: pure helpers over the directory rows joined with
// the live feed, so the stats section and its tests share one definition.

/** A directory row with its live result, as the results page builds it. */
export type ResultStatsRow = Pick<
  ResultDirectoryRace,
  | "id"
  | "title"
  | "office"
  | "state"
  | "predicted_winner_name"
  | "predicted_winner_party"
> & { result: PublicRaceResult | null };

export type SeatParty = "Democratic" | "Republican" | "Other";
export type SeatCounts = Record<SeatParty, number>;

const emptySeats = (): SeatCounts => ({
  Democratic: 0,
  Republican: 0,
  Other: 0,
});

export function sumSeats(seats: SeatCounts): number {
  return seats.Democratic + seats.Republican + seats.Other;
}

/** The seat-count bucket for a free-text party label. */
export function seatParty(party: string | null | undefined): SeatParty {
  const key = partyKey(party);
  return key === "dem" ? "Democratic" : key === "rep" ? "Republican" : "Other";
}

/**
 * The candidate ahead, the margin over second place in points, and the
 * margin in votes when both have a count. Null for a row whose vote total
 * is under review, so it never ranks as a lead.
 */
export function resultLeader(result: PublicRaceResult | null | undefined): {
  name: string;
  party: string | null;
  pct: number;
  margin: number;
  voteMargin: number | null;
} | null {
  if (implausibleCount(result)) return null;
  const rows = sortResultRows(result?.candidates ?? []).filter(
    (row) => typeof row.pct === "number" && Number.isFinite(row.pct),
  );
  const [first, second] = rows;
  if (!first?.name || (first.pct ?? 0) <= 0) return null;
  const pct = first.pct as number;
  return {
    name: first.name,
    party: first.party ?? null,
    pct,
    margin: pct - (second?.pct ?? 0),
    voteMargin:
      finiteNumber(first.votes) && finiteNumber(second?.votes)
        ? first.votes - (second.votes as number)
        : null,
  };
}

/** A candidate with a vote share, as the results cards draw them. */
export interface ResultContender {
  name: string;
  party: string | null;
  pct: number;
  imageUrl: string | null;
}

/** The top two candidates by vote share, for a two-way margin bar. */
export function resultContenders(
  result: PublicRaceResult | null | undefined,
): ResultContender[] {
  return sortResultRows(result?.candidates ?? [])
    .filter(
      (row) =>
        !!row.name && typeof row.pct === "number" && Number.isFinite(row.pct),
    )
    .slice(0, 2)
    .map((row) => ({
      name: row.name,
      party: row.party ?? null,
      pct: row.pct as number,
      imageUrl: row.image_url ?? null,
    }));
}

export type StatsChamber = "senate" | "house" | "governor";

export interface ChamberSeats {
  office: StatsChamber;
  total: number;
  threshold: number;
  /** Seats not on this ballot, by the party holding them. */
  holdovers: SeatCounts;
  called: SeatCounts;
  /** Races still counting, by the party of the candidate ahead. */
  leading: SeatCounts;
  /**
   * Races headed to a ranked-choice count or a runoff: no party lead is
   * claimed for them, whoever is ahead on first choices.
   */
  pending: number;
  /** Seats on the ballot with no call, no lead and nothing pending yet. */
  open: number;
}

const CHAMBER_KEY: Record<StatsChamber, "senate" | "house" | "governors"> = {
  senate: "senate",
  house: "house",
  governor: "governors",
};
const DEFAULT_THRESHOLD: Record<StatsChamber, number> = {
  senate: 51,
  house: 218,
  governor: 26,
};

const isCountValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * One chamber's seat picture: holdovers, called races, races leading, and the
 * rest. The live forecast file supplies the total and majority line when it
 * has them; holdovers come from the cycle tables, and when those disagree
 * with the live file's count of seats not up, the live count wins (unsplit).
 */
export function chamberSeats(
  rows: ResultStatsRow[],
  office: StatsChamber,
  live?: LiveChamberProjection | null,
): ChamberSeats {
  const total =
    live && isCountValue(live.total_seats) && live.total_seats > 0
      ? live.total_seats
      : CHAMBER_SEAT_TOTALS[CHAMBER_KEY[office]];
  const threshold =
    live && isCountValue(live.threshold) && live.threshold > 0
      ? live.threshold
      : DEFAULT_THRESHOLD[office];
  const scoped = rows.filter((row) => row.office === office);

  const holdovers = emptySeats();
  if (office === "governor") {
    for (const party of Object.values(GOVERNOR_HOLDOVERS))
      holdovers[party] += 1;
  } else if (office === "senate") {
    const active = new Set(scoped.map((row) => row.state));
    for (const [state, parties] of Object.entries(SENATE_HOLDOVERS)) {
      for (const party of active.has(state) ? parties.slice(0, 1) : parties)
        holdovers[party] += 1;
    }
  }
  if (live && isCountValue(live.total_count) && live.total_count <= total) {
    const notUp = total - live.total_count;
    if (sumSeats(holdovers) !== notUp) {
      holdovers.Democratic = 0;
      holdovers.Republican = 0;
      holdovers.Other = notUp;
    }
  }

  const called = emptySeats();
  const leading = emptySeats();
  let pending = 0;
  for (const row of scoped) {
    const group = resultGroup(row.result?.status);
    if (group === "called") {
      const party =
        row.result?.winner_party ?? resultLeader(row.result)?.party ?? null;
      called[seatParty(party)] += 1;
    } else if (group === "counting") {
      const leader = resultLeader(row.result);
      if (leader) leading[seatParty(leader.party)] += 1;
    } else if (group === "pending") {
      pending += 1;
    }
  }
  const open = Math.max(
    0,
    total -
      sumSeats(holdovers) -
      sumSeats(called) -
      sumSeats(leading) -
      pending,
  );
  return {
    office,
    total,
    threshold,
    holdovers,
    called,
    leading,
    pending,
    open,
  };
}

export interface CountingProgress {
  /** Races with any votes reported (called, counting, runoff or RCV). */
  reporting: number;
  awaiting: number;
  /** Races still counting. */
  counting: number;
  /** Mean share counted across races still counting, or null with none. */
  averagePct: number | null;
  /** Races still counting, bucketed by share counted. */
  buckets: { label: string; count: number }[];
}

const PCT_BUCKETS: { label: string; below: number }[] = [
  { label: "Under 25%", below: 25 },
  { label: "25–50%", below: 50 },
  { label: "50–75%", below: 75 },
  { label: "75–95%", below: 95 },
  { label: "95%+", below: Infinity },
];

export function countingProgress(rows: ResultStatsRow[]): CountingProgress {
  let reporting = 0;
  let awaiting = 0;
  let counting = 0;
  const shares: number[] = [];
  const buckets = PCT_BUCKETS.map(({ label }) => ({ label, count: 0 }));
  for (const row of rows) {
    const group = resultGroup(row.result?.status);
    if (group === "awaiting") {
      awaiting += 1;
      continue;
    }
    reporting += 1;
    if (group !== "counting") continue;
    counting += 1;
    const pct = row.result?.pct_reporting;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0) continue;
    const share = Math.min(pct, 100);
    shares.push(share);
    buckets[PCT_BUCKETS.findIndex((bucket) => share < bucket.below)].count += 1;
  }
  const averagePct = shares.length
    ? shares.reduce((sum, value) => sum + value, 0) / shares.length
    : null;
  return { reporting, awaiting, counting, averagePct, buckets };
}

export interface RaceMargin {
  id: string;
  title: string;
  leader: string;
  party: string | null;
  /** Lead over second place, in percentage points. */
  margin: number;
  /** Lead in votes, when both have a count (breaks a rounded tie). */
  voteMargin: number | null;
  pctReporting: number | null;
  /** The top two by vote share, for the card's margin bar and headshot. */
  contenders: ResultContender[];
}

/**
 * Races still counting with a measurable lead. A count that has not moved in
 * 12 hours (as of `now`) or whose total is under review is left out, so a
 * stalled or broken row never ranks as a live lead.
 */
function countingMargins(
  rows: ResultStatsRow[],
  now: Date | number = Date.now(),
): RaceMargin[] {
  const out: RaceMargin[] = [];
  for (const row of rows) {
    if (resultGroup(row.result?.status) !== "counting") continue;
    if (isRowStale(row.result, now)) continue;
    const shares = (row.result?.candidates ?? []).filter(
      (c) => typeof c.pct === "number" && Number.isFinite(c.pct),
    );
    if (shares.length < 2) continue;
    const leader = resultLeader(row.result);
    if (!leader) continue;
    out.push({
      id: row.id,
      title: row.title,
      leader: leader.name,
      party: leader.party,
      margin: leader.margin,
      voteMargin: leader.voteMargin,
      pctReporting: row.result?.pct_reporting ?? null,
      contenders: resultContenders(row.result),
    });
  }
  return out;
}

/** Contested races still counting with the narrowest leads. */
export function closestRaces(
  rows: ResultStatsRow[],
  limit = 5,
  now: Date | number = Date.now(),
): RaceMargin[] {
  return countingMargins(rows, now)
    .sort(
      (a, b) =>
        a.margin - b.margin ||
        (a.voteMargin ?? Infinity) - (b.voteMargin ?? Infinity) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** Contested races still counting with the widest leads. */
export function biggestLeads(
  rows: ResultStatsRow[],
  limit = 5,
  now: Date | number = Date.now(),
): RaceMargin[] {
  return countingMargins(rows, now)
    .sort((a, b) => b.margin - a.margin || a.id.localeCompare(b.id))
    .slice(0, limit);
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

function surname(name: string): string {
  const words = name
    .toLocaleLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !NAME_SUFFIXES.has(word));
  return words[words.length - 1] ?? "";
}

export interface UpsetWatch {
  id: string;
  title: string;
  leader: string;
  leaderParty: string | null;
  predicted: string;
  predictedParty: string | null;
  called: boolean;
  /** Headshots from the count, when the feed carries them. */
  leaderImage?: string | null;
  predictedImage?: string | null;
  /** The leader's lead in points, and the share counted. */
  margin?: number;
  pctReporting?: number | null;
}

/**
 * Races where the called winner, or the candidate ahead, is not the one the
 * pre-election forecast picked. Parties decide when both are known and
 * differ; otherwise surnames do, so "Mike" against "Michael" is no upset but
 * a same-party top-two race still can be. Called races first, then the
 * narrowest leads.
 */
export function upsetWatch(rows: ResultStatsRow[], limit = 5): UpsetWatch[] {
  const out: (UpsetWatch & { margin: number })[] = [];
  const imageOf = (
    row: ResultStatsRow,
    name: string | null | undefined,
  ): string | null => {
    const want = name ? surname(name) : "";
    if (!want) return null;
    return (
      row.result?.candidates.find((c) => surname(c.name) === want)?.image_url ??
      null
    );
  };
  for (const row of rows) {
    const predictedName = forecastPick(row.predicted_winner_name) ?? "";
    const predictedParty = forecastPick(row.predicted_winner_party);
    if (!predictedName && !predictedParty) continue;
    const group = resultGroup(row.result?.status);
    if (group !== "called" && group !== "counting") continue;
    const called = group === "called";
    const leader = resultLeader(row.result);
    const name = (called ? row.result?.winner_name : null) ?? leader?.name;
    const party =
      (called ? row.result?.winner_party : null) ?? leader?.party ?? null;
    if (!name) continue;
    const differs =
      party && predictedParty && partyKey(party) !== partyKey(predictedParty)
        ? true
        : !!predictedName && surname(name) !== surname(predictedName);
    if (!differs) continue;
    out.push({
      id: row.id,
      title: row.title,
      leader: name,
      leaderParty: party,
      predicted: predictedName || predictedParty || "",
      predictedParty,
      called,
      margin: leader?.margin ?? 0,
      pctReporting: row.result?.pct_reporting ?? null,
      leaderImage: imageOf(row, name),
      predictedImage: imageOf(row, predictedName),
    });
  }
  return out
    .sort(
      (a, b) =>
        Number(b.called) - Number(a.called) ||
        a.margin - b.margin ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** "2026 Alabama's 2nd Congressional District Election" becomes "Alabama's 2nd Congressional District". */
export function shortRaceTitle(title: string): string {
  return (
    title
      .replace(/^\s*20\d\d\s+/, "")
      .replace(/\s+(general\s+)?election\s*$/i, "")
      .trim() || title
  );
}
