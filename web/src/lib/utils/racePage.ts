/**
 * Pure helpers for the race, candidate, and compare pages. Kept out of the
 * Svelte files so the behaviour (poll ordering, forecast wording, slug
 * resolution, structured data) is unit-testable.
 */
import type { Candidate, PollEntry, Race, RaceForecast } from "$lib/types";
import {
  neutralCandidateOrder,
  uniqueCandidatesByName,
} from "$lib/utils/candidates";
import {
  parseElectionDate,
  type ElectionCalendarDate,
} from "$lib/utils/electionDate";
import {
  candidateSlug,
  legacyCandidateSlug,
  matchesCandidateSlug,
} from "$lib/utils/format";
import { avatarSrc } from "$lib/utils/avatar";
import { partyKey, type PartyKey } from "$lib/utils/party";
import { raceDisplayTitle } from "$lib/utils/raceTitle";
import { canonicalRaceState } from "$lib/utils/states";
import { isExternalUrl } from "$lib/utils/url";
import { splitSentences } from "$lib/utils/stance";

export {
  comparePreview,
  isNoPositionStance,
  splitSentences,
} from "$lib/utils/stance";

export const SITE_ORIGIN = "https://smarter.vote";

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
/** "2026-09-12 to 2026-09-15", "Sep 12 – Sep 15, 2026", "Sep 12 through 15". */
const RANGE_SEPARATOR = /\s+(?:to|through)\s+|\s*[–—]\s*/i;

function localCalendarDate(value: string): ElectionCalendarDate | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/**
 * The calendar day a poll date names. ISO dates are read as-is; a fieldwork
 * range ("2026-09-12 to 2026-09-15") counts as its end date, and other
 * readable dates ("Sep 14, 2026") are parsed as written.
 */
export function pollCalendarDate(
  value: string | null | undefined,
): ElectionCalendarDate | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const direct = parseElectionDate(trimmed);
  if (direct) return direct;
  const isoDates = trimmed.match(ISO_DATE);
  if (isoDates) {
    const end = parseElectionDate(isoDates[isoDates.length - 1]);
    if (end) return end;
  }
  const parts = trimmed.split(RANGE_SEPARATOR);
  const end = parts[parts.length - 1];
  return localCalendarDate(end) ?? localCalendarDate(trimmed);
}

/** Sortable UTC day ordinal for a poll date, or null when it has no usable date. */
function pollDateOrdinal(value: string | null | undefined): number | null {
  const date = pollCalendarDate(value);
  return date ? Date.UTC(date.year, date.month - 1, date.day) : null;
}

/**
 * Polls newest first; undated polls go last. Pipeline order is not a
 * reliable recency signal, so "latest poll" must never just be `polls[0]`.
 * The sort is stable, so polls on the same day keep their published order.
 */
export function sortPollsByDate<T extends Pick<PollEntry, "date">>(
  polls: readonly T[] | null | undefined,
): T[] {
  return [...(polls ?? [])]
    .map((poll, index) => ({
      poll,
      index,
      ordinal: pollDateOrdinal(poll.date),
    }))
    .sort((a, b) => {
      if (a.ordinal === null && b.ordinal === null) return a.index - b.index;
      if (a.ordinal === null) return 1;
      if (b.ordinal === null) return -1;
      return b.ordinal - a.ordinal || a.index - b.index;
    })
    .map(({ poll }) => poll);
}

/**
 * Format a poll field date as the calendar day it names. Date-only strings
 * ("2026-09-14") must not shift to the previous day in US time zones, which is
 * what `new Date("2026-09-14").toLocaleDateString()` does.
 */
export function formatPollDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string {
  const date = pollCalendarDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
}

/**
 * Date label for a poll card: the formatted calendar day when the value is
 * readable, otherwise the raw text (so an unusual date is never silently
 * dropped). Empty only when there is no date at all.
 */
export function pollDateLabel(value: string | null | undefined): string {
  const formatted = formatPollDate(value);
  if (formatted) return formatted;
  const raw = (value ?? "").trim();
  return raw.length > 40 ? `${raw.slice(0, 39)}…` : raw;
}

/** Polls older than this many days show their age next to the date. */
export const POLL_AGE_NOTICE_DAYS = 60;
/** Polls fielded more than this many months before Election Day belong to a previous cycle. */
export const PREVIOUS_CYCLE_MONTHS = 18;

function utcDay(date: ElectionCalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/**
 * "3 months old" for a poll fielded more than POLL_AGE_NOTICE_DAYS before
 * `now`; empty for recent or undated polls.
 */
export function pollAgeLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = pollCalendarDate(value);
  if (!date) return "";
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((today - utcDay(date)) / 86_400_000);
  if (days <= POLL_AGE_NOTICE_DAYS) return "";
  const months = Math.floor(days / 30.4375);
  if (months < 12) return `${months} months old`;
  const years = Math.floor(months / 12);
  return years === 1 ? "over a year old" : `over ${years} years old`;
}

