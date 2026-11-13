/**
 * Results-page helpers: sorting, shareable filter state in the URL, feed
 * freshness, the latest-calls feed and the key-races strip. Pure functions
 * over the page's rows, so the page and its tests share one definition.
 */
import type { PublicRaceResult, RaceResultStatus } from "$lib/types";
import { partyKey } from "$lib/utils/party";
import { canonicalStateName } from "$lib/utils/states";
import {
  namesWinner,
  resultContenders,
  resultGroup,
  resultLeader,
  shortRaceTitle,
  trustedCallTime,
  type ResultContender,
  type ResultGroup,
  type ResultOffice,
} from "$lib/utils/results";

/** The fields of a results-page row these helpers read. */
export interface ResultsPageRow {
  id: string;
  title: string;
  state: string;
  office: ResultOffice;
  competitive: boolean;
  holder_party?: string | null;
  result: PublicRaceResult | null;
}

// ---------------------------------------------------------------------------
// Sorting

export type ResultSort = "default" | "margin" | "counted" | "updated";

export const RESULT_SORTS: { id: ResultSort; label: string }[] = [
  { id: "default", label: "Reporting first" },
  { id: "margin", label: "Closest margin" },
  { id: "counted", label: "Most counted" },
  { id: "updated", label: "Recently updated" },
];

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The leader's lead over second place, or null when it cannot be measured. */
export function rowMargin(row: Pick<ResultsPageRow, "result">): number | null {
  if (resultGroup(row.result?.status) === "awaiting") return null;
  const shares = (row.result?.candidates ?? []).filter((c) => finite(c.pct));
  if (shares.length < 2) return null;
  return resultLeader(row.result)?.margin ?? null;
}

/**
 * The rows in the chosen order. Rows with no value for the sort key keep
 * their incoming order after the rest, so awaiting races always trail.
 * "default" returns the rows unchanged; the page groups them itself.
 */
