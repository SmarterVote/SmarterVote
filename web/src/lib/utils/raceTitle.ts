import {
  getIssueDisplayName,
  type Candidate,
  type Race,
  type RaceSummary,
} from "$lib/types";
import {
  hasPublicPosition,
  neutralCandidateOrder,
} from "$lib/utils/candidates";
import { formatElectionDate } from "$lib/utils/electionDate";
import { partyAbbr, partyKey } from "$lib/utils/party";
import { canonicalRaceState, STATE_NAMES_BY_CODE } from "$lib/utils/states";

type TitleRace = Pick<Race | RaceSummary, "id"> &
  Partial<
    Pick<
      Race | RaceSummary,
      "title" | "office" | "state" | "jurisdiction" | "election_date"
    >
  > & {
    district?: string | null;
    candidates?: {
      name: string;
      party?: string;
      withdrawn?: boolean;
      incumbent?: boolean;
    }[];
  };

type MetadataCandidate = Pick<Candidate, "name"> &
  Partial<
    Pick<
      Candidate,
      | "party"
      | "incumbent"
      | "withdrawn"
      | "issues"
      | "summary"
      | "summary_sources"
      | "career_history"
      | "education"
      | "donor_summary"
      | "voting_summary"
    >
  >;

function naturalList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function cycleYear(race: TitleRace, parts: string[]): string | null {
  return (
    parts.find((part) => /^\d{4}$/.test(part)) ??
    race.election_date?.slice(0, 4) ??
    null
  );
}

function stateName(race: TitleRace): string | null {
  return canonicalRaceState(race);
}

function ordinal(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  return `${number}${["th", "st", "nd", "rd"][number % 10] ?? "th"}`;
}

/** District number as written ("12"), or "AL" for an at-large seat. */
function houseDistrictNumber(
  race: TitleRace,
  parts: string[],
  year: string,
): string | null {
  if (!parts.includes("house")) return null;
  const districtLabel = `${race.district ?? ""} ${race.jurisdiction ?? ""}`;
  if (/\bat[- ]large\b/i.test(districtLabel)) return "AL";
  const labeledDistrict = districtLabel.match(
    /\b(\d+)(?:st|nd|rd|th)?\s+(?:Congressional\s+)?District\b/i,
  );
  if (labeledDistrict) return String(Number(labeledDistrict[1]));
  if (parts.includes("at") && parts.includes("large")) return "AL";
  const numericDistrict = parts.find(
    (part) => /^\d{1,3}$/.test(part) && part !== year,
  );
  return numericDistrict ? String(Number(numericDistrict)) : "AL";
}

function houseDistrict(
  race: TitleRace,
  parts: string[],
  year: string,
): string | null {
  const number = houseDistrictNumber(race, parts, year);
  if (!number) return null;
  return number === "AL" ? "At-Large" : ordinal(number);
}

/** A concise, deterministic election name for every public-facing race surface. */
export function raceDisplayTitle(race: TitleRace): string {
  const parts = race.id.toLowerCase().split("-");
  const year = cycleYear(race, parts);
  const state = stateName(race);
  const office = race.office?.toLowerCase() ?? "";
  const special = parts.includes("special") ? " Special" : "";

  if (year && state && office.includes("senate")) {
    return `${year} ${state} U.S. Senate${special} Election`;
  }
  if (
    year &&
    state &&
    (office.includes("house") || office.includes("representative"))
  ) {
    const district = houseDistrict(race, parts, year);
    if (district)
      return `${year} ${state}'s ${district} Congressional District${special} Election`;
  }
  if (
    year &&
    state &&
    (office.includes("governor") || office.includes("gubernatorial"))
  ) {
    if (office.includes("lieutenant governor")) {
      return `${year} ${state} Governor and Lieutenant Governor${special} Election`;
    }
    return `${year} ${state} Governor${special} Election`;
  }

  return race.title ?? race.office ?? "Election";
}

