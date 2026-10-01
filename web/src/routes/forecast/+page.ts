import { browser } from "$app/environment";
import type { PageLoad } from "./$types";
import {
  loadPrerenderChamberForecasts,
  refreshPrerenderedRaces,
} from "$lib/prerenderData";
import { toForecastRaceSummaries } from "$lib/utils/publicRaceSummaries";

export const load: PageLoad = async ({ data, fetch }) => {
  // Prerendering already has the build-time data. In the browser, pick up a
  // fresher copy when one is available, but never replace good prerendered
  // content with an empty or failed refresh.
  if (!browser) return data;
  const [races, chamberForecasts] = await Promise.all([
    refreshPrerenderedRaces(data, toForecastRaceSummaries, fetch),
    loadPrerenderChamberForecasts(fetch).catch(() => null),
  ]);
  return {
    ...data,
    ...races,
    chamberForecasts: chamberForecasts ?? data.chamberForecasts,
    forecastsLoadError: chamberForecasts ? false : data.forecastsLoadError,
  };
};
