import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRaceResult } from "$lib/types";
import ResultsMap, {
  AWAITING_FILL,
  buildResultsMap,
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