// ---------------------------------------------------------------------------
// Search titles and descriptions
// ---------------------------------------------------------------------------

/** Search results truncate titles past ~60 characters and snippets past ~155. */
export const TITLE_LIMIT = 60;
export const DESCRIPTION_LIMIT = 155;
const SITE_SUFFIX = " | Smarter.Vote";

const STATE_CODES_BY_NAME = new Map(
  Object.entries(STATE_NAMES_BY_CODE).map(([code, name]) => [
    name,
    code.toUpperCase(),
  ]),
);

type RaceKind = "senate" | "house" | "governor" | "other";

interface RaceLabels {
  kind: RaceKind;
  year: string | null;
  state: string | null;
  special: boolean;
  /** Compact office label: "Texas Senate", "TX-12 House", "Texas Governor". */
  short: string;
  /** Spelled-out place for House seats ("Texas 12th District"), else null. */
  place: string | null;
}

function raceLabels(race: TitleRace): RaceLabels {
  const parts = race.id.toLowerCase().split("-");
  const year = cycleYear(race, parts);
  const state = stateName(race);
  const office = race.office?.toLowerCase() ?? "";
  const special = parts.includes("special");
  const base = { year, state, special, place: null };
  if (state && office.includes("senate"))
    return { ...base, kind: "senate", short: `${state} Senate` };
  if (
    state &&
    year &&
    (office.includes("house") || office.includes("representative"))
  ) {
    const number = houseDistrictNumber(race, parts, year);
    const code = STATE_CODES_BY_NAME.get(state);
    if (number && code) {
      return {
        ...base,
        kind: "house",
        short: `${code}-${number === "AL" ? "AL" : number.padStart(2, "0")} House`,
        place:
          number === "AL"
            ? `${state} at-large seat`
            : `${state} ${ordinal(number)} District`,
      };
    }
  }
  if (
    state &&
    (office.includes("governor") || office.includes("gubernatorial"))
  )
    return { ...base, kind: "governor", short: `${state} Governor` };
  return { ...base, kind: "other", short: raceDisplayTitle(race) };
}

/** Cut text to `limit` characters at a word boundary, with an ellipsis. */
function capAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** The first option that fits `limit`, else the last one capped at a word boundary. */
function firstThatFits(options: string[], limit: number): string {
  const usable = options.filter(Boolean);
  return (
    usable.find((option) => option.length <= limit) ??
    capAtWord(usable.at(-1) ?? "", limit)
  );
}

/** "Texas Senate race 2026", "TX-12 House race 2026", "Ohio Senate special election 2026". */
function raceHeadline(labels: RaceLabels): string {
  if (labels.kind === "other") return labels.short;
  const noun = labels.special ? "special election" : "race";
  return [labels.short, noun, labels.year].filter(Boolean).join(" ");
}

/** A page title within TITLE_LIMIT: the site suffix is dropped first when it does not fit. */
function withSiteSuffix(...options: string[]): string {
  return firstThatFits(
    [...options.map((option) => `${option}${SITE_SUFFIX}`), ...options],
    TITLE_LIMIT,
  );
}

/** "<title>" for a race page, e.g. "TX-12 House race 2026 | Smarter.Vote" (≤ 60 characters). */
export function racePageTitle(race: TitleRace | null | undefined): string {
  if (!race) return "Loading... | Smarter.Vote";
  return withSiteSuffix(raceHeadline(raceLabels(race)));
}

/** "<title>" for a compare page: "Compare TX-12 House candidates 2026 | Smarter.Vote". */
export function comparePageTitle(race: TitleRace | null | undefined): string {
  if (!race) return "Compare candidates | Smarter.Vote";
  const labels = raceLabels(race);
  if (labels.kind === "other")
    return withSiteSuffix(`Compare candidates: ${labels.short}`);
  return withSiteSuffix(
    `Compare ${labels.short} candidates ${labels.year ?? ""}`.trim(),
    `Compare ${labels.short} candidates`,
  );
}

