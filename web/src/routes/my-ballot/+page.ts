import { browser } from "$app/environment";
import type { PageLoad } from "./$types";
import { refreshPrerenderedRaces } from "$lib/prerenderData";
import { directoryRaces } from "$lib/utils/homepage";

export const load: PageLoad = async ({ data, fetch }) => {
  if (!browser) return data;
  return refreshPrerenderedRaces(data, directoryRaces, fetch);
};
