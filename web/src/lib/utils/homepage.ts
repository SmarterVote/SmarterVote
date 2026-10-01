import type { RaceSummary } from "$lib/types";
import { toDirectoryRaceSummaries } from "./publicRaceSummaries";

// Editorial order for the homepage. Keep this list explicit so publishing or
// refreshing another race does not unexpectedly change the featured section.
export const featuredHomepageRaceIds = [
  "tx-senate-2026",
  "me-senate-2026",
  "nv-governor-2026",
  "co-house-08-2026",
  "ia-senate-2026",
] as const;

export function nationalElectionRaces(races: RaceSummary[]): RaceSummary[] {
  return races.filter((race) => {
    const office = race.office?.toLocaleLowerCase() ?? "";
    return (
      office.includes("united states") ||
      office.includes("u.s.") ||
      office.includes("president") ||
      office.includes("governor") ||
      office.includes("gubernatorial")
    );
  });
}

/** National races trimmed to the fields the directory and ballot pages use. */
export function directoryRaces(races: RaceSummary[]): RaceSummary[] {
  return toDirectoryRaceSummaries(nationalElectionRaces(races));
}
