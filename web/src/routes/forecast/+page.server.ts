import type { PageServerLoad } from "./$types";
import {
  loadPrerenderChamberForecasts,
  loadPrerenderedRaces,
} from "$lib/prerenderData";
import type { ChamberForecasts } from "$lib/types";
import { toForecastRaceSummaries } from "$lib/utils/publicRaceSummaries";

export const prerender = true;

// Runs at build time; SvelteKit serializes the result into the prerendered
// HTML so hydration never depends on a second network request.
export const load: PageServerLoad = async ({ fetch }) => {
  const [races, chamberForecasts] = await Promise.all([
    loadPrerenderedRaces(toForecastRaceSummaries, fetch),
    loadPrerenderChamberForecasts(fetch).catch((error) => {
      console.warn("Could not load chamber forecasts for prerender:", error);
      return null as ChamberForecasts | null;
    }),
  ]);
  return {
    ...races,
    chamberForecasts,
    forecastsLoadError: chamberForecasts === null,
  };
};
