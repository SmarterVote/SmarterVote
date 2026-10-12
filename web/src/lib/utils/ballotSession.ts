/**
 * The voter's last address-matched ballot, kept in sessionStorage so race
 * guides can link back to it. Holds only the state, district, and matched
 * race ids — never the address.
 */
export interface SavedBallot {
  state: string;
  district: string;
  raceIds: string[];
}

export const BALLOT_SESSION_KEY = "smarterVote.ballot";

// sessionStorage can throw (privacy modes, blocked site data); the ballot
// must keep working without it.
export function readSavedBallot(): SavedBallot | null {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(BALLOT_SESSION_KEY) ?? "null",
    ) as Partial<SavedBallot> | null;
    if (!saved?.state || !saved.district || !Array.isArray(saved.raceIds))
      return null;
    return {
      state: saved.state,
      district: saved.district,
      raceIds: saved.raceIds,
    };
  } catch {
    return null;
  }
}

export function writeSavedBallot(ballot: SavedBallot) {
  try {
    sessionStorage.setItem(BALLOT_SESSION_KEY, JSON.stringify(ballot));
  } catch {
    // Ignore: restoring the ballot is a convenience.
  }
}

export function clearSavedBallot() {
  try {
    sessionStorage.removeItem(BALLOT_SESSION_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Link back to the voter's ballot with `raceId` selected, or null when this
 * race is not part of the ballot they looked up in this tab.
 */
export function ballotReturnHref(raceId: string): string | null {
  const saved = readSavedBallot();
  if (!saved || !saved.raceIds.includes(raceId)) return null;
  const params = new URLSearchParams({
    state: saved.state,
    district: saved.district,
    race: raceId,
  });
  return `/my-ballot/?${params.toString()}`;
}
