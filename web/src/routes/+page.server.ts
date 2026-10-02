import type { PageServerLoad } from "./$types";
import {
  isHomepagePreviewRace,
  mergeHomepagePreviewRaces,
} from "$lib/homepagePreview";
import { loadPrerenderRace } from "$lib/prerenderData";
import type { Race } from "$lib/types";
import {
  featuredHomepageRaceIds,
  toFeaturedComparisonRace,
} from "$lib/utils/homepage";

export const prerender = true;

// Build-time only: the featured comparisons are serialized into the
// prerendered HTML, so hydration does not refetch five full race files and a
// client-side network failure can never blank the hero. Each race is projected
// to the fields the comparison renders (toFeaturedComparisonRace).
export const load: PageServerLoad = async ({ fetch }) => {
  // Production syncs these published race files into static/ before
  // prerendering. Missing or unvalidated races are skipped without changing
  // the editorial order.
  const published = await Promise.allSettled(
    featuredHomepageRaceIds.map((id) => loadPrerenderRace(id, fetch)),
  );
  return {
    gradeARaces: mergeHomepagePreviewRaces(
      published
        .filter(
          (result): result is PromiseFulfilledResult<Race> =>
            result.status === "fulfilled" &&
            isHomepagePreviewRace(result.value),
        )
        .map((result) => result.value),
    ).map(toFeaturedComparisonRace),
  };
};