/**
 * True when a poll was fielded more than PREVIOUS_CYCLE_MONTHS before the
 * race's Election Day, i.e. it measured an earlier campaign. Such a poll is
 * never the race's "latest poll".
 */
export function isPreviousCyclePoll(
  value: string | null | undefined,
  electionDate: string | null | undefined,
): boolean {
  const poll = pollCalendarDate(value);
  const election = parseElectionDate(electionDate ?? "");
  if (!poll || !election) return false;
  const cutoff = Date.UTC(
    election.year,
    election.month - 1 - PREVIOUS_CYCLE_MONTHS,
    election.day,
  );
  return utcDay(poll) < cutoff;
}

// ---------------------------------------------------------------------------
// Contest stage
// ---------------------------------------------------------------------------

export interface ContestStageNotice {
  kind: "uncontested" | "primary" | "ranked_choice" | "top_two" | "runoff";
  title: string;
  body: string;
}

/** Only one active candidate in a general election: nothing to forecast. */
export function isUncontestedRace(
  race: { contest_stage?: Race["contest_stage"] | null },
  activeCandidateCount: number,
): boolean {
  if (race.contest_stage === "uncontested") return true;
  return (
    activeCandidateCount === 1 && race.contest_stage === "post_primary_general"
  );
}

/** Federal offices that Maine elects by ranked choice in the general election. */
function isFederalOffice(office: string | undefined): boolean {
  return /senate|house|representative|congress/i.test(office ?? "");
}

/**
 * What a voter needs to know when this contest is not an ordinary two-way
 * general election, or null when it is. Wording depends only on the
 * published `contest_stage`, the state, and the office.
 */
