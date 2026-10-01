import type { Race } from "$lib/types";

export const isHomepagePreviewRace = (race: Race) =>
  race.validation_grade?.passed === true && race.validation_grade.score >= 85;

export const mergeHomepagePreviewRaces = (
  verified: Race[],
  limit = 5,
): Race[] => {
  const seen = new Set<string>();
  return verified
    .filter((race) => {
      if (seen.has(race.id)) return false;
      seen.add(race.id);
      return true;
    })
    .slice(0, limit);
};
