/**
 * Header search: a compact index of races and candidates, and relevance
 * ranking over it.
 *
 * The index is built at build time (src/routes/search-index.json/+server.ts,
 * prerendered) so the header no longer downloads the full ~2 MB
 * summaries.json on the first keystroke. The same builder runs in the browser
 * as a fallback when the prebuilt file is unavailable (local dev without
 * data, an older deployment).
 */
import type { RaceSummary } from "$lib/types";
import {
  officeDisplayName,
  raceShortLabel,
} from "$lib/utils/forecastPresentation";
import { raceDisplayTitle } from "$lib/utils/raceTitle";
import {
  getSearchTokens,
  matchesSearchDoc,
  normalizeSearchText,
  prepareSearchDoc,
  type SearchDoc,
} from "$lib/utils/search";
import { STATE_NAMES_BY_CODE } from "$lib/utils/states";

export const SEARCH_INDEX_VERSION = 1;

/** One race in the index. Short keys keep the file small. */
export interface SearchIndexRace {
  /** Race id (also the URL slug). */
  i: string;
  /** Display title. */
  t: string;
  /** Subtitle ("U.S. Senate · Texas"). */
  s: string;
  /** Short code: "TX-10", "TX-AL" for a House seat, "TX" for statewide. */
  c: string;
  /** Office kind: S(enate), G(overnor), H(ouse) or O(ther). */
  o: "S" | "G" | "H" | "O";
  /** Extra normalized search words (beyond those in `t` and `s`). */
  w: string;
  /** Candidates as [name, party]. */
  p: Array<[string, string] | [string]>;
}

export interface SearchIndex {
  v: number;
  races: SearchIndexRace[];
}

function officeKind(office: string | undefined): SearchIndexRace["o"] {
  const o = (office ?? "").toLowerCase();
  if (o.includes("senate") || o.includes("senator")) return "S";
  if (o.includes("governor") || o.includes("gubernatorial")) return "G";
  if (o.includes("house") || o.includes("representative")) return "H";
  return "O";
}

/** Words of `values` not already among the words of `known`, de-duplicated. */
function extraWords(
  known: string[],
  ...values: Array<string | null | undefined>
): string {
  const seen = new Set<string>(
    known.flatMap((value) => getSearchTokens(value)),
  );
  const extra: string[] = [];
  for (const value of values) {
    for (const token of getSearchTokens(value ?? "")) {
      if (seen.has(token)) continue;
      seen.add(token);
      extra.push(token);
    }
  }
  return extra.join(" ");
}

