import { candidateSlug, legacyCandidateSlug } from "$lib/utils/format";
import type { ChamberForecasts, Race, RaceSummary } from "$lib/types";
import { publicDataBase as configuredPublicDataBase } from "$lib/config/api";

let summariesCache: Promise<RaceSummary[]> | null = null;
const raceCache = new Map<string, Promise<Race>>();

function publicDataBase(): string | undefined {
  return configuredPublicDataBase();
}

function shouldPrerenderDynamicRoutes(): boolean {
  return (
    import.meta.env.MODE === "crawl" ||
    import.meta.env.VITE_PRERENDER_RACES === "true"
  );
}

export async function fetchPublishedRaceSummaries(
  fetchFn: typeof fetch = fetch,
): Promise<RaceSummary[]> {
  if (summariesCache) return summariesCache;

  const request = (async () => {
    const staticBase = publicDataBase() || "";
    const url = staticBase ? `${staticBase}/summaries.json` : `/summaries.json`;
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch race summaries: ${res.status}`);
    }
    return (await res.json()) as RaceSummary[];
  })();
  summariesCache = request;

  try {
    return await request;
  } catch (error) {
    if (summariesCache === request) summariesCache = null;
    throw error;
  }
}

export async function fetchPublishedRace(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<Race> {
  const cached = raceCache.get(id);
  if (cached) return cached;

  const racePromise = (async () => {
    const staticBase = publicDataBase() || "";
    const url = staticBase
      ? `${staticBase}/${encodeURIComponent(id)}.json`
      : `/${encodeURIComponent(id)}.json`;
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch race ${id}: ${res.status}`);
    }
    return (await res.json()) as Race;
  })();
  raceCache.set(id, racePromise);
  try {
    return await racePromise;
  } catch (error) {
    if (raceCache.get(id) === racePromise) raceCache.delete(id);
    throw error;
  }
}

export async function loadPrerenderRace(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<Race> {
  if (import.meta.env.SSR) {
    try {
      const [{ readFile }, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      const data = await readFile(
        path.resolve("static", `${encodeURIComponent(id)}.json`),
        { encoding: "utf-8" },
      );
      return JSON.parse(data) as Race;
    } catch (error) {
      if (!publicDataBase()) throw error;
    }
  }
  return fetchPublishedRace(id, fetchFn);
}

export async function raceEntries(): Promise<Array<{ slug: string }>> {
  if (!shouldPrerenderDynamicRoutes()) return [];
  const summaries = await loadPrerenderSummaries().catch((error) => {
    console.warn("Skipping race prerender entries:", error);
    return [];
  });
  return summaries.map((race) => ({ slug: race.id }));
}

export async function candidateEntries(): Promise<
  Array<{ slug: string; candidate: string }>
> {
  if (!shouldPrerenderDynamicRoutes()) return [];
  const summaries = await loadPrerenderSummaries().catch((error) => {
    console.warn("Skipping candidate prerender entries:", error);
    return [];
  });
  const entries: Array<{ slug: string; candidate: string }> = [];
  for (const race of summaries) {
    for (const candidate of race.candidates ?? []) {
      const slug = candidateSlug(candidate.name);
      entries.push({ slug: race.id, candidate: slug });
      // Keep pre-accent-folding URLs ("linda-s-nchez") resolving; that page
      // canonicalises and redirects to the folded slug.
      const legacy = legacyCandidateSlug(candidate.name);
      if (legacy && legacy !== slug)
        entries.push({ slug: race.id, candidate: legacy });
    }
  }
  return entries;
}

export async function loadPrerenderSummaries(
  fetchFn: typeof fetch = fetch,
): Promise<RaceSummary[]> {
  if (import.meta.env.SSR) {
    try {
      const [{ readFile }, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      const data = await readFile(path.resolve("static", "summaries.json"), {
        encoding: "utf-8",
      });
      return JSON.parse(data) as RaceSummary[];
    } catch (error) {
      if (!publicDataBase()) throw error;
    }
  }
  return fetchPublishedRaceSummaries(fetchFn);
}

export async function loadPrerenderChamberForecasts(
  fetchFn: typeof fetch = fetch,
): Promise<ChamberForecasts> {
  if (import.meta.env.SSR) {
    try {
      const [{ readFile }, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      const data = await readFile(
        path.resolve("static", "chamber_forecasts.json"),
        { encoding: "utf-8" },
      );
      return JSON.parse(data) as ChamberForecasts;
    } catch (error) {
      if (!publicDataBase()) throw error;
    }
  }

  const staticBase = publicDataBase() || "";
  const url = staticBase
    ? `${staticBase}/chamber_forecasts.json`
    : "/chamber_forecasts.json";
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch chamber forecasts: ${response.status}`);
  }
  return (await response.json()) as ChamberForecasts;
}

/**
 * Result of a build-time (prerender) data load. `loadError` is true when the
 * data could not be read at all, which pages show as an error state rather
 * than as an honest-looking "nothing published yet".
 */
export interface PrerenderedRaces {
  races: RaceSummary[];
  loadError: boolean;
}

/** Build-time read of the published summaries, transformed for one page. */
export async function loadPrerenderedRaces(
  transform: (races: RaceSummary[]) => RaceSummary[],
  fetchFn: typeof fetch = fetch,
): Promise<PrerenderedRaces> {
  try {
    return {
      races: transform(await loadPrerenderSummaries(fetchFn)),
      loadError: false,
    };
  } catch (error) {
    console.warn("Could not load race summaries for prerender:", error);
    return { races: [], loadError: true };
  }
}

/**
 * Client-side refresh of prerendered race data.
 *
 * The prerendered HTML already carries the build-time races (serialized from
 * the page's server load), so the page never has to refetch to render. When a
 * fresher copy is available it replaces them, but a failed or empty refresh
 * never wipes good prerendered content: it keeps what was rendered.
 */
export async function refreshPrerenderedRaces(
  prerendered: PrerenderedRaces,
  transform: (races: RaceSummary[]) => RaceSummary[],
  fetchFn: typeof fetch = fetch,
): Promise<PrerenderedRaces> {
  try {
    const fresh = transform(await fetchPublishedRaceSummaries(fetchFn));
    if (fresh.length === 0 && prerendered.races.length > 0) return prerendered;
    return { races: fresh, loadError: false };
  } catch {
    return prerendered;
  }
}
