/**
 * Data-quality guards from the 2026-11-04 frontend audit: placeholder zeros,
 * shares from votes, impossible totals, bad call times, stale rows, rounded
 * ties, partial counts and result sources.
 */
import { describe, expect, it } from "vitest";
import type { PublicRaceResult } from "$lib/types";
import {
  chamberSeats,
  closestRaces,
  biggestLeads,
  formatLead,
  hasNoCount,
  implausibleCount,
  isPartialCount,
  isRowStale,
  normalizeResult,
  rankResultSources,
  resultLeadLabel,
  resultLeader,
  trustedCallTime,
  usesFederalRcv,
  type ResultStatsRow,
} from "./results";

function result(partial: Partial<PublicRaceResult>): PublicRaceResult {
  return {
    id: "x",
    status: "counting",
    candidates: [],
    sources: [],
    ...partial,
  };
}

describe("normalizeResult", () => {
  it("treats a called race with every candidate at 0 votes and 0% as no count (IL governor)", () => {
    const out = normalizeResult(
      result({
        id: "il-governor-2026",
        status: "called",
        winner_name: "JB Pritzker",
        candidates: [
          { name: "JB Pritzker", party: "Democratic", votes: 0, pct: 0 },
          { name: "Darren Bailey", party: "Republican", votes: 0, pct: 0 },
        ],
      }),
    );
    expect(
      out.candidates.every((c) => c.pct === null && c.votes === null),
    ).toBe(true);
    expect(hasNoCount(out.candidates)).toBe(true);
  });

  it("computes shares from vote totals when no row has a share (AR-04)", () => {
    const out = normalizeResult(
      result({
        id: "ar-house-04-2026",
        status: "called",
        candidates: [
          { name: "Bruce Westerman", votes: 55737, pct: null },
          { name: "James Russell", votes: 30945, pct: null },
        ],
      }),
    );
    expect(out.candidates.map((c) => c.pct)).toEqual([64.3, 35.7]);
  });

  it("treats an explicit 0% beside a vote count as a blank share", () => {
    const out = normalizeResult(
      result({
        candidates: [
          { name: "A", votes: 600, pct: 0 },
          { name: "B", votes: 400, pct: 40 },
        ],
      }),
    );
    expect(out.candidates[0].pct).toBe(60);
  });

  it("leaves a normal count untouched", () => {
    const input = result({
      candidates: [
        { name: "A", votes: 60, pct: 60 },
        { name: "B", votes: 40, pct: 40 },
      ],
    });
    expect(normalizeResult(input)).toBe(input);
  });
});