export function buildSearchIndex(races: RaceSummary[]): SearchIndex {
  return {
    v: SEARCH_INDEX_VERSION,
    races: races.map((race) => {
      const code = raceShortLabel(race) ?? "";
      const title = raceDisplayTitle(race);
      const subtitle = [officeDisplayName(race.office), race.state]
        .filter(Boolean)
        .join(" · ");
      return {
        i: race.id,
        t: title,
        s: subtitle,
        c: code,
        o: officeKind(race.office),
        // The code is indexed as words too ("tx 10"), so "TX-10" matches.
        w: extraWords(
          [title, subtitle],
          race.title,
          race.office,
          race.state,
          race.jurisdiction,
          code,
        ),
        p: (race.candidates ?? []).map((candidate) =>
          candidate.party
            ? ([candidate.name, candidate.party] as [string, string])
            : ([candidate.name] as [string]),
        ),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

const YEAR_TOKEN = /^(19|20)\d\d$/;
const STATE_ENTRIES = Object.entries(STATE_NAMES_BY_CODE).map(
  ([code, name]) => ({ code, words: normalizeSearchText(name).split(" ") }),
);

export interface ParsedSearchQuery {
  /** Query words with election years removed ("2026" is on every race). */
  terms: string[];
  /** Two-letter code when the query names a state ("texas", "TX", "new york"). */
  state: string | null;
  /** House district number when the query is a district ("TX-10", "nebraska 2"). */
  district: number | null;
  /** Words left after the state and district. */
  rest: string[];
}

function leadingState(terms: string[]): { code: string; used: number } | null {
  let best: { code: string; used: number } | null = null;
  for (const { code, words } of STATE_ENTRIES) {
    if (
      words.length <= terms.length &&
      words.every((word, index) => terms[index] === word) &&
      (!best || words.length > best.used)
    ) {
      best = { code, used: words.length };
    }
  }
  if (!best && terms[0] && STATE_NAMES_BY_CODE[terms[0]]) {
    best = { code: terms[0], used: 1 };
  }
  return best;
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  let terms = getSearchTokens(query).filter((term) => !YEAR_TOKEN.test(term));
  // "tx10" -> "tx 10"
  terms = terms.flatMap((term) => {
    const glued = term.match(/^([a-z]{2})(\d{1,2})$/);
    return glued && STATE_NAMES_BY_CODE[glued[1]]
      ? [glued[1], glued[2]]
      : [term];
  });
  const state = leadingState(terms);
  let rest = state ? terms.slice(state.used) : terms;
  let district: number | null = null;
  if (state && rest.length >= 1) {
    const last = rest[rest.length - 1];
    const words = rest.join(" ");
    if (/^\d{1,2}(st|nd|rd|th)?$/.test(last) && rest.length <= 2) {
      // "tx 10", "texas district 10", "nebraska 2nd"
      if (rest.length === 1 || /^(district|cd|house)$/.test(rest[0])) {
        district = Number(last.replace(/\D/g, ""));
        rest = [];
      }
    } else if (/^(al|at large)$/.test(words)) {
      district = 0;
      rest = [];
    }
  }
  return { terms, state: state?.code ?? null, district, rest };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface PreparedSearchRace {
  entry: SearchIndexRace;
  doc: SearchDoc;
  state: string | null;
  district: number | null;
  candidates: Array<{
    name: string;
    party?: string;
    nameDoc: SearchDoc;
    doc: SearchDoc;
  }>;
}

export function prepareSearchIndex(index: SearchIndex): PreparedSearchRace[] {
  return index.races.map((entry) => {
    const [stateCode, districtCode] = entry.c.toLowerCase().split("-");
    const doc = prepareSearchDoc(entry.t, entry.s, entry.w);
    return {
      entry,
      doc,
      state: stateCode && STATE_NAMES_BY_CODE[stateCode] ? stateCode : null,
      district:
        districtCode === "al" ? 0 : districtCode ? Number(districtCode) : null,
      candidates: entry.p.map(([name, party]) => ({
        name,
        party,
        nameDoc: prepareSearchDoc(name),
        doc: prepareSearchDoc(name, party, entry.t, entry.s, entry.w),
      })),
    };
  });
}

/** How well one term matches a doc: 3 exact word, 2 word prefix, 1 substring. */
function termQuality(term: string, doc: SearchDoc): number {
  if (doc.tokens.includes(term)) return 3;
  if (/^\d+$/.test(term)) return 0;
  if (doc.tokens.some((token) => token.startsWith(term))) return 2;
  if (term.length >= 3 && doc.text.includes(term)) return 1;
  return 0;
}

export interface SearchResults {
  races: SearchIndexRace[];
  candidates: Array<{
    name: string;
    party?: string;
    raceId: string;
    raceTitle: string;
  }>;
  /** Distinct races matched by either list (what the directory would show). */
  totalRaces: number;
}

export function searchIndex(
  prepared: PreparedSearchRace[],
  query: string,
  limit = 5,
): SearchResults {
  const parsed = parseSearchQuery(query);
  const { terms } = parsed;
  if (terms.length === 0) return { races: [], candidates: [], totalRaces: 0 };

  const raceHits: Array<{ entry: SearchIndexRace; score: number }> = [];
  const candidateHits: Array<{
    result: SearchResults["candidates"][number];
    score: number;
  }> = [];
  const matchedRaceIds = new Set<string>();

  for (const race of prepared) {
    const inState = parsed.state !== null && race.state === parsed.state;
    let score = 0;
    if (parsed.state && parsed.district !== null) {
      // A district code ("TX-10", "nebraska 2"): exactly that seat.
      if (inState && race.district === parsed.district) score = 1000;
    } else if (parsed.state && parsed.rest.length === 0) {
      // A state on its own: statewide races first, then House seats in order.
      if (inState) {
        score =
          race.entry.o === "S" || race.entry.o === "G"
            ? 600
            : 300 - (race.district ?? 0) * 0.01;
      }
    } else if (matchesSearchDoc(terms, race.doc)) {
      score =
        100 +
        (inState ? 200 : 0) +
        terms.reduce((sum, term) => sum + termQuality(term, race.doc), 0);
    }
    if (score > 0) {
      raceHits.push({ entry: race.entry, score });
      matchedRaceIds.add(race.entry.i);
    }

    for (const candidate of race.candidates) {
      // A candidate is a hit when the query names them; "Texas" alone should
      // not list every candidate running in Texas.
      const nameScores = terms.map((term) =>
        termQuality(term, candidate.nameDoc),
      );
      if (!nameScores.some((value) => value >= 2)) continue;
      if (!matchesSearchDoc(terms, candidate.doc)) continue;
      const allName = nameScores.every((value) => value >= 2);
      const firstNamePrefix = candidate.nameDoc.tokens[0]?.startsWith(terms[0]);
      candidateHits.push({
        result: {
          name: candidate.name,
          party: candidate.party,
          raceId: race.entry.i,
          raceTitle: race.entry.t,
        },
        score:
          100 +
          (allName ? 100 : 0) +
          (firstNamePrefix ? 20 : 0) +
          nameScores.reduce((sum, value) => sum + value, 0) * 10,
      });
      matchedRaceIds.add(race.entry.i);
    }
  }

  // Stable sorts keep catalog order among equal scores.
  raceHits.sort((a, b) => b.score - a.score);
  candidateHits.sort((a, b) => b.score - a.score);
  return {
    races: raceHits.slice(0, limit).map((hit) => hit.entry),
    candidates: candidateHits.slice(0, limit).map((hit) => hit.result),
    totalRaces: matchedRaceIds.size,
  };
}
