import type { EntryGenerator, PageServerLoad } from "./$types";
import { loadPrerenderRace, raceEntries } from "$lib/prerenderData";
import { comparePagePayload } from "$lib/utils/racePage";

export const prerender = true;

export const entries: EntryGenerator = async () => raceEntries();

// Build-time only (see the candidate page): embeds just what the comparison
// shows, so hydration never waits on a fetch.
export const load: PageServerLoad = async ({ params, fetch }) => {
  try {
    return {
      prerenderedRace: comparePagePayload(
        await loadPrerenderRace(params.slug, fetch),
      ),
    };
  } catch (error) {
    console.error(
      `Failed to load prerendered race ${params.slug} for compare:`,
      error,
    );
    return { prerenderedRace: null };
  }
};
