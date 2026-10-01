import { describe, expect, it } from "vitest";
import {
  districtFromRace,
  matchingNationalRaces,
  normalizeDistrictCode,
  parseCensusGeography,
} from "./electionLookup";
import type { RaceSummary } from "$lib/types";

const race = (overrides: Partial<RaceSummary>): RaceSummary => ({
  id: "race",
  title: "Race",
  office: "United States Senate",
  jurisdiction: "Maryland",
  state: "Maryland",
  election_date: "2026-11-03",
  updated_utc: "2026-07-01T00:00:00Z",
  candidates: [],
  ...overrides,
});

// Live Census shape (Oct 2026): the district field is CD120, and at-large
// states carry the text "Congressional District (at Large)" in BASENAME.
function censusResponse(state: string, entry: Record<string, unknown>) {
  return {
    result: {
      addressMatches: [
        {
          geographies: {
            States: [{ NAME: state }],
            "120th Congressional Districts": [entry],
          },
        },
      ],
    },
  };
}

describe("parseCensusGeography with newer Congress vintages", () => {
  it("reads CD120 for an at-large state instead of the BASENAME text", () => {
    expect(
      parseCensusGeography(
        censusResponse("Alaska", {
          BASENAME: "Congressional District (at Large)",
          GEOID: "0200",
          CD120: "00",
        }),
      ),
    ).toEqual({ state: "Alaska", congressionalDistrict: "00" });
  });

  it("reads CD120 for numbered districts", () => {
    expect(
      parseCensusGeography(
        censusResponse("Texas", { BASENAME: "10", GEOID: "4810", CD120: "10" }),
      ),
    ).toEqual({ state: "Texas", congressionalDistrict: "10" });
  });

  it("falls back to GEOID, then to the at-large text", () => {
    expect(
      parseCensusGeography(censusResponse("Ohio", { GEOID: "3907" })),
    ).toEqual({ state: "Ohio", congressionalDistrict: "07" });
    expect(
      parseCensusGeography(
        censusResponse("Wyoming", {
          BASENAME: "Congressional District (at Large)",
        }),
      ),
    ).toEqual({ state: "Wyoming", congressionalDistrict: "00" });
  });

  it("maps the D.C. delegate code 98 to the at-large seat", () => {
    expect(
      parseCensusGeography(
        censusResponse("District of Columbia", { GEOID: "1198", CD120: "98" }),
      )?.congressionalDistrict,
    ).toBe("00");
  });
});

describe("normalizeDistrictCode", () => {
  it.each([
    ["8", "08"],
    ["08", "08"],
    ["98", "00"],
    ["al", "00"],
    ["at-large", "00"],
    ["Congressional District (at Large)", "00"],
    ["NaN", null],
    ["2026", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDistrictCode(input)).toBe(expected);
  });
});

describe("parseCensusGeography", () => {
  it("extracts the state and current congressional district", () => {
    expect(
      parseCensusGeography({
        result: {
          addressMatches: [
            {
              geographies: {
                States: [{ NAME: "Maryland" }],
                "119th Congressional Districts": [{ CD119: "04" }],
              },
            },
          ],
        },
      }),
    ).toEqual({ state: "Maryland", congressionalDistrict: "04" });
  });

  it("returns null for an unmatched address", () => {
    expect(parseCensusGeography({ result: { addressMatches: [] } })).toBeNull();
  });

  it("normalizes Census delegate district 98 to at-large", () => {
    expect(
      parseCensusGeography({
        result: {
          addressMatches: [
            {
              geographies: {
                States: [{ NAME: "District of Columbia" }],
                "119th Congressional Districts": [{ CD119: "98" }],
              },
            },
          ],
        },
      }),
    ).toEqual({
      state: "District of Columbia",
      congressionalDistrict: "00",
    });
  });
});

