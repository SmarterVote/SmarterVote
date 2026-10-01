/**
 * Canned races-api Census proxy responses (`POST /geocode/census`) for the
 * `my-ballot` address lookup flow. Matches the shape
 * `parseCensusProxyResponse` (src/lib/services/electionLookup.ts) expects,
 * resolving to Ohio's 5th Congressional District so it lines up with the
 * `e2e-oh-house-05-2026` and `e2e-oh-senate-2026` fixture races.
 */
export const OHIO_DISTRICT_05_CENSUS_RESPONSE = {
  state: "Ohio",
  congressional_district: { CD120: "05", GEOID: "3905", BASENAME: "5" },
};

/**
 * Resolves to a state/district with no fixture races, so my-ballot's
 * "we found your district but nothing published yet" empty state can be
 * exercised deterministically.
 */
export const NO_RACES_CENSUS_RESPONSE = {
  state: "California",
  congressional_district: { CD120: "12", GEOID: "0612", BASENAME: "12" },
};
