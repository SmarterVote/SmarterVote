import { cleanup, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { LatestCall } from "$lib/utils/resultsPage";
import ResultsKeyRaces from "./ResultsKeyRaces.svelte";
import ResultsLatestCalls from "./ResultsLatestCalls.svelte";
import ResultRaceCard from "./ResultRaceCard.svelte";

afterEach(() => cleanup());

const now = Date.parse("2026-11-04T04:30:00Z");

describe("ResultsLatestCalls", () => {
  const calls: LatestCall[] = [
    {
      id: "oh-senate-2026-special",
      title: "Ohio U.S. Senate (special)",
      winner: "Sherrod Brown",
      party: "Democratic",
      calledBy: "The Associated Press",
      calledAt: "2026-11-04T04:25:00Z",
      flip: true,
    },
    {
      id: "tn-senate-2026",
      title: "Tennessee U.S. Senate",
      winner: "Marsha Blackburn",
      party: "Republican",
      calledBy: null,
      calledAt: "2026-11-04T02:30:00Z",
      flip: false,
    },
  ];

  it("lists each call with a link, caller, time and flip badge", () => {
    render(ResultsLatestCalls, { calls, now });
    const items = within(screen.getByTestId("latest-calls")).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    const first = within(items[0]);
    expect(first.getByRole("link").getAttribute("href")).toBe(
      "/races/oh-senate-2026-special/",
    );
    expect(items[0].textContent).toMatch(/Sherrod Brown wins/);
    expect(items[0].textContent).toMatch(/called by The Associated Press/);
    expect(items[0].textContent).toMatch(/5 min ago/);
    expect(first.getByText("Flip")).toBeTruthy();
    expect(within(items[1]).queryByText("Flip")).toBeNull();
    expect(items[1].textContent).toMatch(/2 hr ago/);
  });

  it("says so when nothing is called", () => {
    render(ResultsLatestCalls, { calls: [], now });
    expect(screen.getByText(/No race has been called yet/)).toBeTruthy();
  });
});

describe("ResultsKeyRaces", () => {
  it("shows leader, margin and share counted", () => {
    render(ResultsKeyRaces, {
      races: [
        {
          id: "mi-senate-2026",
          title: "Michigan U.S. Senate",
          office: "senate",
          group: "counting",
          leader: "Mallory McMorrow",
          party: "Democratic",
          margin: 1.24,
          pctReporting: 62,
        },
        {
          id: "ga-governor-2026",
          title: "Georgia Governor",
          office: "governor",
          group: "awaiting",
          leader: null,
          party: null,
          margin: null,
          pctReporting: null,
        },
      ],
    });
    const items = within(screen.getByTestId("key-races")).getAllByRole(
      "listitem",
    );
    const first = within(items[0]);
    expect(first.getByRole("link").getAttribute("href")).toBe(
      "/races/mi-senate-2026/",
    );
    expect(items[0].textContent).toMatch(
      /Mallory McMorrow\s*Party:\s*D\s*Ahead/,
    );
    expect(items[0].textContent).toMatch(/62% counted/);
    expect(items[0].textContent).toMatch(/D lead \+1\.2/);
    expect(first.getByText("Counting")).toBeTruthy();
    expect(items[1].textContent).toMatch(/Awaiting results/);
  });

  it("flags a lead under a point as razor-thin", () => {
    render(ResultsKeyRaces, {
      races: [
        {
          id: "nc-senate-2026",
          title: "North Carolina U.S. Senate",
          office: "senate",
          group: "counting",
          leader: "Roy Cooper",
          party: "Democratic",
          margin: 0.4,
          pctReporting: 88,
          contenders: [
            {
              name: "Roy Cooper",
              party: "Democratic",
              pct: 49.9,
              imageUrl: null,
            },
            {
              name: "Mike Whatley",
              party: "Republican",
              pct: 49.5,
              imageUrl: null,
            },
          ],
        },
      ],
    });
    const item = within(screen.getByTestId("key-races")).getByRole("listitem");
    expect(within(item).getByText("Razor-thin")).toBeTruthy();
    expect(item.textContent).toMatch(/Cooper 49\.9%/);
    expect(item.textContent).toMatch(/Whatley 49\.5%/);
  });

  it("renders nothing without races", () => {
    const { container } = render(ResultsKeyRaces, { races: [] });
    expect(container.querySelector("section")).toBeNull();
  });
});

describe("ResultRaceCard freshness", () => {
  it("shows how long ago the race was updated", () => {
    render(ResultRaceCard, {
      id: "oh-house-01-2026",
      title: "Ohio's 1st",
      now,
      result: {
        id: "oh-house-01-2026",
        status: "counting",
        as_of: "2026-11-04T04:18:00Z",
        pct_reporting: 40,
        sources: [],
        candidates: [
          { name: "Dana Dem", party: "Democratic", pct: 51, votes: null },
          { name: "Rob Rep", party: "Republican", pct: 49, votes: null },
        ],
      },
    });
    expect(screen.getByText("Updated 12 min ago")).toBeTruthy();
  });
});