describe("matchingNationalRaces", () => {
  it("returns the matching House district and statewide Senate race", () => {
    const races = [
      race({ id: "senate" }),
      race({ id: "governor", office: "Governor of Maryland" }),
      race({
        id: "house-4",
        office: "U.S. House of Representatives",
        jurisdiction: "Maryland's 4th Congressional District",
      }),
      race({
        id: "house-5",
        office: "U.S. House of Representatives",
        jurisdiction: "Maryland's 5th Congressional District",
      }),
      race({ id: "virginia", state: "Virginia", jurisdiction: "Virginia" }),
    ];

    expect(
      matchingNationalRaces(
        races,
        { state: "Maryland", congressionalDistrict: "04" },
        new Date("2026-07-12"),
      ).map(({ id }) => id),
    ).toEqual(["senate", "governor", "house-4"]);
  });

  it("accepts a postal code or any-case state name from a shared link", () => {
    const races = [
      race({
        id: "ak-house-2026",
        office: "U.S. House of Representatives",
        state: "Alaska",
        jurisdiction: "Alaska's At-Large Congressional District",
      }),
    ];
    for (const state of ["AK", "ak", "alaska", "ALASKA"]) {
      expect(
        matchingNationalRaces(
          races,
          { state, congressionalDistrict: "00" },
          new Date("2026-07-12"),
        ).map(({ id }) => id),
      ).toEqual(["ak-house-2026"]);
    }
  });

  it("matches at-large House races and excludes past elections", () => {
    const races = [
      race({
        id: "at-large",
        office: "U.S. House of Representatives",
        state: "Alaska",
        jurisdiction: "Alaska's At-Large Congressional District",
      }),
      race({
        id: "past",
        state: "Alaska",
        jurisdiction: "Alaska",
        election_date: "2024-11-05",
      }),
    ];

    expect(
      matchingNationalRaces(
        races,
        { state: "Alaska", congressionalDistrict: "00" },
        new Date("2026-07-12"),
      ).map(({ id }) => id),
    ).toEqual(["at-large"]);
  });

  it("does not confuse Virginia with West Virginia", () => {
    const races = [
      race({
        id: "virginia-senate",
        state: "Virginia",
        jurisdiction: "Virginia",
      }),
      race({
        id: "west-virginia-senate",
        state: "West Virginia",
        jurisdiction: "West Virginia",
      }),
    ];

    expect(
      matchingNationalRaces(races, {
        state: "Virginia",
        congressionalDistrict: "01",
      }).map(({ id }) => id),
    ).toEqual(["virginia-senate"]);
  });

  it("keeps a race listed through Election Day evening in US Eastern time", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const races = [race({ id: "senate", election_date: "2026-11-03" })];
      const geography = { state: "Maryland", congressionalDistrict: "04" };
      // 8:30pm ET on Nov 2 is already Nov 3 in UTC.
      expect(
        matchingNationalRaces(
          races,
          geography,
          new Date("2026-11-03T00:30:00Z"),
        ),
      ).toHaveLength(1);
      // 9pm ET on Election Day itself (Nov 4, 01:00 UTC).
      expect(
        matchingNationalRaces(
          races,
          geography,
          new Date("2026-11-04T01:00:00Z"),
        ),
      ).toHaveLength(1);
      // The following local day the race is past.
      expect(
        matchingNationalRaces(
          races,
          geography,
          new Date("2026-11-04T15:00:00Z"),
        ),
      ).toHaveLength(0);
    } finally {
      process.env.TZ = previous;
    }
  });

  it("matches abbreviated, lowercase, and district-label state values", () => {
    const races = [
      race({ id: "tx-senate-2026", state: "TX", jurisdiction: "TX" }),
      race({
        id: "governor",
        office: "Governor",
        state: "texas",
        jurisdiction: "",
      }),
      race({
        id: "tx-house-08-2026",
        office: "U.S. House",
        state: "Texas's 8th Congressional District",
        jurisdiction: "TX-8",
      }),
      race({ id: "ok-senate-2026", state: "OK", jurisdiction: "Oklahoma" }),
    ];
    expect(
      matchingNationalRaces(
        races,
        { state: "Texas", congressionalDistrict: "08" },
        new Date("2026-07-12"),
      ).map(({ id }) => id),
    ).toEqual(["tx-senate-2026", "governor", "tx-house-08-2026"]);
  });
});

describe("districtFromRace", () => {
  it("prefers the race id district", () => {
    expect(districtFromRace(race({ id: "tx-house-8-2026" }))).toBe("08");
    expect(districtFromRace(race({ id: "tx-house-08-2026" }))).toBe("08");
    expect(districtFromRace(race({ id: "ak-house-al-2026" }))).toBe("00");
    expect(districtFromRace(race({ id: "az-01-house-2026" }))).toBe("01");
  });

  // Regression: the year in at-large ids was read as district "2026", so every
  // at-large state's House race silently vanished from My Ballot.
  it("treats a House id with no district as the at-large seat", () => {
    for (const id of [
      "ak-house-2026",
      "de-house-2026",
      "nd-house-2026",
      "sd-house-2026",
      "vt-house-2026",
      "wy-house-2026",
    ]) {
      expect(districtFromRace(race({ id }))).toBe("00");
    }
  });

  it("parses common title and jurisdiction forms", () => {
    expect(
      districtFromRace(race({ title: "Texas District 8 House Race" })),
    ).toBe("08");
    expect(districtFromRace(race({ jurisdiction: "CD-12" }))).toBe("12");
    expect(districtFromRace(race({ jurisdiction: "TX-8" }))).toBe("08");
    expect(districtFromRace(race({ jurisdiction: "Wyoming at-large" }))).toBe(
      "00",
    );
    expect(
      districtFromRace(
        race({ jurisdiction: "Ohio's 13th Congressional District" }),
      ),
    ).toBe("13");
    expect(
      districtFromRace(race({ title: "Race", jurisdiction: "Ohio" })),
    ).toBeNull();
  });
});
