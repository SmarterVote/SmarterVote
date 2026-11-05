/** Component checks for the 2026-11-04 frontend audit's results findings. */
import { cleanup, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicRaceResult } from "$lib/types";
import { normalizeResult, type ResultStatsRow } from "$lib/utils/results";
import ResultBanner from "../ResultBanner.svelte";
import ResultBars from "./ResultBars.svelte";
import ResultRaceCard from "./ResultRaceCard.svelte";
import ResultsLatestCalls from "./ResultsLatestCalls.svelte";
import ResultsRaceTile from "./ResultsRaceTile.svelte";
import ResultsStats from "./ResultsStats.svelte";
import { RCV_FILL, buildResultsMap, legendSummary } from "./ResultsMap.svelte";

afterEach(() => cleanup());

function result(partial: Partial<PublicRaceResult>): PublicRaceResult {
  return {
    id: "x",
    status: "counting",
    candidates: [],
    sources: [],
    ...partial,
  };
}

describe("ResultBars", () => {
  it("never draws a called winner at 0.0% from placeholder zeros (IL governor)", () => {
    const clean = normalizeResult(
      result({
        status: "called",
        winner_name: "JB Pritzker",
        candidates: [
          { name: "JB Pritzker", party: "Democratic", votes: 0, pct: 0 },
          { name: "Darren Bailey", party: "Republican", votes: 0, pct: 0 },
        ],
      }),
    );
    const { container } = render(ResultBars, {
      rows: clean.candidates,
      winnerName: "JB Pritzker",
    });
    expect(screen.getByText("Vote shares not yet reported.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/0\.0%/);
  });

  it("draws shares computed from votes instead of n/a (AR-04)", () => {
    const clean = normalizeResult(
      result({
        candidates: [
          { name: "Bruce Westerman", party: "Republican", votes: 55737 },
          { name: "James Russell", party: "Democratic", votes: 30945 },
        ],
      }),
    );
    const { container } = render(ResultBars, { rows: clean.candidates });
    expect(container.textContent).toMatch(/64\.3%/);
    expect(container.textContent).not.toMatch(/n\/a/);
  });

  it("hides vote counts unless every candidate shown has one (CO governor)", () => {
    const { container } = render(ResultBars, {
      rows: [
        { name: "Phil Weiser", party: "Democratic", votes: null, pct: 61.4 },
        { name: "Victor Marx", party: "Republican", votes: 675514, pct: 33.3 },
      ],
    });
    expect(container.textContent).not.toMatch(/675,514/);
    expect(container.textContent).toMatch(/61\.4%/);
  });

  it("marks a partial count and drops the bars (FL-14)", () => {
    const { container } = render(ResultBars, {
      rows: [{ name: "Kathy Castor", party: "Democratic", pct: 51 }],
    });
    expect(screen.getByTestId("result-partial")).toBeTruthy();
    expect(container.querySelector(".result-track")).toBeNull();
  });

  it("holds a count under review", () => {
    render(ResultBars, {
      rows: [{ name: "Alex Mealer", votes: 827112, pct: 83 }],
      review: true,
    });
    expect(screen.getByTestId("result-review")).toBeTruthy();
    expect(screen.queryByText(/827,112/)).toBeNull();
  });
});

describe("ResultRaceCard", () => {
  const now = Date.parse("2026-11-04T21:30:00Z");
  it("shows no staleness warning when a count has not updated in 12 hours", () => {
    render(ResultRaceCard, {
      id: "ga-senate-2026",
      title: "Georgia",
      now,
      result: result({
        status: "counting",
        as_of: "2026-11-04T04:46:00Z",
        candidates: [
          { name: "Jon Ossoff", party: "Democratic", pct: 59 },
          { name: "Derek Dooley", party: "Republican", pct: 41 },
        ],
      }),
    });
    expect(screen.queryByTestId("result-row-stale")).toBeNull();
    expect(screen.queryByText(/may be behind/)).toBeNull();
  });

  it("says no results are collected once polls have closed", () => {
    render(ResultRaceCard, { id: "x", title: "X", now, result: null });
    expect(screen.getByText("No results collected yet.")).toBeTruthy();
  });
});

describe("ResultsRaceTile", () => {
  it("shows a 43-vote lead, not Tied, and no D lead on a real tie", () => {
    const { container } = render(ResultsRaceTile, {
      id: "ms-senate-2026",
      title: "Mississippi U.S. Senate",
      group: "counting",
      leader: "Scott Colom",
      party: "Democratic",
      margin: 0,
      voteMargin: 43,
      pctReporting: 95.6,
    });
    expect(container.textContent).toMatch(/\+43/);
    expect(container.textContent).toMatch(/votes/);
    expect(container.textContent).toMatch(/Ahead/);
    cleanup();
    const tied = render(ResultsRaceTile, {
      id: "t",
      title: "T",
      group: "counting",
      leader: "A",
      party: "Democratic",
      margin: 0,
      voteMargin: 0,
    });
    expect(tied.container.textContent).not.toMatch(/D lead/);
    expect(tied.container.textContent).toMatch(/Tied/);
  });

  it("frames a ranked-choice count as first choices, not a party lead (AK)", () => {
    const { container } = render(ResultsRaceTile, {
      id: "ak-senate-2026",
      title: "Alaska U.S. Senate",
      group: "pending",
      status: "rcv_pending",
      leader: "Mary Peltola",
      party: "Democratic",
      margin: 0.3,
    });
    expect(container.textContent).toMatch(/Ranked-choice pending/);
    expect(container.textContent).toMatch(/Leads first choices/);
    expect(container.textContent).not.toMatch(/D lead/);
  });
});

describe("ResultsLatestCalls", () => {
  it("shows no time chip for a call without a trusted time", () => {
    render(ResultsLatestCalls, {
      calls: [
        {
          id: "pa-house-09-2026",
          title: "PA-09",
          winner: "Dan Meuser",
          party: "Republican",
          calledBy: "The Associated Press",
          calledAt: null,
          flip: false,
        },
      ],
      now: Date.parse("2026-11-04T21:30:00Z"),
    });
    const item = within(screen.getByTestId("latest-calls")).getByRole(
      "listitem",
    );
    expect(item.querySelector("time")).toBeNull();
    expect(item.textContent).not.toMatch(/just now/);
  });
});

describe("ResultsMap ranked-choice", () => {
  it("gives an RCV-pending race its own neutral state", () => {
    const map = buildResultsMap(
      [
        {
          id: "ak-senate-2026",
          title: "Alaska U.S. Senate",
          state: "Alaska",
          office: "senate",
          competitive: true,
          result: result({
            status: "rcv_pending",
            pct_reporting: 98,
            candidates: [
              { name: "Mary Peltola", party: "Democratic", pct: 48.02 },
              { name: "Daniel S. Sullivan", party: "Republican", pct: 47.73 },
            ],
          }),
        },
      ],
      "senate",
    );
    expect(map.colors.Alaska).toBe(RCV_FILL);
    expect(map.counts.leading.D).toBe(0);
    expect(map.counts.rcv).toBe(1);
    expect(legendSummary(map.counts)).toMatch(/Ranked-choice pending 1/);
    expect(map.tooltips.Alaska.badge).toBe("Ranked-choice pending");
    expect(map.tooltips.Alaska.details?.[0]).toMatch(
      /First choices: Mary Peltola \(D\) \+0\.3, ranked-choice count pending/,
    );
  });
});

describe("ResultsStats", () => {
  it("drops majority language for governors and lists RCV as pending", () => {
    const rows: ResultStatsRow[] = [
      {
        id: "ak-senate-2026",
        title: "Alaska U.S. Senate",
        office: "senate",
        state: "Alaska",
        result: result({
          status: "rcv_pending",
          candidates: [
            { name: "Mary Peltola", party: "Democratic", pct: 48.02 },
            { name: "Daniel S. Sullivan", party: "Republican", pct: 47.73 },
          ],
        }),
      },
    ];
    render(ResultsStats, { rows, now: Date.parse("2026-11-04T21:30:00Z") });
    expect(screen.getByTestId("results-seats-governor").textContent).toMatch(
      /for most governorships/,
    );
    expect(
      screen.getByTestId("results-seats-governor").textContent,
    ).not.toMatch(/majority/);
    expect(screen.getByTestId("results-pending-senate").textContent).toMatch(
      /1 ranked-choice or runoff count pending/,
    );
  });
});

describe("ResultBanner", () => {
  it("hides a call time later than now and drops social sources (PA-09)", () => {
    render(ResultBanner, {
      raceId: "pa-house-09-2026",
      result: result({
        id: "pa-house-09-2026",
        status: "called",
        winner_name: "Dan Meuser",
        winner_party: "Republican",
        called_by: "The Associated Press",
        called_at: "2099-11-04T23:13:00-05:00",
        as_of: "2026-11-04T04:13:00Z",
        candidates: [
          { name: "Dan Meuser", party: "Republican", pct: 61.8 },
          { name: "Rachel Wallace", party: "Democratic", pct: 38.2 },
        ],
        sources: [
          { url: "https://www.facebook.com/FOX56wolftv/posts/1" },
          { url: "https://www.nbcnews.com/politics/pa-9" },
        ],
      }),
    });
    expect(screen.getByText("Called by The Associated Press")).toBeTruthy();
    expect(screen.queryByText(/facebook\.com/)).toBeNull();
    expect(screen.getByText(/nbcnews\.com/)).toBeTruthy();
  });

  it("adds Maine's ranked-choice note to a federal race still counting", () => {
    render(ResultBanner, {
      raceId: "me-house-02-2026",
      result: result({
        id: "me-house-02-2026",
        status: "too_close",
        candidates: [
          { name: "Matthew Dunlap", party: "Democratic", pct: 50.1 },
          { name: "Paul LePage", party: "Republican", pct: 49.9 },
        ],
      }),
    });
    expect(screen.getByTestId("result-maine-rcv")).toBeTruthy();
  });

  it("holds an impossible House total under review (TX-09)", () => {
    render(ResultBanner, {
      raceId: "tx-house-09-2026",
      result: result({
        id: "tx-house-09-2026",
        pct_reporting: 39,
        candidates: [
          { name: "Alex Mealer", party: "Republican", votes: 827112, pct: 83 },
          {
            name: "Leticia Gutierrez",
            party: "Democratic",
            votes: 171196,
            pct: 17,
          },
        ],
      }),
    });
    expect(screen.getByTestId("result-review")).toBeTruthy();
  });
});
