import { parseElectionDate } from "./electionDate";

/**
 * The election cycle whose research is frozen. Pages for this cycle show the
 * archive notice; later cycles (2028 onward) do not.
 */
export const ARCHIVED_ELECTION_YEAR = 2026;

const RACE_ID_YEAR = /-(\d{4})$/;

/**
 * The election year a race belongs to: the year of its `election_date` when
 * that is a valid calendar date, otherwise the `-YYYY` suffix of its id.
 */
export function raceElectionYear(
  race:
    { id?: string | null; election_date?: string | null } | null | undefined,
): number | null {
  if (!race) return null;
  const date = parseElectionDate(race.election_date);
  if (date) return date.year;
  const fromId = RACE_ID_YEAR.exec(race.id ?? "");
  return fromId ? Number(fromId[1]) : null;
}

/** True when a year (number or "YYYY" string) is the archived cycle. */
export function isArchivedElectionYear(
  year: number | string | null | undefined,
): boolean {
  if (year === null || year === undefined || year === "") return false;
  return Number(year) === ARCHIVED_ELECTION_YEAR;
}
