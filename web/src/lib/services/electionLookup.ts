import type { RaceSummary } from "$lib/types";
import { daysUntilElection } from "$lib/utils/electionDate";
import { canonicalRaceState, canonicalStateName } from "$lib/utils/states";

export interface ElectionGeography {
  state: string;
  congressionalDistrict: string;
}

interface CensusAddressMatch {
  geographies?: Record<string, Array<Record<string, unknown>>>;
}

interface CensusResponse {
  result?: { addressMatches?: CensusAddressMatch[] };
}

const CENSUS_ENDPOINT =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

export function parseCensusGeography(
  response: CensusResponse,
): ElectionGeography | null {
  const match = response.result?.addressMatches?.[0];
  if (!match?.geographies) return null;

  const state = match.geographies.States?.[0]?.NAME;
  const congressionalEntry = Object.entries(match.geographies).find(([name]) =>
    name.endsWith("Congressional Districts"),
  )?.[1]?.[0];
  const district = congressionalEntry?.CD119 ?? congressionalEntry?.BASENAME;

  if (typeof state !== "string" || district == null) return null;
  const normalizedDistrict = String(district).padStart(2, "0");
  return {
    state,
    // Census uses 98 for non-voting delegate districts such as Washington,
    // D.C. Treat it like the other at-large districts throughout the UI and
    // race matcher rather than exposing the internal Census code to voters.
    congressionalDistrict:
      normalizedDistrict === "98" ? "00" : normalizedDistrict,
  };
}

export function lookupElectionGeography(
  address: string,
  timeoutMs = 12000,
): Promise<ElectionGeography> {
  return new Promise((resolve, reject) => {
    const callbackName = `smarterVoteCensus_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("The address service took too long to respond."));
    }, timeoutMs);

    (window as unknown as Record<string, unknown>)[callbackName] = (
      response: CensusResponse,
    ) => {
      const geography = parseCensusGeography(response);
      cleanup();
      if (geography) resolve(geography);
      else reject(new Error("We could not match that address."));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("The address service is unavailable right now."));
    };

    const params = new URLSearchParams({
      address,
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      format: "jsonp",
      callback: callbackName,
    });
    script.src = `${CENSUS_ENDPOINT}?${params.toString()}`;
    document.head.appendChild(script);
  });
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