export function contestStageNotice(
  race: Pick<
    Race,
    "id" | "contest_stage" | "state" | "jurisdiction" | "office"
  >,
  activeCandidates: readonly Pick<Candidate, "name">[],
): ContestStageNotice | null {
  const state = canonicalRaceState(race);
  if (isUncontestedRace(race, activeCandidates.length)) {
    const only =
      activeCandidates.length === 1 ? activeCandidates[0].name : null;
    return {
      kind: "uncontested",
      title: "Uncontested race",
      body: `${only ? `${only} is the only candidate` : "Only one candidate is running"}, so this race won't appear on your ballot, or appears with one name, depending on state rules. There is no forecast for an uncontested race.`,
    };
  }
  if (race.contest_stage === "pre_primary") {
    if (state === "Louisiana") {
      return {
        kind: "primary",
        title: "Nov 3 is an open primary for this seat",
        body: "In Louisiana, every candidate for this seat appears on the same Nov 3 ballot, regardless of party. If no one wins a majority, the top two finishers advance to a runoff in December.",
      };
    }
    return {
      kind: "primary",
      title: "The primary hasn't happened yet",
      body: "The candidates listed are running for their party's nomination. The general-election field will be set after the primary.",
    };
  }
  if (
    race.contest_stage === "top_four_rcv" ||
    state === "Alaska" ||
    (state === "Maine" && isFederalOffice(race.office))
  ) {
    return {
      kind: "ranked_choice",
      title: "Ranked-choice general election",
      body: `${state === "Alaska" ? "Alaska's top-four primary sent up to four candidates to this ballot, and the" : "The"} general election uses ranked-choice voting: you may rank the candidates in order of preference. If no one wins a majority of first choices, the last-place candidate is eliminated and those ballots count for their next choice, until one candidate has a majority.`,
    };
  }
  if (race.contest_stage === "top_two") {
    return {
      kind: "top_two",
      title: "Top-two general election",
      body: "The top two finishers in an all-candidate primary advanced to this ballot, so both can be from the same party.",
    };
  }
  if (race.contest_stage === "runoff") {
    return {
      kind: "runoff",
      title: "Runoff election",
      body: "No candidate won a majority in the first round, so the top finishers meet again in a runoff.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Senate seat class
// ---------------------------------------------------------------------------

/**
 * Senate seat classes on the ballot in 2026. Source: U.S. Senate, "Senators
 * by class" (senate.gov/senators/Class_II.htm) — the 33 Class II seats whose
 * terms end January 3, 2027 — plus the two 2026 special elections for Class
 * III seats: Ohio (vacated by JD Vance, appointed Jon Husted) and Florida
 * (vacated by Marco Rubio, appointed Ashley Moody), both terms ending
 * January 3, 2029.
 */
const SENATE_CLASS_2026: Readonly<Record<string, 2 | 3>> = {
  Alabama: 2,
  Alaska: 2,
  Arkansas: 2,
  Colorado: 2,
  Delaware: 2,
  Georgia: 2,
  Idaho: 2,
  Illinois: 2,
  Iowa: 2,
  Kansas: 2,
  Kentucky: 2,
  Louisiana: 2,
  Maine: 2,
  Massachusetts: 2,
  Michigan: 2,
  Minnesota: 2,
  Mississippi: 2,
  Montana: 2,
  Nebraska: 2,
  "New Hampshire": 2,
  "New Jersey": 2,
  "New Mexico": 2,
  "North Carolina": 2,
  Oklahoma: 2,
  Oregon: 2,
  "Rhode Island": 2,
  "South Carolina": 2,
  "South Dakota": 2,
  Tennessee: 2,
  Texas: 2,
  Virginia: 2,
  "West Virginia": 2,
  Wyoming: 2,
};
const SENATE_SPECIALS_2026: Readonly<Record<string, 3>> = {
  Ohio: 3,
  Florida: 3,
};

const ROMAN_CLASS = { 1: "I", 2: "II", 3: "III" } as const;

/**
 * "Class II seat" / "Class III seat (special election)" for a Senate race,
 * from the table above rather than the research text, or null when the seat
 * is not in the table (another cycle, or not a Senate race).
 */
export function senateSeatLabel(
  race: Pick<Race, "id" | "office" | "state" | "jurisdiction"> &
    Partial<Pick<Race, "election_date">>,
): string | null {
  if (!/senate/i.test(race.office ?? "")) return null;
  const year =
    race.id.match(/\b(20\d{2})\b/)?.[1] ?? race.election_date?.slice(0, 4);
  if (year !== "2026") return null;
  const state = canonicalRaceState(race);
  if (!state) return null;
  const special = /(^|-)special(-|$)/.test(race.id);
  const seatClass = special
    ? SENATE_SPECIALS_2026[state]
    : SENATE_CLASS_2026[state];
  if (!seatClass) return null;
  return `Class ${ROMAN_CLASS[seatClass]} seat${special ? " (special election)" : ""}`;
}

// ---------------------------------------------------------------------------
// Loading errors
// ---------------------------------------------------------------------------

/** True when a fetch error means the race/candidate does not exist (or was retired). */
export function isNotFoundError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /\b(404|410)\b/.test(message) || /not found/i.test(message);
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export interface ForecastHeadline {
  /** Heading text, e.g. "Toss-up", "Jane Doe favored", "No clear favorite". */
  title: string;
  /** Who the win probability belongs to, or null when the data does not say. */
  leader: string | null;
}

/**
 * Heading text for a race forecast. It only uses what the forecast states —
 * the named winner, then the named party — and never infers a party from the
 * incumbent or from D/R probabilities.
 */
export function forecastHeadline(
  forecast: Pick<
    RaceForecast,
    "rating" | "predicted_winner_name" | "predicted_winner_party"
  >,
): ForecastHeadline {
  const name = forecast.predicted_winner_name?.trim() || "";
  const party = forecast.predicted_winner_party?.trim() || "";
  const leader = name || (party ? `${party} candidate` : null);
  if (forecast.rating === "tossup") return { title: "Toss-up", leader };
  if (name) return { title: `${name} favored`, leader };
  if (party) return { title: `${party} candidate favored`, leader };
  return { title: "No clear favorite", leader: null };
}

/**
 * A win probability as a whole percent that never overstates certainty:
 * anything that would round to 100% reads ">99%" and anything that would
 * round to 0% reads "<1%". Used by the race page and both comparisons.
 */
export function formatWinProbability(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value >= 0.995) return ">99%";
  if (value < 0.005) return "<1%";
  return `${Math.round(value * 100)}%`;
}

export interface PartyProbabilitySegment {
  party: string;
  key: PartyKey;
  value: number;
  label: string;
}

/** Every positive party probability, largest first, for the probability bar. */
export function partyProbabilitySegments(
  probabilities: Record<string, number> | null | undefined,
): PartyProbabilitySegment[] {
  return Object.entries(probabilities ?? {})
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]) &&
        entry[1] > 0,
    )
    .sort((a, b) => b[1] - a[1])
    .map(([party, value]) => ({
      party,
      key: partyKey(party),
      value,
      label: formatWinProbability(value),
    }));
}

/** Accessible summary of every segment in the probability bar. */
export function partyProbabilityAriaLabel(
  segments: readonly PartyProbabilitySegment[],
): string {
  if (segments.length === 0) return "No party win probabilities available";
  return `Party win probabilities: ${segments
    .map((segment) => `${segment.party} ${segment.label}`)
    .join(", ")}`;
}