export function sortResultsRows<T extends ResultsPageRow>(
  rows: T[],
  sort: ResultSort,
): T[] {
  if (sort === "default") return rows;
  const key = (row: T): number | null => {
    if (sort === "margin") return rowMargin(row);
    if (sort === "counted") {
      const pct = row.result?.pct_reporting;
      return resultGroup(row.result?.status) !== "awaiting" && finite(pct)
        ? -pct
        : null;
    }
    const time = row.result?.as_of ? Date.parse(row.result.as_of) : NaN;
    return Number.isFinite(time) ? -time : null;
  };
  return rows
    .map((row, index) => ({ row, index, value: key(row) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      return a.value - b.value || a.index - b.index;
    })
    .map(({ row }) => row);
}

/**
 * The first `limit` rows of one list section, and how many wait behind its
 * "Show more" button. Filtering runs on all rows first; only drawing is
 * capped, so a phone never lays out hundreds of cards at once.
 */
export function capSection<T>(
  rows: T[],
  limit: number,
): { rows: T[]; hidden: number } {
  if (!Number.isFinite(limit) || rows.length <= limit)
    return { rows, hidden: 0 };
  return { rows: rows.slice(0, limit), hidden: rows.length - limit };
}

/**
 * How many more cards a "Show more" click adds: everything when the rest is
 * at most a step and a bit, so "Show all 99" never leaves three behind.
 */
export function nextStep(hidden: number, step: number): number {
  return hidden <= step * 1.25 ? hidden : step;
}

/** "Show all 99" or "Show 48 more of 300". */
export function showMoreLabel(hidden: number, step: number): string {
  const next = nextStep(hidden, step);
  return next >= hidden
    ? `Show all ${hidden}`
    : `Show ${next} more of ${hidden}`;
}

/**
 * Every row with a count, plus the first `limit` awaiting rows, in order.
 * Filtering runs on all rows first; only rendering is capped.
 */
export function limitAwaiting<T extends Pick<ResultsPageRow, "result">>(
  rows: T[],
  limit: number,
): { rows: T[]; hidden: number } {
  let seen = 0;
  const out: T[] = [];
  for (const row of rows) {
    if (resultGroup(row.result?.status) === "awaiting") {
      seen += 1;
      if (seen > limit) continue;
    }
    out.push(row);
  }
  return { rows: out, hidden: Math.max(0, seen - limit) };
}

// ---------------------------------------------------------------------------
// Shareable filter state

export type StatusFilter = "all" | ResultGroup;
export type OfficeFilter = "all" | Exclude<ResultOffice, "other">;

export interface ResultsQuery {
  status: StatusFilter;
  office: OfficeFilter;
  state: string;
  competitive: boolean;
  q: string;
  sort: ResultSort;
}

export const DEFAULT_RESULTS_QUERY: ResultsQuery = {
  status: "all",
  office: "all",
  state: "all",
  competitive: false,
  q: "",
  sort: "default",
};

const STATUSES = new Set<string>(["called", "counting", "pending", "awaiting"]);
const OFFICES = new Set<string>(["governor", "senate", "house"]);
const SORTS = new Set<string>(RESULT_SORTS.map((sort) => sort.id));

/**
 * Filter state from a query string. Unknown values fall back to defaults;
 * a state name is matched case-insensitively against `states` when given,
 * so `?state=ohio` selects "Ohio".
 */
export function parseResultsQuery(
  params: URLSearchParams,
  states: string[] = [],
): ResultsQuery {
  const status = params.get("status") ?? "";
  const office = params.get("office") ?? "";
  const sort = params.get("sort") ?? "";
  const given = params.get("state")?.trim() ?? "";
  // Shared links may use a postal code or any case: `?state=OH`, `ohio`.
  const rawState = canonicalStateName(given) ?? given;
  const state =
    rawState === ""
      ? "all"
      : states.length
        ? (states.find(
            (name) => name.toLocaleLowerCase() === rawState.toLocaleLowerCase(),
          ) ?? "all")
        : rawState;
  const competitive = params.get("competitive") ?? "";
  return {
    status: STATUSES.has(status) ? (status as StatusFilter) : "all",
    office: OFFICES.has(office) ? (office as OfficeFilter) : "all",
    state,
    competitive: competitive === "1" || competitive === "true",
    q: (params.get("q") ?? "").slice(0, 100),
    sort: SORTS.has(sort) ? (sort as ResultSort) : "default",
  };
}

/** The query string for a filter state, "" when everything is default. */
export function resultsQueryString(query: ResultsQuery): string {
  const params = new URLSearchParams();
  if (query.state !== "all") params.set("state", query.state);
  if (query.office !== "all") params.set("office", query.office);
  if (query.status !== "all") params.set("status", query.status);
  if (query.competitive) params.set("competitive", "1");
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.sort !== "default") params.set("sort", query.sort);
  const text = params.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// Freshness

/**
 * The feed is rebuilt about every two hours, so it only counts as behind once
 * it is older than one cycle plus a margin; a 10-minute line was always on.
 */
export const STALE_AFTER_MS = 150 * 60_000;
/** A timestamp this far ahead of the clock is a data error, not "just now". */
const FUTURE_SLACK_MS = 5 * 60_000;

const toTime = (value: Date | string | null | undefined): number => {
  if (!value) return NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
};

/**
 * "just now", "4 min ago", "2 hr ago", or "" for a missing timestamp or one
 * more than a few minutes in the future (never "just now" for a bad time).
 */
export function formatAgo(
  value: Date | string | null | undefined,
  now: Date | number = Date.now(),
): string {
  const time = toTime(value);
  if (!Number.isFinite(time)) return "";
  const age = (typeof now === "number" ? now : now.getTime()) - time;
  if (age < -FUTURE_SLACK_MS) return "";
  const minutes = Math.floor(Math.max(0, age) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Whether a feed timestamp is older than the stale threshold. */
export function isStale(
  value: Date | string | null | undefined,
  now: Date | number = Date.now(),
  thresholdMs = STALE_AFTER_MS,
): boolean {
  const time = toTime(value);
  if (!Number.isFinite(time)) return false;
  return (typeof now === "number" ? now : now.getTime()) - time > thresholdMs;
}

// ---------------------------------------------------------------------------
// Latest calls

export interface LatestCall {
  id: string;
  title: string;
  winner: string;
  party: string | null;
  calledBy: string | null;
  /** Null when the feed's call time is missing, in the future or before polls closed. */
  calledAt: string | null;
  /** The winner's party differs from the seat's current holder. */
  flip: boolean;
  /** The winner's headshot, from the count, when the feed carries one. */
  winnerImage?: string | null;
  /** Lead in points over second place, and the share counted. */
  margin?: number | null;
  voteMargin?: number | null;
  pctReporting?: number | null;
  contenders?: ResultContender[];
}

/**
 * Whether a winner takes the seat from the other party. Only true when both
 * parties name a party (not "other") and they differ, so an unknown holder,
 * an open seat or an unlabeled winner never shows a flip.
 */
export function isFlip(
  winnerParty: string | null | undefined,
  holderParty: string | null | undefined,
): boolean {
  if (!winnerParty || !holderParty) return false;
  const winner = partyKey(winnerParty);
  const holder = partyKey(holderParty);
  return winner !== "other" && holder !== "other" && winner !== holder;
}

/** The named winner's row in the count, if it is there. */
function winnerRow(result: PublicRaceResult) {
  const name = result.winner_name?.trim().toLocaleLowerCase();
  return name
    ? result.candidates.find((c) => c.name.trim().toLocaleLowerCase() === name)
    : undefined;
}

/** The winner's party: the feed's, else the named winner's candidate row. */
function winnerParty(result: PublicRaceResult): string | null {
  if (result.winner_party) return result.winner_party;
  return winnerRow(result)?.party ?? null;
}

/**
 * The newest calls, newest first. Only a trusted `called_at` (after polls
 * closed and not past `reference`, the feed's generated time) is shown and
 * sorts the list; a call with a bad time sorts by its count's `as_of`
 * instead and shows no time, so a typo never pins it on top as "just now".
 */
export function latestCalls(
  rows: ResultsPageRow[],
  limit = 8,
  reference: Date | number = Date.now(),
): LatestCall[] {
  const out: (LatestCall & { time: number })[] = [];
  for (const row of rows) {
    const result = row.result;
    if (!result || !namesWinner(result.status) || !result.winner_name) continue;
    const calledTime = trustedCallTime(result.called_at, reference);
    const time = calledTime ?? trustedCallTime(result.as_of, reference);
    if (time === null) continue;
    const party = winnerParty(result);
    const leader = resultLeader(result);
    out.push({
      id: row.id,
      title: shortRaceTitle(row.title),
      winner: result.winner_name,
      party,
      calledBy: result.called_by ?? null,
      calledAt: calledTime === null ? null : (result.called_at as string),
      flip: isFlip(party, row.holder_party),
      winnerImage: winnerRow(result)?.image_url ?? null,
      margin: rowMargin(row),
      voteMargin: leader?.voteMargin ?? null,
      pctReporting: finite(result.pct_reporting) ? result.pct_reporting : null,
      contenders: resultContenders(result),
      time,
    });
  }
  return out
    .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ time: _time, ...call }) => call);
}

