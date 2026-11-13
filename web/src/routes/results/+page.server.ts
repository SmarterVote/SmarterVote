import type { PageServerLoad } from "./$types";
import { loadPrerenderSummaries } from "$lib/prerenderData";
import { resultDirectory, type ResultDirectoryRace } from "$lib/utils/results";

export const prerender = true;

// Runs at build time, so the page lists every race on the ballot before any
// result exists; live results then fill each row in.
export const load: PageServerLoad = async ({
  fetch,
}): Promise<{ races: ResultDirectoryRace[] }> => {
  try {
    return { races: resultDirectory(await loadPrerenderSummaries(fetch)) };
  } catch (error) {
    console.warn("Could not load race summaries for the results page:", error);
    return { races: [] };
  }
};
