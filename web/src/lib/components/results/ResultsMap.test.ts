import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRaceResult } from "$lib/types";
import ResultsMap, {
  AWAITING_FILL,
  HOUSE_LEAD_FILLS,
  HOUSE_SPLIT_FILL,
  buildResultsMap,
  houseFill,
  houseTallyLine,
  legendSummary,
  mapCall,
  type MapRace,
} from "./ResultsMap.svelte";

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (href: string) => goto(href) }));

// USMap fetches state boundaries on mount; an empty topology keeps it offline.
beforeEach(() => {
  goto.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "Topology",
        objects: { states: { type: "GeometryCollection", geometries: [] } },
        arcs: [],
      }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function result(partial: Partial<PublicRaceResult>): PublicRaceResult {
  return {
    id: "x",
    status: "counting",
    candidates: [],
    sources: [],
    ...partial,
  };
}

const RACES: MapRace[] = [
  {
    id: "co-senate-2026",
    title: "Colorado U.S. Senate",
    state: "Colorado",
    office: "senate",
    competitive: true,
    result: result({
      status: "called",
      winner_name: "Ann Blue",
      winner_party: "Democratic",
      pct_reporting: 88,
      candidates: [
        { name: "Ann Blue", party: "Democratic", pct: 55, votes: 1000 },
        { name: "Rob Red", party: "Republican", pct: 43, votes: 800 },
      ],
    }),
  },
  {
    id: "oh-senate-2026-special",
    title: "Ohio U.S. Senate (special)",
    state: "Ohio",
    office: "senate",
    competitive: true,
    result: result({
      status: "counting",
      pct_reporting: 41,
      candidates: [
        { name: "Dee Dem", party: "Democratic", pct: 47.5, votes: 900 },
        { name: "Ray Rep", party: "Republican", pct: 50.75, votes: 950 },
      ],
    }),
  },
  {
    id: "tn-senate-2026",
    title: "Tennessee U.S. Senate",
    state: "Tennessee",
    office: "senate",
    competitive: false,
    result: null,
  },
  {
    id: "oh-governor-2026",
    title: "Ohio Governor",
    state: "Ohio",
    office: "governor",
    competitive: true,
    result: null,
  },
];

describe("mapCall", () => {
  it("names a called winner, a leader with margin, or awaiting", () => {
    expect(mapCall(RACES[0].result)).toMatchObject({
      stage: "called",
      side: "D",
      who: "Ann Blue (D)",
    });
    const lead = mapCall(RACES[1].result);
    expect(lead).toMatchObject({ stage: "leading", side: "R", counted: "41%" });
    expect(lead.margin).toBeCloseTo(3.25);
    expect(mapCall(null).stage).toBe("awaiting");
    // Counting with no votes yet is still awaiting, not a lead.
    expect(
      mapCall(
        result({ candidates: [{ name: "A", party: "Democratic", pct: 0 }] }),
      ).stage,
    ).toBe("awaiting");
  });
});

describe("buildResultsMap", () => {
  it("shades each state and counts races for one office", () => {
    const map = buildResultsMap(RACES, "senate");
    expect([...map.activeStates].sort()).toEqual([
      "Colorado",
      "Ohio",
      "Tennessee",
    ]);
    expect(map.colors.Colorado).toBe("var(--color-safe-d)");
    expect(map.colors.Ohio).toBe("var(--color-lean-r)");
    expect(map.colors.Tennessee).toBe(AWAITING_FILL);
    expect(map.raceCounts).toEqual({ Colorado: 1, Ohio: 1, Tennessee: 1 });
    expect(map.hrefs.Ohio).toBe("/races/oh-senate-2026-special/");
    expect(map.tooltips.Ohio.details).toEqual([
      "Ray Rep (R) leads by 3.3 pts",
      "41% counted",
    ]);
    expect(legendSummary(map.counts)).toBe(
      "Called D 1 · R 0 · Leading D 0 · R 1 · Awaiting 1",
    );
  });
});

describe("ResultsMap", () => {
  it("toggles between Senate and Governor races", async () => {
    render(ResultsMap, { races: RACES });

    expect(screen.getByRole("heading", { name: "Results map" })).toBeTruthy();
    const counts = screen.getByTestId("results-map-counts");
    expect(counts.textContent).toContain("Called D 1 · R 0");

    const governor = screen.getByRole("button", { name: "Governor" });
    await fireEvent.click(governor);
    expect(governor.getAttribute("aria-pressed")).toBe("true");
    expect(counts.textContent).toContain("Awaiting 1");
    expect(counts.textContent).toContain("Called D 0 · R 0");
  });

  it("offers a list fallback that links each race page", () => {
    render(ResultsMap, { races: RACES });

    const link = screen.getByRole("link", { name: "Colorado U.S. Senate" });
    expect(link.getAttribute("href")).toBe("/races/co-senate-2026/");
    expect(screen.getByText("Winner: Ann Blue (D)")).toBeTruthy();
    expect(
      screen.getByText("Awaiting results", { selector: "td" }),
    ).toBeTruthy();
  });
});

describe("House map", () => {
  const seat = (
    id: string,
    state: string,
    partial: Partial<PublicRaceResult> | null,
  ): MapRace => ({
    id,
    title: id,
    state,
    office: "house",
    competitive: false,
    result: partial ? result(partial) : null,
  });
  const calledFor = (party: string): Partial<PublicRaceResult> => ({
    status: "called",
    winner_name: `${party} Winner`,
    winner_party: party,
  });
  const leadingFor = (party: string): Partial<PublicRaceResult> => ({
    status: "counting",
    candidates: [
      { name: "Lead", party, pct: 52, votes: null },
      {
        name: "Trail",
        party: party === "Democratic" ? "Republican" : "Democratic",
        pct: 48,
        votes: null,
      },
    ],
  });
  const HOUSE: MapRace[] = [
    // Vermont: one seat, called D, solid.
    seat("vt-house-01-2026", "Vermont", calledFor("Democratic")),
    // Ohio: R ahead in more seats, counts continue.
    seat("oh-house-01-2026", "Ohio", calledFor("Republican")),
    seat("oh-house-02-2026", "Ohio", leadingFor("Republican")),
    seat("oh-house-03-2026", "Ohio", leadingFor("Democratic")),
    seat("oh-house-04-2026", "Ohio", null),
    // Iowa: one each, a split.
    seat("ia-house-01-2026", "Iowa", calledFor("Republican")),
    seat("ia-house-02-2026", "Iowa", leadingFor("Democratic")),
    // Kansas: all called, split by party, D majority.
    seat("ks-house-01-2026", "Kansas", calledFor("Democratic")),
    seat("ks-house-02-2026", "Kansas", calledFor("Democratic")),
    seat("ks-house-03-2026", "Kansas", calledFor("Republican")),
    // Utah: nothing reported.
    seat("ut-house-01-2026", "Utah", null),
    seat("ut-house-02-2026", "Utah", null),
  ];

  it("shades each state by its delegation", () => {
    const map = buildResultsMap(HOUSE, "house");
    expect(map.colors.Vermont).toBe("var(--color-safe-d)");
    expect(map.colors.Ohio).toBe(HOUSE_LEAD_FILLS.R);
    expect(map.colors.Iowa).toBe(HOUSE_SPLIT_FILL);
    expect(map.colors.Kansas).toBe("var(--color-lean-d)");
    expect(map.colors.Utah).toBe(AWAITING_FILL);
    expect(map.raceCounts.Ohio).toBe(4);
    expect(map.hrefs.Ohio).toBe(
      "/results/?state=Ohio&office=house#results-list",
    );
  });

  it("lists the seat tally in the tooltip and totals seats by party", () => {
    const map = buildResultsMap(HOUSE, "house");
    expect(map.tooltips.Ohio.details).toEqual([
      "D 1 leading; R 1 called · 1 leading; 1 awaiting",
    ]);
    expect(map.tooltips.Ohio.badge).toBe("1 of 4 called");
    expect(map.tooltips.Utah.badge).toBe("Awaiting results");
    expect(legendSummary(map.counts)).toBe(
      "Called D 3 · R 3 · Leading D 2 · R 1 · Awaiting 3",
    );
    expect(map.stateRows.map((row) => row.state)).toEqual([
      "Iowa",
      "Kansas",
      "Ohio",
      "Utah",
      "Vermont",
    ]);
  });

  it("formats a tally line like the tooltip example", () => {
    expect(
      houseTallyLine({
        called: { D: 12, R: 3, O: 0 },
        leading: { D: 8, R: 2, O: 0 },
        awaiting: 27,
        total: 52,
      }),
    ).toBe("D 12 called · 8 leading; R 3 called · 2 leading; 27 awaiting");
    expect(
      houseFill({
        called: { D: 0, R: 0, O: 0 },
        leading: { D: 0, R: 0, O: 0 },
        awaiting: 2,
        total: 2,
      }),
    ).toBe(AWAITING_FILL);
  });

  it("adds a House toggle with a per-state list", async () => {
    render(ResultsMap, { races: [...RACES, ...HOUSE] });
    const house = screen.getByRole("button", { name: "House" });
    await fireEvent.click(house);
    expect(house.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("results-map-counts").textContent).toContain(
      "Called D 3 · R 3",
    );
    expect(
      screen.getByRole("link", { name: "Ohio" }).getAttribute("href"),
    ).toBe("/results/?state=Ohio&office=house#results-list");
  });
});
