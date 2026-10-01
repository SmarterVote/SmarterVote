import type { PageServerLoad } from "./$types";
import { loadPrerenderedRaces } from "$lib/prerenderData";
import { directoryRaces } from "$lib/utils/homepage";

export const prerender = true;

// Runs at build time; SvelteKit serializes the result into the prerendered
// HTML so hydration never depends on a second network request.
export const load: PageServerLoad = async ({ fetch }) =>
  loadPrerenderedRaces(directoryRaces, fetch);
