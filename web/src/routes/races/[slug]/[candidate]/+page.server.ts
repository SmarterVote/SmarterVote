import type { EntryGenerator, PageServerLoad } from "./$types";
import { candidateEntries, loadPrerenderRace } from "$lib/prerenderData";
import { candidatePagePayload } from "$lib/utils/racePage";

export const prerender = true;

export const entries: EntryGenerator = async () => candidateEntries();

// Build-time only, and read straight from the published file rather than a
// module-level cache: a cached promise skipped SvelteKit's fetch during
// prerender, so the page shipped without data and blocked hydration on a
// browser fetch. Only this candidate is embedded in full.
export const load: PageServerLoad = async ({ params, fetch }) => {
  try {
    const race = await loadPrerenderRace(params.slug, fetch);
    return { prerenderedRace: candidatePagePayload(race, params.candidate) };
  } catch (error) {
    console.error(
      `Failed to load prerendered race ${params.slug} for candidate:`,
      error,
    );
    return { prerenderedRace: null };
  }
};
