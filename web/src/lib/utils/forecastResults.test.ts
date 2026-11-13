import { describe, expect, it } from "vitest";
import type { PublicRaceResult, RaceSummary } from "$lib/types";
import {
  buildResultMapOverlay,
  forecastResultLine,
  hasAnyResults,
  RESULT_FILLS,
  shortParty,
  withResultTooltips,
} from "./forecastResults";

function result(overrides: Partial<PublicRaceResult> = {}): PublicRaceResult {
  return {
    id: "mi-senate-2026",
    status: "counting",
    pct_reporting: 62,
    candidates: [
      { name: "Jamie Rivera", party: "Democratic", pct: 51.4 },
      { name: "Sam Cole", party: "Republican", pct: 47.2 },
    ],
    sources: [],
    ...overrides,
  };
}

function race(id: string, state: string, office: string): RaceSummary {
  return {
    id,
    title: `${state} ${office}`,
    office,
    state,
    election_date: "2026-11-03",
    updated_utc: "2026-07-01T00:00:00Z",
    candidates: [],
  } as RaceSummary;
}

describe("forecastResultLine", () => {
  it("shows nothing before any votes are reported", () => {
    expect(forecastResultLine(null)).toBeNull();
    expect(
      forecastResultLine(result({ status: "not_yet_reported" })),
    ).toBeNull();
  });

  it("names the called winner with a party letter", () => {
    expect(
      forecastResultLine(
        result({
          status: "called",
          winner_name: "Jamie Rivera",
          winner_party: "Democratic",
        }),
      ),
    ).toEqual({
      group: "called",
      text: "Called: Jamie Rivera (D)",
      party: "Democratic",
    });
    expect(
      forecastResultLine(
        result({ status: "certified", winner_name: "Sam Cole" }),
      )?.text,
    ).toBe("Certified: Sam Cole");
  });

  it("never pairs the winner with the leader's party", () => {
    // The feed names a winner without a party, and a different top row.
    const line = forecastResultLine(
      result({ status: "called", winner_name: "Sam Cole" }),
    );
    expect(line?.text).toBe("Called: Sam Cole");
    expect(line?.party).toBeNull();
  });

  it("gives the leader, margin and share counted while counting", () => {
    expect(forecastResultLine(result())).toEqual({
      group: "counting",
      text: "Jamie Rivera (D) leads by 4.2 pts · 62% counted",
      party: "Democratic",
    });
  });

  it("says too close, tied, or counting without shares", () => {
    expect(
      forecastResultLine(
        result({
          status: "too_close",
          pct_reporting: 98,
          candidates: [
            { name: "A", party: "Republican", pct: 50.02 },
            { name: "B", party: "Democratic", pct: 50.0 },
          ],
        }),
      ),
    ).toMatchObject({
      text: "Too close to call · Tied · 98% counted",
      party: null,
    });
    expect(
      forecastResultLine(result({ candidates: [], pct_reporting: null }))?.text,
    ).toBe("Votes being counted");
  });

  it("rounds wide margins to whole points", () => {
    expect(
      forecastResultLine(
        result({
          candidates: [
            { name: "A", party: "Republican", pct: 64.6 },
            { name: "B", party: "Democratic", pct: 35.4 },
          ],
        }),
      )?.text,
    ).toBe("A (R) leads by 29 pts · 62% counted");
  });
});

describe("shortParty", () => {
  it("abbreviates known parties and keeps others", () => {
    expect(shortParty("Democratic")).toBe("D");
    expect(shortParty("Republican Party")).toBe("R");
    expect(shortParty("Independent")).toBe("I");
    expect(shortParty("Forward")).toBe("Forward");
    expect(shortParty(null)).toBe("");
  });
});

describe("hasAnyResults", () => {
  const results = new Map([
    ["a", result({ id: "a", status: "not_yet_reported" })],
    ["b", result({ id: "b" })],
  ]);
  it("ignores races still awaiting votes", () => {
    expect(hasAnyResults(results)).toBe(true);
    expect(hasAnyResults(results, ["a"])).toBe(false);
    expect(hasAnyResults(results, ["b"])).toBe(true);
    expect(hasAnyResults(new Map())).toBe(false);
  });
});

describe("buildResultMapOverlay", () => {
  const races = [
    race("mi-senate-2026", "Michigan", "U.S. Senate"),
    race("ga-senate-2026", "Georgia", "U.S. Senate"),
    race("tx-senate-2026", "Texas", "U.S. Senate"),
  ];

  it("fills called states solid and counting states hatched by the leader", () => {
    const overlay = buildResultMapOverlay(
      races,
      "senate",
      new Map([
        [
          "ga-senate-2026",
          result({
            id: "ga-senate-2026",
            status: "called",
            winner_name: "Sam Cole",
            winner_party: "Republican",
          }),
        ],
        ["mi-senate-2026", result()],
      ]),
    );
    expect(overlay.colors).toEqual({
      Georgia: RESULT_FILLS.calledR,
      Michigan: RESULT_FILLS.leadD,
    });
    expect(overlay.reportingStates).toBe(2);
    expect(overlay.details.Georgia).toEqual(["Result: Called: Sam Cole (R)"]);
    // Texas has no result: it keeps its forecast fill.
    expect(overlay.colors.Texas).toBeUndefined();
  });

  it("colors a multi-race state only when every race is called for one party", () => {
    const house = [
      race("nv-house-01-2026", "Nevada", "U.S. House"),
      race("nv-house-03-2026", "Nevada", "U.S. House"),
    ];
    const called = (id: string, party: string) =>
      result({ id, status: "called", winner_name: id, winner_party: party });
    const mixed = buildResultMapOverlay(
      house,
      "house",
      new Map([["nv-house-01-2026", called("nv-house-01-2026", "Democratic")]]),
    );
    expect(mixed.colors.Nevada).toBeUndefined();
    expect(mixed.details.Nevada).toEqual([
      "Results: 1 of 2 called",
      "Won so far: D 1",
    ]);

    const swept = buildResultMapOverlay(
      house,
      "house",
      new Map([
        ["nv-house-01-2026", called("nv-house-01-2026", "Democratic")],
        ["nv-house-03-2026", called("nv-house-03-2026", "Democratic")],
      ]),
    );
    expect(swept.colors.Nevada).toBe(RESULT_FILLS.calledD);
  });

  it("puts result lines above the forecast tooltip without mutating it", () => {
    const tooltips = { Georgia: { title: "Georgia", details: ["Lean R"] } };
    const merged = withResultTooltips(tooltips, {
      colors: {},
      details: { Georgia: ["Result: Called: Sam Cole (R)"] },
      reportingStates: 1,
    });
    expect(merged.Georgia.details).toEqual([
      "Result: Called: Sam Cole (R)",
      "Lean R",
    ]);
    expect(tooltips.Georgia.details).toEqual(["Lean R"]);
  });
});
