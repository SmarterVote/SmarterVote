import type { EntryGenerator, PageServerLoad } from "./$types";
import { loadPrerenderRace, raceEntries } from "$lib/prerenderData";
import { raceDetailPayload } from "$lib/utils/racePage";

export const prerender = true;

export const entries: EntryGenerator = async () => raceEntries();

// Build-time only: the race is serialized into the prerendered page, so the
// browser never refetches it to render (it still fetches drafts, and refetches
// when this returns null).
export const load: PageServerLoad = async ({ params, fetch }) => {
  try {
    return {
      prerenderedRace: raceDetailPayload(
        await loadPrerenderRace(params.slug, fetch),
      ),
    };
  } catch (error) {
    console.error(`Failed to load prerendered race ${params.slug}:`, error);
    return { prerenderedRace: null };
  }
};
