import { browser } from "$app/environment";
import type { PageLoad } from "./$types";
import { refreshPrerenderedRaces } from "$lib/prerenderData";
import { directoryRaces } from "$lib/utils/homepage";

export const load: PageLoad = async ({ data, fetch }) => {
  // Production serves summaries.json from the same build as this page, so a
  // browser refetch would block hydration to re-download identical data (2 MB+).
  // Only refresh when the build had nothing (local dev, CI fixtures).
  if (!browser || data.races.length > 0) return data;
  return refreshPrerenderedRaces(data, directoryRaces, fetch);
};