/** Party in a sentence: "Democratic", "Republican", "independent", or the label as written. */
function partyPhrase(party: string | undefined): string {
  const key = partyKey(party);
  if (key === "dem") return "Democratic";
  if (key === "rep") return "Republican";
  if (key === "ind") return "independent";
  if (key === "grn") return "Green";
  if (key === "lib") return "Libertarian";
  return (party ?? "").trim().replace(/\s+party$/i, "");
}

function nameWithParty(candidate: { name: string; party?: string }): string {
  return candidate.party
    ? `${candidate.name} (${partyAbbr(candidate.party)})`
    : candidate.name;
}

/** "the 2026 Texas Senate race", "the 2026 House race in TX-12 (Texas 12th District)". */
function raceInSentence(labels: RaceLabels, withPlace = true): string {
  const year = labels.year ? `${labels.year} ` : "";
  if (labels.kind === "house") {
    const place = withPlace && labels.place ? ` (${labels.place})` : "";
    return `the ${year}House race in ${labels.short.replace(/ House$/, "")}${place}`;
  }
  if (labels.kind === "other") return `the ${labels.short}`;
  const noun = labels.special ? "special election" : "race";
  const office =
    labels.kind === "governor" ? `${labels.state} governor` : labels.short;
  return `the ${year}${office} ${noun}`;
}

