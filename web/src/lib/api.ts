/**
 * Public race-data fetchers.
 *
 * This module is imported by public pages (SiteHeader, race pages, ballot
 * explorer), so it must stay free of static auth imports: anything that pulls
 * `$lib/auth` / `@auth0/auth0-spa-js` here would be modulepreloaded on every
 * public page. Authenticated helpers load the auth stack lazily via
 * `await import()`, and the sample-data fallback (dev only) is lazy too.
 */
import type { Race, RaceSummary } from "./types";
import { logger } from "./utils/logger";
import { publicDataBase, racesApiBase } from "$lib/config/api";
import { fetchPublishedRaceSummaries } from "./prerenderData";

const USE_SAMPLE_FALLBACK = import.meta.env.DEV;

async function loadSampleRaces(): Promise<Record<string, Race>> {
  const { sampleRaces } = await import("./sampleData");
  return sampleRaces;
}

async function fetchPublicJson<T>(
  staticPath: string,
  fetchFn: typeof fetch,
): Promise<T> {
  const dataBase = publicDataBase() || "";
  const url = dataBase ? `${dataBase}/${staticPath}` : `/${staticPath}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Static data request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function getRace(
  id: string,
  fetchFn: typeof fetch = fetch,
  useFallback: boolean = USE_SAMPLE_FALLBACK,
): Promise<Race> {
  try {
    return await fetchPublicJson<Race>(
      `${encodeURIComponent(id)}.json`,
      fetchFn,
    );
  } catch (error) {
    // If fallback is enabled and we have sample data for this race, use it
    if (useFallback) {
      const sampleRaces = await loadSampleRaces();
      if (sampleRaces[id]) {
        logger.warn(
          `API request failed for race ${id}, falling back to sample data:`,
          error,
        );
        return sampleRaces[id];
      }
    }

    // Unknown race IDs must fail explicitly. Showing an unrelated generic race
    // under a real slug is misleading and can be mistaken for published data.
    throw error;
  }
}

export async function getRaceSummaries(
  fetchFn: typeof fetch = fetch,
  useFallback: boolean = USE_SAMPLE_FALLBACK,
): Promise<RaceSummary[]> {
  try {
    // Share the one cached request with the pages (elections, home, forecast)
    // that load the same ~2 MB catalog, instead of downloading it again for
    // the header search.
    return await fetchPublishedRaceSummaries(fetchFn);
  } catch (error) {
    // If fallback is enabled, create summaries from sample races
    if (useFallback) {
      logger.warn(
        `API request failed for race summaries, falling back to sample data:`,
        error,
      );
      const sampleRaces = await loadSampleRaces();
      return Object.values(sampleRaces).map((race) => ({
        id: race.id,
        title: race.title,
        office: race.office,
        jurisdiction: race.jurisdiction,
        state: race.state,
        election_date: race.election_date,
        updated_utc: race.updated_utc,
        candidates: race.candidates.map((candidate) => ({
          name: candidate.name,
          party: candidate.party,
          incumbent: candidate.incumbent,
          image_url: candidate.image_url,
        })),
      }));
    }

    // Re-throw the error if fallback is disabled
    throw error;
  }
}

/**
 * Fetch draft race data from the races-api backend (admin-only, requires auth).
 * Used for admin preview of un-published races via ?draft=true query param.
 * The auth stack is imported lazily so public pages never preload Auth0.
 */
export async function getDraftRace(id: string): Promise<Race> {
  const { fetchWithAuth } = await import("$lib/stores/apiStore");
  const res = await fetchWithAuth(
    `${racesApiBase()}/api/races/${encodeURIComponent(id)}/data?draft=true`,
    {},
    15000,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch draft race: ${res.status}`);
  }
  return (await res.json()) as Race;
}
