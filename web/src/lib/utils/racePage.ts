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
import { partyKey, type PartyKey } from "$lib/utils/party";
import { raceDisplayTitle } from "$lib/utils/raceTitle";
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

/**
 * schema.org JSON-LD for a race page: the election as an Event whose
 * performers are the active candidates. Deliberately factual — no ratings,
 * forecasts, or party ordering.
 */
export function raceJsonLd(
  race: Race,
  now: Date = new Date(),
): Record<string, unknown> {
  const url = `${SITE_ORIGIN}/races/${race.id}/`;
  const candidates = neutralCandidateOrder(
    uniqueCandidatesByName(race.candidates).filter((c) => !c.withdrawn),
  );
  const people = candidates.map((c) => {
    const person: Record<string, unknown> = {
      "@type": "Person",
      name: c.name,
      url: `${SITE_ORIGIN}/races/${race.id}/${candidateSlug(c.name)}/`,
    };
    if (c.party)
      person.affiliation = { "@type": "Organization", name: c.party };
    if (c.image_url) person.image = c.image_url;
    return person;
  });
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: raceDisplayTitle(race),
    url,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: race.jurisdiction || race.state || "United States",
      address: race.state || race.jurisdiction || "United States",
    },
    performer: people,
  };
  const date = parseElectionDate(race.election_date);
  if (date) {
    data.startDate = `${date.year}-${String(date.month).padStart(2, "0")}-${String(
      date.day,
    ).padStart(2, "0")}`;
    // "Scheduled" is only true until Election Day has passed.
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (Date.UTC(date.year, date.month - 1, date.day) >= today)
      data.eventStatus = "https://schema.org/EventScheduled";
  }
  const description = cleanDisplayText(race.description);
  if (description) data.description = description;
  return data;
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
 * "Office · District · Jurisdiction" without repeating a place: a part that
 * another part already contains ("10th Congressional District" inside
 * "Florida's 10th Congressional District") is dropped.
 */
export function raceLocationLabel(
  race: Pick<Race, "office" | "district" | "jurisdiction">,
): string {
  const parts = [race.office, race.district, race.jurisdiction]
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