function partyBucket(party: string | undefined): string | null {
  const trimmed = (party ?? "").trim();
  if (!trimmed) return null;
  const key = partyKey(trimmed);
  // Unrecognised parties all share the "other" key, so they only match exactly.
  return key === "other" ? `other:${trimmed.toLowerCase()}` : key;
}

/**
 * Win probability for one candidate in a comparison. The named predicted
 * winner gets the headline probability; anyone else only gets a party
 * probability when their party is unambiguous — exactly one active candidate
 * from that party — because a party's chance is not any one member's chance.
 */
export function candidateForecastProbability(
  candidate: Pick<Candidate, "name" | "party">,
  forecast: RaceForecast | null | undefined,
  activeCandidates: readonly Pick<Candidate, "name" | "party">[],
): number | undefined {
  if (!forecast) return undefined;
  if (
    forecast.predicted_winner_name &&
    forecast.predicted_winner_name === candidate.name
  ) {
    return forecast.win_probability;
  }
  const bucket = partyBucket(candidate.party);
  if (!bucket) return undefined;
  const sharing = activeCandidates.filter(
    (other) => partyBucket(other.party) === bucket,
  ).length;
  if (sharing > 1) return undefined;
  const match = Object.entries(forecast.party_probabilities ?? {}).find(
    ([key]) => partyBucket(key) === bucket,
  );
  return typeof match?.[1] === "number" ? match[1] : undefined;
}

// ---------------------------------------------------------------------------
// Candidate slugs
// ---------------------------------------------------------------------------

export interface ResolvedCandidate {
  candidate: Candidate | null;
  others: Candidate[];
  canonicalSlug: string | null;
  /** True when the URL used an older slug scheme and should be canonicalised. */
  isLegacySlug: boolean;
}

/** Find the candidate a URL slug addresses (current or legacy slug), plus the rest of the field. */
export function resolveCandidate(
  race: Pick<Race, "candidates"> | null | undefined,
  slug: string | null | undefined,
): ResolvedCandidate {
  const all = uniqueCandidatesByName(race?.candidates);
  // A current slug always wins over another candidate's legacy slug, so a
  // name that folds onto someone else's old URL cannot hijack it.
  const candidate =
    (slug &&
      (all.find((c) => candidateSlug(c.name) === slug) ??
        all.find((c) => legacyCandidateSlug(c.name) === slug))) ||
    null;
  const others = neutralCandidateOrder(
    all.filter((c) => c !== candidate && !c.withdrawn),
  );
  const canonicalSlug = candidate ? candidateSlug(candidate.name) : null;
  return {
    candidate,
    others,
    canonicalSlug,
    isLegacySlug: !!canonicalSlug && canonicalSlug !== slug,
  };
}

/**
 * Active candidates named in a `?candidates=` list (current or legacy slugs),
 * in neutral order. Falls back to every active candidate when none match.
 */
