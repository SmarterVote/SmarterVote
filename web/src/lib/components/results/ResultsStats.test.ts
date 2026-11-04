import { cleanup, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { LiveForecastFile, PublicRaceResult } from "$lib/types";
import type { ResultStatsRow } from "$lib/utils/results";
import ResultsStats from "./ResultsStats.svelte";

const result = (
  id: string,
  dem: number,
  rep: number,
  extra: Partial<PublicRaceResult> = {},
): PublicRaceResult => ({
  id,
  status: "counting",
  pct_reporting: 40,
  sources: [],
  candidates: [
    { name: "Dana Dem", party: "Democratic", pct: dem, votes: null },
    { name: "Rob Rep", party: "Republican", pct: rep, votes: null },
  ],
  ...extra,
});

const rows: ResultStatsRow[] = [
  {
    id: "oh-senate-2026",
    title: "2026 Ohio U.S. Senate Election",
    office: "senate",
    state: "Ohio",
    predicted_winner_name: "Rob Rep",
    predicted_winner_party: "Republican",
    result: result("oh-senate-2026", 50.4, 49.6),
  },
  {
    id: "tn-senate-2026",
    title: "Tennessee U.S. Senate",
    office: "senate",
    state: "Tennessee",
    result: result("tn-senate-2026", 0, 0, {
      status: "called",
      winner_name: "Rob Rep",
      winner_party: "Republican",
    }),
  },
  {
    id: "oh-house-01-2026",
    title: "Ohio's 1st District",
    office: "house",
    state: "Ohio",
    result: null,
  },
];

const forecast = {
  schema_version: "forecast_live.v1",
  results_updated_at: null,
  generated_at: "2026-11-04T00:00:00Z",
  chambers: {
    senate: { total_seats: 100, threshold: 51, total_count: 35 },
  },
} as unknown as LiveForecastFile;

describe("ResultsStats", () => {
  afterEach(cleanup);

  it("describes each chamber's seat bar in text, majority line included", () => {
    render(ResultsStats, { rows, forecast });
    const senate = screen.getByTestId("results-seats-senate");
    const bar = within(senate).getByRole("img");
    const label = bar.getAttribute("aria-label") ?? "";
    expect(label).toContain("35 of 100 up this year, 51 for a majority");
    expect(label).toContain("Democrats: 0 called, 1 leading");
    expect(label).toContain("Republicans: 1 called, 0 leading");
    expect(within(senate).getByText(/^D 0 called \+ 1 leading/)).toBeTruthy();
    expect(screen.getByTestId("results-seats-house")).toBeTruthy();
    expect(screen.getByTestId("results-seats-governor")).toBeTruthy();
  });

  it("shows counting progress with a text equivalent", () => {
    render(ResultsStats, { rows, forecast });
    const progress = screen.getByTestId("results-progress");
    expect(within(progress).getByText("40%")).toBeTruthy();
    expect(
      within(progress).getByRole("img", {
        name: "2 of 3 races reporting, 1 awaiting results",
      }),
    ).toBeTruthy();
    expect(within(progress).getByRole("table")).toBeTruthy();
  });

  it("links the closest races and flags an upset against the forecast", () => {
    render(ResultsStats, { rows, forecast });
    const closest = screen.getByTestId("results-closest");
    const link = within(closest).getByRole("link");
    expect(link.getAttribute("href")).toBe("/races/oh-senate-2026/");
    expect(within(closest).getByText("Ohio U.S. Senate")).toBeTruthy();
    expect(within(closest).getByText(/D \+0\.8/)).toBeTruthy();

    const upsets = screen.getByTestId("results-upsets");
    expect(within(upsets).getByText(/forecast picked Rob Rep/)).toBeTruthy();
    expect(within(upsets).getByText("Dana Dem (D)")).toBeTruthy();
  });

  it("renders empty states before any votes", () => {
    render(ResultsStats, { rows: [], forecast: null });
    expect(screen.getByText("Shows up once votes are counted.")).toBeTruthy();
    expect(
      screen.getAllByText("No contested race is counting yet."),
    ).toHaveLength(2);
  });
});
