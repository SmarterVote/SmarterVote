import { describe, expect, it, vi } from "vitest";
import {
  districtFromRace,
  lookupElectionGeography,
  matchingNationalRaces,
  normalizeDistrictCode,
  parseCensusProxyResponse,
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

// Live Census shape (Oct 2026), as the races-api proxy passes it through: the
// district field is CD120, and at-large states carry the text
// "Congressional District (at Large)" in BASENAME.
function proxyResponse(state: string, entry: Record<string, unknown>) {
  return { state, congressional_district: entry };
}

describe("parseCensusProxyResponse with newer Congress vintages", () => {
  it("reads CD120 for an at-large state instead of the BASENAME text", () => {
    expect(
      parseCensusProxyResponse(
        proxyResponse("Alaska", {
          BASENAME: "Congressional District (at Large)",
          GEOID: "0200",
          CD120: "00",
        }),
      ),
    ).toEqual({ state: "Alaska", congressionalDistrict: "00" });
  });

  it("reads CD120 for numbered districts", () => {
    expect(
      parseCensusProxyResponse(
        proxyResponse("Texas", { BASENAME: "10", GEOID: "4810", CD120: "10" }),
      ),
    ).toEqual({ state: "Texas", congressionalDistrict: "10" });
  });

  it("still reads CD119", () => {
    expect(
      parseCensusProxyResponse(proxyResponse("Maryland", { CD119: "04" })),
    ).toEqual({ state: "Maryland", congressionalDistrict: "04" });
  });

  it("falls back to GEOID, then to the at-large text", () => {
    expect(
      parseCensusProxyResponse(proxyResponse("Ohio", { GEOID: "3907" })),
    ).toEqual({ state: "Ohio", congressionalDistrict: "07" });
    expect(
      parseCensusProxyResponse(
        proxyResponse("Wyoming", {
          BASENAME: "Congressional District (at Large)",
        }),
      ),
    ).toEqual({ state: "Wyoming", congressionalDistrict: "00" });
  });

  it("maps the D.C. delegate code 98 to the at-large seat", () => {
    expect(
      parseCensusProxyResponse(
        proxyResponse("District of Columbia", { GEOID: "1198", CD120: "98" }),
      )?.congressionalDistrict,
    ).toBe("00");
  });

  it("returns null without a state or a usable district", () => {
    expect(parseCensusProxyResponse({})).toBeNull();
    expect(
      parseCensusProxyResponse(proxyResponse("Ohio", { NAME: "Nowhere" })),
    ).toBeNull();
  });
});

describe("lookupElectionGeography", () => {
  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response;
  }

  it("posts the address to the races-api Census proxy", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, proxyResponse("Texas", { CD120: "10" })),
      );

    await expect(
      lookupElectionGeography("301 W 2nd St, Austin, TX 78701", 1000, fetchFn),
    ).resolves.toEqual({ state: "Texas", congressionalDistrict: "10" });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toMatch(/\/geocode\/census$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      address: "301 W 2nd St, Austin, TX 78701",
    });
  });

  it.each([404, 422])("reports %i as an unmatched address", async (status) => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(status, {}));
    await expect(
      lookupElectionGeography("nowhere", 1000, fetchFn),
    ).rejects.toThrow("We could not match that address.");
  });

  it.each([429, 502, 504])(
    "reports %i as the service being unavailable",
    async (status) => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(status, {}));
      await expect(
        lookupElectionGeography("somewhere", 1000, fetchFn),
      ).rejects.toThrow("The address service is unavailable right now.");
    },
  );

  it("reports a network failure as the service being unavailable", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(
      lookupElectionGeography("somewhere", 1000, fetchFn),
    ).rejects.toThrow("The address service is unavailable right now.");
  });

  it("gives up after the timeout", async () => {
    const fetchFn = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(
      lookupElectionGeography("somewhere", 5, fetchFn),
    ).rejects.toThrow("The address service took too long to respond.");
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