// ---------------------------------------------------------------------------
// Key races

export interface KeyRace {
  id: string;
  title: string;
  office: "governor" | "senate";
  group: ResultGroup;
  status?: RaceResultStatus | null;
  leader: string | null;
  party: string | null;
  margin: number | null;
  voteMargin?: number | null;
  pctReporting: number | null;
  /** The top two by vote share, for the card's margin bar and headshots. */
  contenders?: ResultContender[];
}

const GROUP_RANK: Record<ResultGroup, number> = {
  counting: 0,
  pending: 1,
  called: 2,
  awaiting: 3,
};

/** A race still counting this close is key whatever it was rated before. */
export const KEY_RACE_CLOSE_POINTS = 3;

/** Whether a race became close on the night: too close to call, or a lead under 3 pts. */
function closeOnTheNight(row: ResultsPageRow): boolean {
  if (row.result?.status === "too_close") return true;
  if (resultGroup(row.result?.status) !== "counting") return false;
  const margin = rowMargin(row);
  return margin !== null && margin < KEY_RACE_CLOSE_POINTS;
}

/**
 * Senate and governor races rated competitive, on the priority list, or
 * close on the night (a Likely R seat that is tied belongs here): still
 * counting first, closest margin first, then called, then awaiting.
 */
export function keyRaces(
  rows: ResultsPageRow[],
  isPriority: (id: string) => boolean = () => false,
  limit = 12,
): KeyRace[] {
  return rows
    .filter(
      (row) =>
        (row.office === "senate" || row.office === "governor") &&
        (row.competitive || isPriority(row.id) || closeOnTheNight(row)),
    )
    .map((row): KeyRace => {
      const group = resultGroup(row.result?.status);
      const leader = group === "awaiting" ? null : resultLeader(row.result);
      const called = group === "called" && row.result?.winner_name;
      return {
        id: row.id,
        title: shortRaceTitle(row.title),
        office: row.office as "governor" | "senate",
        group,
        status: row.result?.status ?? null,
        leader: called
          ? (row.result?.winner_name ?? null)
          : (leader?.name ?? null),
        party: called
          ? row.result
            ? winnerParty(row.result)
            : null
          : (leader?.party ?? null),
        margin: rowMargin(row),
        voteMargin: leader?.voteMargin ?? null,
        pctReporting:
          group !== "awaiting" && finite(row.result?.pct_reporting)
            ? (row.result?.pct_reporting as number)
            : null,
        contenders: group === "awaiting" ? [] : resultContenders(row.result),
      };
    })
    .sort(
      (a, b) =>
        GROUP_RANK[a.group] - GROUP_RANK[b.group] ||
        (a.margin ?? Infinity) - (b.margin ?? Infinity) ||
        (a.voteMargin ?? Infinity) - (b.voteMargin ?? Infinity) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}