export function selectComparedCandidates(
  race: Pick<Race, "candidates"> | null | undefined,
  param: string | null | undefined,
): Candidate[] {
  const active = neutralCandidateOrder(
    uniqueCandidatesByName(race?.candidates).filter((c) => !c.withdrawn),
  );
  const slugs = (param ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (slugs.length === 0) return active;
  // Each slug picks the candidate whose current slug it is; only when no one
  // owns it as a current slug does it fall back to a legacy match.
  const current = new Set(active.map((c) => candidateSlug(c.name)));
  const selected = active.filter((c) =>
    slugs.some((slug) =>
      current.has(slug)
        ? candidateSlug(c.name) === slug
        : matchesCandidateSlug(c.name, slug),
    ),
  );
  return selected.length > 0 ? selected : active;
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

const ELECTIONS_CRUMB = { name: "Elections", url: `${SITE_ORIGIN}/elections/` };

function breadcrumbList(
  url: string,
  crumbs: readonly { name: string; url: string }[],
): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

const SITE_ENTITY = {
  "@type": "WebSite",
  name: "Smarter.Vote",
  url: `${SITE_ORIGIN}/`,
};

/**
 * schema.org JSON-LD for a race page: a WebPage with an
 * Elections › Race breadcrumb. Deliberately factual — no ratings, forecasts,
 * or candidate ordering.
 */
export function raceJsonLd(race: Race): Record<string, unknown> {
  const url = `${SITE_ORIGIN}/races/${race.id}/`;
  const name = raceDisplayTitle(race);
  const page: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": url,
    url,
    name,
    isPartOf: SITE_ENTITY,
    breadcrumb: { "@id": `${url}#breadcrumb` },
  };
  const description = cleanDisplayText(race.description);
  if (description) page.description = description;
  if (race.updated_utc) page.dateModified = race.updated_utc;
  return {
    "@context": "https://schema.org",
    "@graph": [page, breadcrumbList(url, [ELECTIONS_CRUMB, { name, url }])],
  };
}

/** Formal party name for structured data, or null for independents and blanks. */
export function politicalPartyName(party: string | undefined): string | null {
  const trimmed = (party ?? "").trim();
  if (!trimmed) return null;
  const key = partyKey(trimmed);
  if (key === "ind") return null;
  if (key === "dem") return "Democratic Party";
  if (key === "rep") return "Republican Party";
  if (key === "grn") return "Green Party";
  if (key === "lib") return "Libertarian Party";
  return /\bparty\b/i.test(trimmed) ? trimmed : `${trimmed} Party`;
}

/**
 * schema.org JSON-LD for a candidate page: a ProfilePage whose main entity is
 * the candidate (Person), with an Elections › Race › Candidate breadcrumb.
 */
export function candidateJsonLd(
  race: Race,
  candidate: Candidate,
): Record<string, unknown> {
  const raceUrl = `${SITE_ORIGIN}/races/${race.id}/`;
  const url = `${raceUrl}${candidateSlug(candidate.name)}/`;
  const person: Record<string, unknown> = {
    "@type": "Person",
    name: candidate.name,
    url,
  };
  const image = avatarSrc(candidate.image_url);
  if (image && isExternalUrl(image)) person.image = image;
  const party = politicalPartyName(candidate.party);
  if (party) person.affiliation = { "@type": "PoliticalParty", name: party };
  const sameAs = [
    candidate.website,
    ...Object.values(candidate.social_media ?? {}),
  ]
    .filter((link): link is string => isExternalUrl(link))
    .map((link) => link.trim());
  if (sameAs.length > 0) person.sameAs = [...new Set(sameAs)];
  const page: Record<string, unknown> = {
    "@type": "ProfilePage",
    "@id": url,
    url,
    name: candidate.name,
    isPartOf: SITE_ENTITY,
    mainEntity: person,
    breadcrumb: { "@id": `${url}#breadcrumb` },
  };
  if (race.updated_utc) page.dateModified = race.updated_utc;
  return {
    "@context": "https://schema.org",
    "@graph": [
      page,
      breadcrumbList(url, [
        ELECTIONS_CRUMB,
        { name: raceDisplayTitle(race), url: raceUrl },
        { name: candidate.name, url },
      ]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Social share image
// ---------------------------------------------------------------------------

export const SITE_SHARE_IMAGE = `${SITE_ORIGIN}/og-image.png`;

/**
 * Headshot hosts that reliably serve a real portrait to link-preview
 * crawlers: Ballotpedia's S3 bucket, Wikimedia (via its thumbnail service),
 * and Congress's official bioguide photos. Anything else (campaign sites,
 * CDNs that block hotlinking, partisan guides) falls back to the site image.
 */
function isKnownGoodHeadshot(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname === "s3.amazonaws.com")
      return parsed.pathname.startsWith("/ballotpedia-api");
    return [
      "upload.wikimedia.org",
      "bioguide.congress.gov",
      "www.congress.gov",
    ].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * og:image / twitter:card for a candidate page. A headshot is small and
 * portrait-shaped, so it uses the compact "summary" card; without a reliable
 * headshot the page shares the site image as a large card.
 */
export function candidateShareImage(
  candidate: Pick<Candidate, "image_url"> | null | undefined,
): { image: string; card: "summary" | "summary_large_image" } {
  const headshot = avatarSrc(candidate?.image_url);
  if (headshot && isKnownGoodHeadshot(headshot))
    return { image: headshot, card: "summary" };
  return { image: SITE_SHARE_IMAGE, card: "summary_large_image" };
}

/** Serialise JSON-LD into a <script> tag that cannot be broken out of with "</script>". */
export function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(
    /</g,
    "\\u003c",
  )}</script>`;
}

// ---------------------------------------------------------------------------
// Display text
// ---------------------------------------------------------------------------

// Research prose cites sources inline: "(https://a.gov/x; https://b.com/y)",
// "[Source: https://…]", "(Official campaign policy page: https://…)" or a
// trailing "Sources: https://a and https://b". The page shows those as links
// instead of printing them. This is a hand-written scanner rather than one big
// regex: every step consumes input, and a URL or label that runs past its cap
// abandons the attempt, so the work is linear in the text length (an earlier
// regex here was flagged for catastrophic backtracking).

/** Longest URL the scanner will read; anything longer is not a citation. */
const MAX_URL_LENGTH = 2048;
/** readUrl result for a run of MAX_URL_LENGTH characters with no terminator. */
const URL_TOO_LONG = -2;
/** Longest "Official campaign policy page:"-style label before a cited URL. */
const MAX_LABEL_LENGTH = 80;
/** Characters trimmed from the end of a URL: sentence punctuation, not path. */
const URL_TRAILING_PUNCTUATION = ".,:;!?'\"”’";
/** Unbracketed lead-ins for a citation list ("Sources: https://…"). */
const SOURCE_LEAD_IN =
  /\b(?:sources?(?: checked| urls?)?|official [a-z ]{0,40}?page)\s*:\s*(?=https?:\/\/)/gi;

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && (ch <= " " || ch === "\u00a0");
}

function isUrlStart(text: string, index: number): boolean {
  return (
    text.startsWith("https://", index) || text.startsWith("http://", index)
  );
}

/**
 * End index (exclusive) of the URL starting at `start`, -1 when it is not a
 * usable URL, or URL_TOO_LONG when no terminator appears within the cap. URL bodies may contain commas ("election,_2026") and balanced
 * parentheses ("Name_(politician)"); a closing bracket with no opener ends the
 * URL, and trailing sentence punctuation is not part of it.
 */
function readUrl(text: string, start: number): number {
  let parens = 0;
  let brackets = 0;
  let end = start;
  const limit = Math.min(text.length, start + MAX_URL_LENGTH);
  while (end < limit) {
    const ch = text[end];
    if (isSpace(ch) || ch === ";" || ch === "<" || ch === ">") break;
    if (ch === "(") parens += 1;
    else if (ch === ")") {
      if (parens === 0) break;
      parens -= 1;
    } else if (ch === "[") brackets += 1;
    else if (ch === "]") {
      if (brackets === 0) break;
      brackets -= 1;
    }
    end += 1;
  }
  if (end === limit && limit < text.length && !isSpace(text[end]))
    return URL_TOO_LONG;
  while (end > start && URL_TRAILING_PUNCTUATION.includes(text[end - 1]))
    end -= 1;
  // A URL must have something after the scheme.
  return /^https?:\/\/[^/]/.test(text.slice(start, end)) ? end : -1;
}

function skipSpaces(text: string, index: number): number {
  let i = index;
  while (isSpace(text[i])) i += 1;
  return i;
}

/**
 * Index of the URL after an optional short "Label:" at `index` (e.g.
 * "Source:", "campaign homepage content recovered from that page:"), or -1.
 */
function urlAfterLabel(text: string, index: number): number {
  if (isUrlStart(text, index)) return index;
  const limit = Math.min(text.length, index + MAX_LABEL_LENGTH);
  for (let i = index; i < limit; i += 1) {
    const ch = text[i];
    if (ch === ":") {
      if (i === index) return -1;
      const next = skipSpaces(text, i + 1);
      return isUrlStart(text, next) ? next : -1;
    }
    if (!/[\p{L}\p{N} '’-]/u.test(ch)) return -1;
  }
  return -1;
}

/**
 * Parse a run of cited URLs starting at `index`: URL, then any number of
 * separators (";", ",", "and") each followed by an optionally labelled URL.
 * Returns the URLs and where the run ends (after its last URL).
 */
function readUrlList(
  text: string,
  index: number,
  allowLabels: boolean,
): { urls: string[]; end: number } | typeof URL_TOO_LONG | null {
  const urls: string[] = [];
  const urlStart = allowLabels ? urlAfterLabel(text, index) : index;
  if (urlStart < 0 || !isUrlStart(text, urlStart)) return null;
  let end = readUrl(text, urlStart);
  if (end === URL_TOO_LONG) return URL_TOO_LONG;
  if (end < 0) return null;
  urls.push(text.slice(urlStart, end));
  for (;;) {
    let i = skipSpaces(text, end);
    let separated = false;
    if (text[i] === ";" || text[i] === ",") {
      i = skipSpaces(text, i + 1);
      separated = true;
    }
    if (/^and\s/i.test(text.slice(i, i + 4))) {
      i = skipSpaces(text, i + 3);
      separated = true;
    }
    // Whitespace alone may separate two bare URLs; a label needs a separator.
    const next = separated && allowLabels ? urlAfterLabel(text, i) : i;
    if (next < 0 || !isUrlStart(text, next)) break;
    const nextEnd = readUrl(text, next);
    if (nextEnd < 0) break;
    urls.push(text.slice(next, nextEnd));
    end = nextEnd;
  }
  return { urls, end };
}

interface Citations {
  /** The text with every citation removed (spacing not yet tidied). */
  prose: string;
  /** Cited URLs in order of appearance (may repeat). */
  urls: string[];
}

/** Remove inline source citations from prose and collect their URLs. */
function extractCitations(text: string): Citations {
  const urls: string[] = [];
  let prose = "";
  let copied = 0;
  // 1. Bracketed groups holding nothing but (optionally labelled) URLs.
  // After a URL runs past the length cap, brackets inside that same unbroken
  // run are not retried: thousands of characters with no space are not prose,
  // and retrying each one would make "(http://(http://…" quadratic-ish.
  let skipUntil = 0;
  for (let i = 0; i < text.length; i += 1) {
    const open = text[i];
    if (open !== "(" && open !== "[") continue;
    if (i < skipUntil) continue;
    const close = open === "(" ? ")" : "]";
    const list = readUrlList(text, skipSpaces(text, i + 1), true);
    if (list === URL_TOO_LONG) {
      skipUntil = i + MAX_URL_LENGTH;
      continue;
    }
    if (!list) continue;
    let end = skipSpaces(text, list.end);
    if (text[end] === ";" || text[end] === ",") end = skipSpaces(text, end + 1);
    if (text[end] !== close) continue;
    urls.push(...list.urls);
    prose += text.slice(copied, i);
    copied = end + 1;
    i = end;
  }
  prose += text.slice(copied);

  // 2. Unbracketed "Sources: https://… ; https://…" runs.
  let result = "";
  copied = 0;
  for (const match of prose.matchAll(SOURCE_LEAD_IN)) {
    const start = match.index ?? 0;
    if (start < copied) continue;
    const list = readUrlList(prose, start + match[0].length, true);
    if (!list || list === URL_TOO_LONG) continue;
    urls.push(...list.urls);
    result += prose.slice(copied, start);
    let end = list.end;
    // "…(n=550). Source: https://x . Next" — drop the orphaned period.
    const after = skipSpaces(prose, end);
    if (prose[after] === "." && /[.!?]\s*$/.test(result)) end = after + 1;
    copied = end;
  }
  result += prose.slice(copied);
  return { prose: result, urls };
}

/**
 * Undo JSON escapes that leaked into stored prose (`\"`, `\'`, `\u2019`,
 * `\n`). A backslash-letter pair only counts as a leaked `\n`/`\t`/`\r` when
 * the text shows other JSON-escape evidence or the backslash does not follow a
 * word character or colon — so a path like "C:\new" survives.
 */
export function unescapeLeakedJson(text: string): string {
  const evidence = /\\["']|\\u[0-9a-fA-F]{4}|\\n\\n|[.!?]\\[nrt]/.test(text);
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\(["'])/g, "$1")
    .replace(/\\([nrt])/g, (escape: string, kind: string, offset: number) => {
      if (!evidence && /[\w:]/.test(text[offset - 1] ?? "")) return escape;
      return kind === "n" ? "\n" : " ";
    });
}

/**
 * Collapse runs of spaces and remove a space left before punctuation by a
 * removed citation ("seat (https://…)." → "seat."). Punctuation that starts
 * an emoticon or another bracket (":)", ";(") keeps its space.
 */
export function tidySpacing(text: string): string {
  return text
    .replace(/[ \t\u00a0]{2,}/g, " ")
    .replace(/[ \t\u00a0]+([.,;:!?])(?=\s|$|["'”’])/g, "$1")
    .trim();
}

/**
 * Prose as it should be read on the page: leaked JSON escapes undone and
 * URL-only citations removed (render those with `splitSourcedText`).
 */
export function cleanDisplayText(text: string | null | undefined): string {
  if (typeof text !== "string") return "";
  return tidySpacing(extractCitations(unescapeLeakedJson(text)).prose);
}

/** Hostname without a leading "www.", or the input when it is not a URL. */
export function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
export interface SourcedText {
  /** Readable paragraphs with inline URL citations removed. */
  paragraphs: string[];
  /** Cited URLs in first-seen order, deduplicated. */
  sources: { url: string; label: string }[];
}

/**
 * Turn one long research paragraph with inline "(https://…)" citations into
 * short paragraphs plus a deduplicated source list. Paragraphs break at
 * sentence boundaries once they pass `targetLength` characters.
 */
export function splitSourcedText(
  text: string | null | undefined,
  targetLength = 320,
): SourcedText {
  if (typeof text !== "string" || !text.trim())
    return { paragraphs: [], sources: [] };
  const { prose: raw, urls } = extractCitations(unescapeLeakedJson(text));
  const seen = new Set<string>();
  const sources: SourcedText["sources"] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ url, label: sourceHostname(url) });
  }
  const prose = tidySpacing(raw);
  const blocks = prose
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const paragraphs: string[] = [];
  for (const block of blocks) {
    const local: string[] = [];
    let current = "";
    for (const sentence of splitSentences(block)) {
      current = current ? `${current} ${sentence}` : sentence;
      if (current.length >= targetLength) {
        local.push(current);
        current = "";
      }
    }
    if (current) {
      // A short tail reads better attached to the paragraph before it.
      if (local.length > 0 && current.length < targetLength / 3)
        local[local.length - 1] = `${local[local.length - 1]} ${current}`;
      else local.push(current);
    }
    paragraphs.push(...local);
  }
  return { paragraphs, sources };
}

/**
 * "Office · District · Jurisdiction" without repeating a place (for Senate
 * races the district is the seat class from `senateSeatLabel`): a part that
 * another part already contains ("10th Congressional District" inside
 * "Florida's 10th Congressional District") is dropped.
 */
export function raceLocationLabel(
  race: Pick<Race, "office" | "district" | "jurisdiction"> &
    Partial<Pick<Race, "id" | "state" | "election_date">>,
): string {
  // Senate "districts" are free research text ("Statewide (Class 1 seat)",
  // sometimes wrong); the seat class comes from a fixed table instead.
  const isSenate = /senate/i.test(race.office ?? "");
  const district = isSenate
    ? race.id
      ? senateSeatLabel({ ...race, id: race.id })
      : null
    : race.district;
  const parts = [race.office, district, race.jurisdiction]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
  const kept = parts.filter((part, index) => {
    const lower = part.toLowerCase();
    return !parts.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      const otherLower = other.toLowerCase();
      if (otherLower === lower) return otherIndex < index;
      return otherLower.includes(lower);
    });
  });
  return kept.join(" · ");
}

// ---------------------------------------------------------------------------
// Build-time page payloads
// ---------------------------------------------------------------------------

/** Pipeline bookkeeping no public page reads. */
function withoutPipelineFields(race: Race): Race {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pipeline_state, run_audit, agent_metrics, ...rest } = race;
  return rest as Race;
}

/** The race as the race page embeds it: everything shown, minus pipeline internals. */
export function raceDetailPayload(race: Race): Race {
  return withoutPipelineFields(race);
}

/**
 * The race as a candidate page embeds it: the race header fields, the one
 * candidate in full, and only name/party/photo/status for everyone else.
 */
export function candidatePagePayload(race: Race, slug: string): Race {
  const { candidate } = resolveCandidate(race, slug);
  const {
    description,
    polling,
    polling_note,
    forecast,
    reviews,
    validation_grade,
    ...header
  } = withoutPipelineFields(race);
  void description;
  void polling;
  void polling_note;
  void forecast;
  void reviews;
  void validation_grade;
  return {
    ...header,
    polling: [],
    reviews: [],
    candidates: (race.candidates ?? []).map((entry) =>
      entry === candidate
        ? entry
        : ({
            name: entry.name,
            party: entry.party,
            incumbent: entry.incumbent,
            image_url: entry.image_url,
            withdrawn: entry.withdrawn,
          } as Candidate),
    ),
  } as Race;
}

/**
 * The race as the compare page embeds it: the fields the comparison shows
 * (positions with their sources, background, donor and voting summaries,
 * the forecast headline) without the race overview, polls, or reviews.
 */
export function comparePagePayload(race: Race): Race {
  const base = withoutPipelineFields(race);
  return {
    id: base.id,
    schema_version: base.schema_version,
    title: base.title,
    office: base.office,
    state: base.state,
    jurisdiction: base.jurisdiction,
    district: base.district,
    election_date: base.election_date,
    updated_utc: base.updated_utc,
    contest_stage: base.contest_stage,
    generator: [],
    polling: [],
    reviews: [],
    validation_grade: base.validation_grade,
    forecast: base.forecast
      ? ({
          rating: base.forecast.rating,
          predicted_winner_name: base.forecast.predicted_winner_name,
          predicted_winner_party: base.forecast.predicted_winner_party,
          win_probability: base.forecast.win_probability,
          party_probabilities: base.forecast.party_probabilities,
        } as RaceForecast)
      : undefined,
    candidates: (base.candidates ?? []).map(
      (candidate) =>
        ({
          name: candidate.name,
          party: candidate.party,
          incumbent: candidate.incumbent,
          withdrawn: candidate.withdrawn,
          image_url: candidate.image_url,
          website: candidate.website,
          summary: candidate.summary,
          issues: candidate.issues,
          career_history: candidate.career_history,
          education: candidate.education,
          donor_summary: candidate.donor_summary,
          donor_source_url: candidate.donor_source_url,
          voting_summary: candidate.voting_summary,
          voting_source_url: candidate.voting_source_url,
        }) as Candidate,
    ),
  } as Race;
}
