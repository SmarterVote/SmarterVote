import { describe, expect, it } from "vitest";
import type { RaceSummary } from "$lib/types";
import {
  buildSearchIndex,
  parseSearchQuery,
  prepareSearchIndex,
  searchIndex,
} from "./searchIndex";

function race(
  id: string,
  office: string,
  state: string,
  candidates: Array<[string, string]> = [],
  extra: Partial<RaceSummary> = {},
): RaceSummary {
  return {
    id,
    office,
    state,
    jurisdiction: state,
    election_date: "2026-11-03",
    updated_utc: "2026-09-01T00:00:00Z",
    candidates: candidates.map(([name, party]) => ({
      name,
      party,
      incumbent: false,
    })),
    ...extra,
  };
}

// Catalog order deliberately puts the Senate race after many House seats, as
// the published summaries do.
const catalog: RaceSummary[] = [
  ...Array.from({ length: 12 }, (_, i) =>
    race(
      `tx-house-${String(i + 1).padStart(2, "0")}-2026`,
      "U.S. House",
      "Texas",
    ),
  ),
  race("ne-house-02-2026", "U.S. House", "Nebraska", [
    ["Don Bacon", "Republican"],
  ]),
  race("ne-senate-2026", "U.S. Senate", "Nebraska"),
  race("tx-senate-2026", "U.S. Senate", "Texas", [
    ["James Talarico", "Democratic"],
    ["Ken Paxton", "Republican"],
  ]),
  race("tx-governor-2026", "Governor", "Texas", [
    ["Greg Abbott", "Republican"],
  ]),
  race("ga-senate-2026", "U.S. Senate", "Georgia", [
    ["Jamie Texasson", "Independent"],
  ]),
];
const prepared = prepareSearchIndex(buildSearchIndex(catalog));
const ids = (query: string) =>
  searchIndex(prepared, query).races.map((entry) => entry.i);

describe("parseSearchQuery", () => {
  it("drops election years and reads district codes", () => {
    expect(parseSearchQuery("TX-10 2026")).toMatchObject({
      state: "tx",
      district: 10,
      rest: [],
    });
    expect(parseSearchQuery("tx 10").district).toBe(10);
    expect(parseSearchQuery("tx10").district).toBe(10);
    expect(parseSearchQuery("Nebraska 2").district).toBe(2);
    expect(parseSearchQuery("new hampshire").state).toBe("nh");
    expect(parseSearchQuery("2026").terms).toEqual([]);
  });
});

describe("searchIndex ranking", () => {
  it("puts the exact district first for a district code", () => {
    expect(ids("TX-10")).toEqual(["tx-house-10-2026"]);
    expect(ids("tx 10")).toEqual(["tx-house-10-2026"]);
  });

  it("matches the district for a state name and number, not the year", () => {
    expect(ids("Nebraska 2")).toEqual(["ne-house-02-2026"]);
  });

  it("lists a state's statewide races first for a state name", () => {
    expect(ids("Texas").slice(0, 2).sort()).toEqual([
      "tx-governor-2026",
      "tx-senate-2026",
    ]);
    expect(ids("TX").slice(0, 2)).toContain("tx-senate-2026");
  });

  it("ranks office + state matches", () => {
    expect(ids("texas senate")[0]).toBe("tx-senate-2026");
  });

  it("finds candidates by name prefix, not by their race's state", () => {
    const pax = searchIndex(prepared, "pax");
    expect(pax.candidates.map((c) => c.name)).toEqual(["Ken Paxton"]);
    expect(pax.candidates[0].raceId).toBe("tx-senate-2026");

    const texas = searchIndex(prepared, "Texas");
    // "Texasson" is a name match; Texas candidates are not listed just for
    // running in Texas.
    expect(texas.candidates.map((c) => c.name)).toEqual(["Jamie Texasson"]);
  });

  it("caps each list and counts every matched race", () => {
    const result = searchIndex(prepared, "Texas");
    expect(result.races).toHaveLength(5);
    expect(result.totalRaces).toBe(15);
  });

  it("returns nothing for a year on its own", () => {
    expect(searchIndex(prepared, "2026").races).toEqual([]);
  });
});

describe("buildSearchIndex", () => {
  it("is compact: short keys, no photos or forecasts", () => {
    const [entry] = buildSearchIndex([
      race("tx-senate-2026", "U.S. Senate", "Texas", [["A B", "Democratic"]], {
        forecast: null,
      }),
    ]).races;
    expect(Object.keys(entry).sort()).toEqual(
      ["c", "i", "o", "p", "s", "t", "w"].sort(),
    );
    expect(entry.c).toBe("TX");
    expect(entry.o).toBe("S");
    expect(entry.p).toEqual([["A B", "Democratic"]]);
  });
});