/** Search description for a race page (≤ 155 characters), naming the field. */
export function raceMetaDescription(
  race: TitleRace | null | undefined,
): string {
  if (!race)
    return "Compare candidates' sourced positions, polls and forecasts.";
  const labels = raceLabels(race);
  const active = neutralCandidateOrder(
    race.candidates?.filter((candidate) => !candidate.withdrawn),
  ).filter((candidate) => candidate.name);
  const date = race.election_date
    ? ` Election Day: ${formatElectionDate(race.election_date, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}.`
    : "";
  const where = raceInSentence(labels);
  const whereShort = raceInSentence(labels, false);

  if (active.length === 1) {
    const only = nameWithParty(active[0]);
    return firstThatFits(
      [
        `${only} is the only candidate in ${where}. Sourced profile, positions and voter resources.${date}`,
        `${only} is the only candidate in ${whereShort}. Sourced profile and positions.${date}`,
        `${only} is the only candidate in ${whereShort}.`,
      ],
      DESCRIPTION_LIMIT,
    );
  }
  if (active.length === 0) {
    return firstThatFits(
      [
        `Candidates, sourced positions and voter resources for ${where}.${date}`,
        `Candidates and voter resources for ${whereShort}.`,
      ],
      DESCRIPTION_LIMIT,
    );
  }

  const named = (count: number) => {
    const names = active.slice(0, count).map(nameWithParty);
    const rest = active.length - count;
    if (rest <= 0) return naturalList(names);
    return `${names.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
  };
  const options: string[] = [];
  for (const count of [active.length, 3, 2]) {
    if (count > active.length) continue;
    const lead = `Compare ${named(count)} in`;
    const what = "sourced issue positions, polls and forecast.";
    options.push(
      `${lead} ${where}: ${what}${date}`,
      `${lead} ${where}: ${what}`,
      `${lead} ${whereShort}: ${what}`,
      `${lead} ${whereShort}: sourced positions and polls.`,
    );
  }
  return firstThatFits(options, DESCRIPTION_LIMIT);
}

/** Search description for a compare page (≤ 155 characters). */
export function compareMetaDescription(
  race: TitleRace | null | undefined,
): string {
  if (!race) return "Compare candidates side by side on the issues.";
  const labels = raceLabels(race);
  return firstThatFits(
    [
      `Side-by-side comparison of every candidate in ${raceInSentence(labels)}: positions on 12 issues, backgrounds, donors and voting records.`,
      `Side-by-side comparison of every candidate in ${raceInSentence(labels, false)} on 12 issues.`,
    ],
    DESCRIPTION_LIMIT,
  );
}

/** "Name (D) – TX-12 House 2026 | Smarter.Vote", shortened to fit 60 characters. */
export function candidatePageTitle(
  candidate: Pick<Candidate, "name"> & Partial<Pick<Candidate, "party">>,
  race: TitleRace | null | undefined,
): string {
  const name = nameWithParty(candidate);
  if (!race) return withSiteSuffix(name);
  const labels = raceLabels(race);
  const office = [labels.short, labels.special ? "special" : "", labels.year]
    .filter(Boolean)
    .join(" ");
  return withSiteSuffix(
    `${name} – ${office}`,
    labels.kind === "house"
      ? `${name} – ${labels.short.replace(/ House$/, "")} ${labels.year ?? ""}`.trim()
      : "",
    name,
  );
}

/**
 * Search description for a candidate page (≤ 155 characters). Researched
 * candidates list the issues covered; discovery-only ones say who they are
 * (party, incumbency, office) instead of promising a biography.
 */
export function candidateMetaDescription(
  candidate: MetadataCandidate | null | undefined,
  race: TitleRace | null | undefined,
): string {
  const labels = race ? raceLabels(race) : null;
  const where = labels ? raceInSentence(labels) : "this election";
  const whereShort = labels ? raceInSentence(labels, false) : "this election";
  if (!candidate) return `Candidate profile for ${where}.`;
  const name = candidate.name;

  const party = partyPhrase(candidate.party);
  const role = candidate.incumbent ? "incumbent" : "candidate";
  const who = party
    ? `${candidate.incumbent ? "the" : /^[aeiou]/i.test(party) ? "an" : "a"} ${party} ${role}`
    : candidate.incumbent
      ? "the incumbent"
      : "a candidate";
  const status = candidate.withdrawn
    ? `${name} was ${who} in ${whereShort} and has withdrawn.`
    : "";

  const issueNames = Object.entries(candidate.issues ?? {})
    .filter(([, issue]) => hasPublicPosition(issue))
    .map(([issue]) => getIssueDisplayName(issue));

  if (issueNames.length === 0) {
    const extras = [
      candidate.summary?.trim() ||
      candidate.career_history?.length ||
      candidate.education?.length
        ? "background"
        : "",
      candidate.donor_summary?.trim() ? "donors" : "",
      candidate.voting_summary?.trim() ? "voting record" : "",
    ].filter(Boolean);
    const extraText = extras.length
      ? ` See ${naturalList(extras)} and campaign links.`
      : "";
    return firstThatFits(
      [
        status
          ? `${status}${extraText}`
          : `${name} is ${who} in ${where}.${extraText}`,
        status || `${name} is ${who} in ${whereShort}.${extraText}`,
        status || `${name} is ${who} in ${whereShort}.`,
      ],
      DESCRIPTION_LIMIT,
    );
  }

  const subject = candidate.party
    ? `${name} (${partyAbbr(candidate.party)})`
    : name;
  const topics = (count: number) => {
    const shown = issueNames.slice(0, count);
    const rest = issueNames.length - shown.length;
    return rest > 0
      ? `${shown.join(", ")} and ${rest} more issue${rest === 1 ? "" : "s"}`
      : naturalList(shown);
  };
  const extras = [
    candidate.donor_summary?.trim() ? "top donors" : "",
    candidate.voting_summary?.trim() ? "voting record" : "",
  ].filter(Boolean);
  const extraText = extras.length ? `, plus ${naturalList(extras)}` : "";
  const lead = candidate.withdrawn ? `${subject} (withdrawn)` : subject;
  return firstThatFits(
    [
      `${lead} in ${where}: sourced positions on ${topics(2)}${extraText}.`,
      `${lead} in ${whereShort}: sourced positions on ${topics(2)}${extraText}.`,
      `${lead} in ${whereShort}: sourced positions on ${topics(1)}.`,
      `${lead} in ${whereShort}: sourced positions on ${issueNames.length} issues.`,
    ],
    DESCRIPTION_LIMIT,
  );
}
