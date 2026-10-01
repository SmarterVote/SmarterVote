import { browser } from "$app/environment";
import type { PageLoad } from "./$types";
import {
  loadPrerenderChamberForecasts,
  refreshPrerenderedRaces,
} from "$lib/prerenderData";
import { toForecastRaceSummaries } from "$lib/utils/publicRaceSummaries";

export const load: PageLoad = async ({ data, fetch }) => {
  // Production serves summaries.json from the same build as this page, so a
  // browser refetch would block hydration to re-download identical data (2 MB+).
  // Only refresh when the build had nothing (local dev, CI fixtures).
  if (!browser || data.races.length > 0) return data;
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
