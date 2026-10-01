import { browser } from "$app/environment";
import type { PageLoad } from "./$types";
import { refreshPrerenderedRaces } from "$lib/prerenderData";
import { directoryRaces } from "$lib/utils/homepage";

export const load: PageLoad = async ({ data, fetch }) => {
  // Prerendering (and SSR) already has the build-time data. In the browser,
  // pick up anything published since the build without ever blanking the
  // prerendered list if the refresh fails.
  if (!browser) return data;
  return refreshPrerenderedRaces(data, directoryRaces, fetch);
};
