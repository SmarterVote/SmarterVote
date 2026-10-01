/**
 * Pure helpers for the race, candidate, and compare pages. Kept out of the
 * Svelte files so the behaviour (poll ordering, forecast wording, slug
 * resolution, structured data) is unit-testable.
 */
import type { Candidate, PollEntry, Race, RaceForecast } from "$lib/types";
import { neutralCandidateOrder } from "$lib/utils/candidates";
import { parseElectionDate } from "$lib/utils/electionDate";
import { candidateSlug, matchesCandidateSlug } from "$lib/utils/format";
import { partyKey, type PartyKey } from "$lib/utils/party";
import { probability } from "$lib/utils/forecastPresentation";
import { raceDisplayTitle } from "$lib/utils/raceTitle";

export const SITE_ORIGIN = "https://smarter.vote";

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

/** Sortable UTC day ordinal for a poll date, or null when it has no usable date. */
function pollDateOrdinal(value: string | null | undefined): number | null {
  const date = parseElectionDate(value);
  if (date) return Date.UTC(date.year, date.month - 1, date.day);
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
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
  const date = parseElectionDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
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
      label: probability(value),
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
  const all = race?.candidates ?? [];
  const candidate =
    (slug &&
      (all.find((c) => candidateSlug(c.name) === slug) ??
        all.find((c) => matchesCandidateSlug(c.name, slug)))) ||
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
    (race?.candidates ?? []).filter((c) => !c.withdrawn),
  );
  const slugs = (param ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (slugs.length === 0) return active;
  const selected = active.filter((c) =>
    slugs.some((slug) => matchesCandidateSlug(c.name, slug)),
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
export function raceJsonLd(race: Race): Record<string, unknown> {
  const url = `${SITE_ORIGIN}/races/${race.id}/`;
  const candidates = neutralCandidateOrder(
    (race.candidates ?? []).filter((c) => !c.withdrawn),
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
    eventStatus: "https://schema.org/EventScheduled",
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
  }
  if (race.description) data.description = race.description;
  return data;
}

/** Serialise JSON-LD into a <script> tag that cannot be broken out of with "</script>". */
export function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(
    /</g,
    "\\u003c",
  )}</script>`;
}
