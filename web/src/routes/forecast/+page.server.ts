import type { PageServerLoad } from "./$types";
import {
  loadPrerenderChamberForecasts,
  loadPrerenderedRaces,
} from "$lib/prerenderData";
import type { ChamberForecasts } from "$lib/types";
import { fetchLiveForecastSnapshot } from "$lib/utils/liveForecast";
import { toForecastRaceSummaries } from "$lib/utils/publicRaceSummaries";
import { isResultsSeason } from "$lib/utils/results";

export const prerender = true;

// Runs at build time; SvelteKit serializes the result into the prerendered
// HTML so hydration never depends on a second network request.
export const load: PageServerLoad = async ({ fetch }) => {
  const [races, chamberForecasts, liveForecastSnapshot] = await Promise.all([
    loadPrerenderedRaces(toForecastRaceSummaries, fetch),
    loadPrerenderChamberForecasts(fetch).catch((error) => {
      console.warn("Could not load chamber forecasts for prerender:", error);
      return null as ChamberForecasts | null;
    }),
    // From Election Day on, bake the live projection into the page so it is
    // in place on first paint; the browser then refreshes it each minute.
    isResultsSeason() ? fetchLiveForecastSnapshot(fetch) : null,
  ]);
  return {
    ...races,
    chamberForecasts,
    forecastsLoadError: chamberForecasts === null,
    liveForecastSnapshot,
  };
};