describe("implausibleCount", () => {
  const tx09 = result({
    id: "tx-house-09-2026",
    title: "2026 Texas's 9th Congressional District Election",
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
  });

  it("flags about 1M House votes at 39% counted (TX-09)", () => {
    expect(implausibleCount(tx09)).toBe(true);
  });

  it("flags a total that implies over 1M votes once fully counted", () => {
    expect(
      implausibleCount(
        result({
          id: "oh-house-01-2026",
          pct_reporting: 30,
          candidates: [
            { name: "A", votes: 200000 },
            { name: "B", votes: 150000 },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("allows normal House totals and any statewide total", () => {
    expect(
      implausibleCount(
        result({
          id: "oh-house-01-2026",
          pct_reporting: 90,
          candidates: [
            { name: "A", votes: 200000 },
            { name: "B", votes: 150000 },
          ],
        }),
      ),
    ).toBe(false);
    expect(implausibleCount({ ...tx09, id: "tx-senate-2026", title: "" })).toBe(
      false,
    );
  });

  it("keeps the row out of leads", () => {
    expect(resultLeader(tx09)).toBeNull();
    const rows: ResultStatsRow[] = [
      {
        id: tx09.id,
        title: "TX-09",
        office: "house",
        state: "Texas",
        result: tx09,
      },
    ];
    expect(biggestLeads(rows, 5, Date.parse("2026-11-04T05:00:00Z"))).toEqual(
      [],
    );
  });
});

describe("trustedCallTime", () => {
  const generated = Date.parse("2026-11-04T21:19:29Z");

  it("rejects a call later than the feed was written (PA-09)", () => {
    expect(trustedCallTime("2026-11-04T23:13:00-05:00", generated)).toBeNull();
  });

  it("rejects calls before the first polls closed", () => {
    expect(trustedCallTime("2026-11-03T10:00:00Z", generated)).toBeNull();
    expect(trustedCallTime("2026-11-03T22:31:00Z", generated)).toBeNull();
  });

  it("treats a bare date or zone-less midnight as unknown (GA-02)", () => {
    expect(trustedCallTime("2026-11-04", generated)).toBeNull();
    expect(trustedCallTime("2026-11-04T00:00:00", generated)).toBeNull();
  });

  it("keeps a normal call time", () => {
    expect(trustedCallTime("2026-11-03T20:19:00-06:00", generated)).toBe(
      Date.parse("2026-11-04T02:19:00Z"),
    );
  });
});

describe("isRowStale", () => {
  const now = Date.parse("2026-11-04T21:30:00Z");
  it("flags a count still running with no update in 12 hours", () => {
    expect(
      isRowStale({ status: "counting", as_of: "2026-11-04T04:46:00Z" }, now),
    ).toBe(true);
    expect(
      isRowStale({ status: "too_close", as_of: "2026-11-04T10:00:00Z" }, now),
    ).toBe(false);
  });
  it("never flags a called race", () => {
    expect(
      isRowStale({ status: "called", as_of: "2026-11-04T01:00:00Z" }, now),
    ).toBe(false);
  });
  it("drops stale rows from Closest and Biggest leads", () => {
    const row = (id: string, asOf: string): ResultStatsRow => ({
      id,
      title: id,
      office: "senate",
      state: "Georgia",
      result: result({
        id,
        as_of: asOf,
        candidates: [
          { name: "A B", party: "Democratic", pct: 59 },
          { name: "C D", party: "Republican", pct: 41 },
        ],
      }),
    });
    const rows = [
      row("ga-senate-2026", "2026-11-04T04:46:00Z"),
      row("fresh", "2026-11-04T20:00:00Z"),
    ];
    expect(closestRaces(rows, 5, now).map((r) => r.id)).toEqual(["fresh"]);
    expect(biggestLeads(rows, 5, now).map((r) => r.id)).toEqual(["fresh"]);
  });
});

describe("rounded ties", () => {
  const ms = result({
    status: "too_close",
    candidates: [
      {
        name: "Cindy Hyde-Smith",
        party: "Republican",
        votes: 462778,
        pct: 48.9,
      },
      { name: "Scott Colom", party: "Democratic", votes: 462821, pct: 48.9 },
    ],
  });

  it("names a 43-vote lead instead of Tied (MS Senate)", () => {
    expect(resultLeadLabel(ms)).toBe("Colom leads by 43 votes");
  });

  it("keeps Tied for an exact tie", () => {
    expect(
      resultLeadLabel(
        result({
          candidates: [
            { name: "A B", votes: 10, pct: 50 },
            { name: "C D", votes: 10, pct: 50 },
          ],
        }),
      ),
    ).toBe("Tied");
  });

  it("gives the leader and vote margin", () => {
    expect(resultLeader(ms)).toMatchObject({
      name: "Scott Colom",
      voteMargin: 43,
    });
  });

  it("formats a compact lead", () => {
    expect(formatLead(0, 43)).toEqual({ value: "+43", unit: "votes" });
    expect(formatLead(0, null)).toEqual({ value: "Tied", unit: "" });
    expect(formatLead(0.04, 0)).toEqual({ value: "Tied", unit: "" });
    expect(formatLead(2.44)).toEqual({ value: "+2.4", unit: "pts" });
    expect(formatLead(null)).toBeNull();
  });

  it("compares like with like when some rows lack a vote count (CO governor)", () => {
    expect(
      resultLeadLabel(
        result({
          candidates: [
            { name: "Phil Weiser", votes: null, pct: 61.4 },
            { name: "Victor Marx", votes: 675514, pct: 33.3 },
          ],
        }),
      ),
    ).toBe("Weiser leads by 28.1 pts");
  });
});

describe("isPartialCount", () => {
  it("flags shares that cover far less than the vote", () => {
    expect(isPartialCount([{ pct: 51 }])).toBe(true);
    expect(isPartialCount([{ pct: 57 }, { pct: 13 }, { pct: null }])).toBe(
      true,
    );
    expect(isPartialCount([{ pct: 52 }, { pct: 47 }])).toBe(false);
    expect(isPartialCount([{ pct: null }])).toBe(false);
  });
});

describe("chamberSeats ranked-choice", () => {
  it("counts an RCV-pending race as pending, not a party lead", () => {
    const seats = chamberSeats(
      [
        {
          id: "ak-senate-2026",
          title: "Alaska",
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
      ],
      "senate",
    );
    expect(seats.pending).toBe(1);
    expect(seats.leading.Democratic).toBe(0);
  });
});

describe("rankResultSources", () => {
  it("drops social media and puts official and wire sources first", () => {
    const ranked = rankResultSources([
      { url: "https://www.facebook.com/FOX56wolftv/posts/1" },
      { url: "https://www.wdam.com/2026/11/04/story" },
      { url: "https://www.nbcnews.com/politics/2026-elections/pa" },
      { url: "https://www.elections.alaska.gov/enr/results.pdf" },
    ]);
    expect(ranked.map((s) => new URL(s.url).hostname)).toEqual([
      "www.nbcnews.com",
      "www.elections.alaska.gov",
      "www.wdam.com",
    ]);
  });
});

describe("usesFederalRcv", () => {
  it("covers Maine's federal races only", () => {
    expect(usesFederalRcv("me-house-02-2026")).toBe(true);
    expect(usesFederalRcv("me-senate-2026")).toBe(true);
    expect(usesFederalRcv("me-governor-2026")).toBe(false);
    expect(usesFederalRcv("mi-senate-2026")).toBe(false);
  });
});
