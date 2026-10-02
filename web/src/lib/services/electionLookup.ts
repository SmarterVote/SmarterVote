import type { RaceSummary } from "$lib/types";
import { daysUntilElection } from "$lib/utils/electionDate";
import { canonicalRaceState, canonicalStateName } from "$lib/utils/states";
import { racesApiBase } from "$lib/config/api";

export interface ElectionGeography {
  state: string;
  congressionalDistrict: string;
}

/** Response of the races-api Census proxy (`POST /geocode/census`). */
interface CensusProxyResponse {
  state?: unknown;
  /** Raw Census fields: CD### (named for the Congress), GEOID, BASENAME, NAME. */
  congressional_district?: Record<string, unknown> | null;
}

/** The proxy's 200 body reduced to a geography, or null when unusable. */
export function parseCensusProxyResponse(
  body: CensusProxyResponse | null | undefined,
): ElectionGeography | null {
  const state = body?.state;
  const entry = body?.congressional_district;
  const district =
    entry && typeof entry === "object" ? censusDistrictCode(entry) : null;
  if (typeof state !== "string" || !state.trim() || district == null)
    return null;
  return { state: state.trim(), congressionalDistrict: district };
}

/**
 * The two-digit district code from a Census congressional-district entry.
 *
 * The field is named for the Congress (CD119, then CD120 after redistricting
 * vintages roll over), so read whichever CD### key is present — newest first —
 * then fall back to the GEOID's last two digits. BASENAME is never used as a
 * code: for at-large states it is the text "Congressional District (at Large)".
 */
export function censusDistrictCode(
  entry: Record<string, unknown>,
): string | null {
  const cdKeys = Object.keys(entry)
    .filter((key) => /^CD\d+$/.test(key) && entry[key] != null)
    .sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)));
  const raw =
    cdKeys.length > 0
      ? String(entry[cdKeys[0]])
      : typeof entry.GEOID === "string" && /^\d{4}$/.test(entry.GEOID)
        ? entry.GEOID.slice(2)
        : /at[- ]large/i.test(String(entry.BASENAME ?? ""))
          ? "00"
          : null;
  return raw == null ? null : normalizeDistrictCode(raw);
}

/**
 * Normalise a district from Census or a shared URL to two digits. Census uses
 * 98 for non-voting delegate districts (Washington, D.C.) and 00 / "at large"
 * for single-district states; all of those are the at-large seat here.
 */
export function normalizeDistrictCode(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (/^(al|at[- ]?large)$/.test(text) || /at[- ]large/.test(text)) return "00";
  if (!/^\d{1,2}$/.test(text)) return null;
  const code = text.padStart(2, "0");
  return code === "98" ? "00" : code;
}

const NO_MATCH = "We could not match that address.";
const UNAVAILABLE = "The address service is unavailable right now.";

/**
 * Resolve an address to its state and congressional district through the
 * races-api Census proxy. The address goes to that endpoint only (it is not
 * logged or stored there) and never into the page URL or storage.
 */
export async function lookupElectionGeography(
  address: string,
  timeoutMs = 12000,
  fetchFn: typeof fetch = fetch,
): Promise<ElectionGeography> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(`${racesApiBase()}/geocode/census`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    });
  } catch {
    throw new Error(
      controller.signal.aborted
        ? "The address service took too long to respond."
        : UNAVAILABLE,
    );
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404 || response.status === 422)
    throw new Error(NO_MATCH);
  if (!response.ok) throw new Error(UNAVAILABLE);
  let body: CensusProxyResponse;
  try {
    body = (await response.json()) as CensusProxyResponse;
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const geography = parseCensusProxyResponse(body);
  if (!geography) throw new Error(NO_MATCH);
  return geography;
}

function labelMatchesState(label: string, normalizedState: string): boolean {
  const value = label.trim().toLocaleLowerCase();
  return (
    value === normalizedState ||
    value.startsWith(`${normalizedState}'s `) ||
    value.startsWith(`${normalizedState}’s `) ||
    value.startsWith(`${normalizedState} `) ||
    value.startsWith(`${normalizedState},`)
  );
}

function raceMatchesState(race: RaceSummary, state: string): boolean {
  const normalizedState = state.trim().toLocaleLowerCase();
  // canonicalRaceState understands abbreviations ("TX"), full names in any
  // case, and falls back to the race id's state prefix ("tx-senate-2026").
  const canonical = canonicalRaceState(race);
  if (canonical && canonical.toLocaleLowerCase() === normalizedState) {
    return true;
  }
  // Older summaries put district labels in `state`/`jurisdiction`
  // ("Texas's 8th Congressional District"); match on their state prefix.
  return [race.state, race.jurisdiction].some(
    (label) =>
      typeof label === "string" && labelMatchesState(label, normalizedState),
  );
}

// House race ids come in three shapes; the district must be followed by the
// cycle year (or the end), so the year in an at-large id like "ak-house-2026"
// is never read as district 2026.
const ID_DISTRICT_PATTERNS = [
  /^[a-z]{2}-house-(\d{1,2}|al)(?=-\d{4}\b|$)/i, // ca-house-12-2026
  /^[a-z]{2}-(\d{1,2}|al)-house(?=-\d{4}\b|$)/i, // az-01-house-2026
];
// No district number at all ("ak-house-2026"): the state's single at-large seat.
const ID_AT_LARGE = /^[a-z]{2}-house(?:-\d{4})?$/i;
const TEXT_DISTRICT_PATTERNS = [
  /(\d+)(?:st|nd|rd|th)?\s+congressional\s+district/i,
  /\bcongressional\s+district\s+(?:no\.?\s*)?(\d+)\b/i,
  /\bdistrict\s+(?:no\.?\s*)?(\d+)\b/i,
  /\bCD[- ]?(\d+)\b/i,
  /\b[A-Z]{2}-(\d{1,2})\b/,
];

export function districtFromRace(race: RaceSummary): string | null {
  for (const pattern of ID_DISTRICT_PATTERNS) {
    const idMatch = race.id?.match(pattern);
    if (idMatch) {
      const value = idMatch[1].toLocaleLowerCase();
      return value === "al" ? "00" : String(Number(value)).padStart(2, "0");
    }
  }
  if (race.id && ID_AT_LARGE.test(race.id)) return "00";

  const text = `${race.jurisdiction ?? ""} ${race.title ?? ""}`;
  if (/\bat[- ]large\b/i.test(text)) return "00";
  for (const pattern of TEXT_DISTRICT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return String(Number(match[1])).padStart(2, "0");
  }
  return null;
}

export function matchingNationalRaces(
  races: RaceSummary[],
  geography: ElectionGeography,
  now = new Date(),
): RaceSummary[] {
  // A postal code ("AK") from a shared link must match like the full name.
  const state = canonicalStateName(geography.state) ?? geography.state;
  const district = geography.congressionalDistrict.padStart(2, "0");
  return races.filter((race) => {
    // Compare calendar dates, not instants: "2026-11-03" parsed as UTC
    // midnight would drop the race on the evening before Election Day in US
    // time zones. A race stays listed through its election day locally.
    const daysLeft = daysUntilElection(race.election_date, now);
    if (daysLeft !== null && daysLeft < 0) return false;
    const office = race.office?.toLocaleLowerCase() ?? "";
    const sameState = raceMatchesState(race, state);
    if (office.includes("president")) return true;
    if (office.includes("senate")) return sameState;
    if (office.includes("governor") || office.includes("gubernatorial"))
      return sameState;
    if (office.includes("house") || office.includes("representative")) {
      return sameState && districtFromRace(race) === district;
    }
    return false;
  });
}
