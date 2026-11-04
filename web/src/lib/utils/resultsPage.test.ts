import { describe, expect, it } from "vitest";
import type { PublicRaceResult } from "$lib/types";
import {
  DEFAULT_RESULTS_QUERY,
  formatAgo,
  isFlip,
  isStale,
  keyRaces,
  latestCalls,
  limitAwaiting,
  parseResultsQuery,
  resultsQueryString,
  rowMargin,
  sortResultsRows,
  type ResultsPageRow,
} from "./resultsPage";
import {
  GENERAL_ELECTION_DATE,
  resultDirectory,
  seatHolderParty,
} from "./results";

function row(
  id: string,
  result: Partial<PublicRaceResult> | null,
  extra: Partial<ResultsPageRow> = {},
): ResultsPageRow {
  return {
    id,
    title: `2026 ${id} Election`,
    state: "Ohio",
    office: "house",
    competitive: false,
    result: result
      ? ({ id, candidates: [], sources: [], ...result } as PublicRaceResult)
      : null,
    ...extra,
  };
}

const counting = (dem: number, rep: number, extra = {}) => ({
  status: "counting" as const,
  candidates: [
    { name: "Dana Dem", party: "Democratic", pct: dem, votes: null },
    { name: "Rob Rep", party: "Republican", pct: rep, votes: null },
  ],
  ...extra,
});

describe("sortResultsRows", () => {
  const rows = [
    row("a", null),
    row(
      "b",
      counting(55, 45, { pct_reporting: 20, as_of: "2026-11-04T01:00:00Z" }),
    ),
    row(
      "c",
      counting(50.5, 49.5, {
        pct_reporting: 90,
        as_of: "2026-11-04T03:00:00Z",
      }),
    ),
    row(
      "d",
      counting(60, 40, { pct_reporting: 50, as_of: "2026-11-04T02:00:00Z" }),
    ),
  ];
  const ids = (list: ResultsPageRow[]) => list.map((r) => r.id);

  it("keeps the incoming order for default", () => {
    expect(sortResultsRows(rows, "default")).toBe(rows);
  });
  it("sorts by closest margin, awaiting races last", () => {
    expect(ids(sortResultsRows(rows, "margin"))).toEqual(["c", "b", "d", "a"]);
  });
  it("sorts by most counted", () => {
    expect(ids(sortResultsRows(rows, "counted"))).toEqual(["c", "d", "b", "a"]);
  });
  it("sorts by most recently updated", () => {
    expect(ids(sortResultsRows(rows, "updated"))).toEqual(["c", "d", "b", "a"]);
  });
  it("measures no margin without two shares", () => {
    expect(rowMargin(row("x", { status: "counting" }))).toBeNull();
    expect(rowMargin(rows[1])).toBeCloseTo(10);
  });
});

describe("limitAwaiting", () => {
  it("keeps every reporting row and caps awaiting ones", () => {
    const rows = [
      row("a", null),
      row("b", counting(50, 50)),
      row("c", null),
      row("d", null),
      row("e", { status: "called" }),
    ];
    const { rows: shown, hidden } = limitAwaiting(rows, 1);
    expect(shown.map((r) => r.id)).toEqual(["a", "b", "e"]);
    expect(hidden).toBe(2);
  });
  it("hides nothing under the limit", () => {
    expect(limitAwaiting([row("a", null)], 5).hidden).toBe(0);
  });
});

describe("results query params", () => {
  it("parses known values and canonicalizes the state", () => {
    const query = parseResultsQuery(
      new URLSearchParams(
        "state=oh&office=senate&status=counting&competitive=1&q=Brown&sort=margin",
      ),
      ["Ohio", "Texas"],
    );
    expect(query).toEqual({
      state: "Ohio",
      office: "senate",
      status: "counting",
      competitive: true,
      q: "Brown",
      sort: "margin",
    });
  });
  it("accepts a full state name in any case", () => {
    expect(
      parseResultsQuery(new URLSearchParams("state=ohio"), ["Ohio"]).state,
    ).toBe("Ohio");
  });
  it("falls back to defaults for unknown values", () => {
    expect(
      parseResultsQuery(
        new URLSearchParams("state=Narnia&office=mayor&status=x&sort=y"),
        ["Ohio"],
      ),
    ).toEqual(DEFAULT_RESULTS_QUERY);
  });
  it("writes only non-default values, and round-trips", () => {
    expect(resultsQueryString(DEFAULT_RESULTS_QUERY)).toBe("");
    const query = {
      ...DEFAULT_RESULTS_QUERY,
      state: "New York",
      competitive: true,
      q: " smith ",
    };
    const text = resultsQueryString(query);
    expect(text).toBe("?state=New+York&competitive=1&q=smith");
    expect(parseResultsQuery(new URLSearchParams(text), ["New York"])).toEqual({
      ...query,
      q: "smith",
    });
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-11-04T04:30:00Z");
  it("formats elapsed time", () => {
    expect(formatAgo("2026-11-04T04:29:40Z", now)).toBe("just now");
    expect(formatAgo("2026-11-04T04:26:00Z", now)).toBe("4 min ago");
    expect(formatAgo("2026-11-04T02:00:00Z", now)).toBe("2 hr ago");
    expect(formatAgo(null, now)).toBe("");
    expect(formatAgo("not a date", now)).toBe("");
  });
  it("flags a feed older than ten minutes", () => {
    expect(isStale("2026-11-04T04:21:00Z", now)).toBe(false);
    expect(isStale("2026-11-04T04:19:00Z", now)).toBe(true);
    expect(isStale(new Date(now - 11 * 60_000), now)).toBe(true);
    expect(isStale(null, now)).toBe(false);
  });
});

describe("isFlip", () => {
  it("is true only when both parties are named and differ", () => {
    expect(isFlip("Democratic", "Republican")).toBe(true);
    expect(isFlip("Democratic", "Democratic Party")).toBe(false);
    expect(isFlip("Democratic", null)).toBe(false);
    expect(isFlip(null, "Republican")).toBe(false);
    expect(isFlip("Forward", "Republican")).toBe(false);
    expect(isFlip("Independent", "Republican")).toBe(true);
  });
});

describe("latestCalls", () => {
  const called = (
    winner: string,
    party: string,
    at: string | null,
    extra = {},
  ) => ({
    status: "called" as const,
    winner_name: winner,
    winner_party: party,
    called_by: "The Associated Press",
    called_at: at,
    ...extra,
  });

  it("lists calls newest first with a flip only against a known holder", () => {
    const calls = latestCalls([
      row("a", called("Ann", "Democratic", "2026-11-04T01:00:00Z"), {
        holder_party: "Republican",
      }),
      row("b", called("Bob", "Republican", "2026-11-04T03:00:00Z"), {
        holder_party: "Republican",
      }),
      row("c", called("Cat", "Democratic", "2026-11-04T02:00:00Z")),
      row("d", called("Dan", "Democratic", null)),
      row("e", counting(50, 50)),
    ]);
    expect(calls.map((c) => [c.id, c.flip])).toEqual([
      ["b", false],
      ["c", false],
      ["a", true],
    ]);
    expect(calls[0]).toMatchObject({
      winner: "Bob",
      party: "Republican",
      calledBy: "The Associated Press",
      title: "b",
    });
  });

  it("takes the winner's party from the candidate row when the feed omits it", () => {
    const [call] = latestCalls([
      row(
        "a",
        {
          ...counting(60, 40),
          status: "called",
          winner_name: "Rob Rep",
          called_at: "2026-11-04T01:00:00Z",
        },
        { holder_party: "Democratic" },
      ),
    ]);
    expect(call.party).toBe("Republican");
    expect(call.flip).toBe(true);
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(`r${i}`, called("X", "Democratic", `2026-11-04T0${i}:00:00Z`)),
    );
    expect(latestCalls(rows, 2).map((c) => c.id)).toEqual(["r4", "r3"]);
  });
});

describe("keyRaces", () => {
  it("keeps competitive Senate and governor races, counting closest first", () => {
    const races = keyRaces(
      [
        row("house", counting(50, 50), { competitive: true }),
        row("safe-senate", counting(50, 50), { office: "senate" }),
        row("sen-wide", counting(60, 40, { pct_reporting: 30 }), {
          office: "senate",
          competitive: true,
        }),
        row("gov-close", counting(50.2, 49.8), {
          office: "governor",
          competitive: true,
        }),
        row("gov-wait", null, { office: "governor", competitive: true }),
        row(
          "sen-called",
          {
            status: "called",
            winner_name: "Rob Rep",
            winner_party: "Republican",
          },
          { office: "senate", competitive: true },
        ),
        row("priority", null, { office: "senate" }),
      ],
      (id) => id === "priority",
    );
    expect(races.map((r) => r.id)).toEqual([
      "gov-close",
      "sen-wide",
      "sen-called",
      "gov-wait",
      "priority",
    ]);
    expect(races[1]).toMatchObject({
      leader: "Dana Dem",
      party: "Democratic",
      pctReporting: 30,
    });
    expect(races[2]).toMatchObject({ leader: "Rob Rep", party: "Republican" });
    expect(races[3]).toMatchObject({ leader: null, margin: null });
  });
});

describe("seatHolderParty", () => {
  it("names the lone incumbent's party", () => {
    expect(
      seatHolderParty([
        { incumbent: true, party: "Republican" },
        { incumbent: false, party: "Democratic" },
      ]),
    ).toBe("Republican");
  });
  it("is null for open seats, two incumbents or an unnamed party", () => {
    expect(
      seatHolderParty([{ incumbent: false, party: "Democratic" }]),
    ).toBeNull();
    expect(
      seatHolderParty([
        { incumbent: true, party: "Democratic" },
        { incumbent: true, party: "Republican" },
      ]),
    ).toBeNull();
    expect(seatHolderParty([{ incumbent: true, party: "" }])).toBeNull();
    expect(seatHolderParty(null)).toBeNull();
  });
  it("is carried onto the results directory only when known", () => {
    const [held, open] = resultDirectory([
      {
        id: "a",
        office: "U.S. House",
        election_date: GENERAL_ELECTION_DATE,
        candidates: [{ incumbent: true, party: "Democratic" }],
      },
      {
        id: "b",
        office: "U.S. House",
        election_date: GENERAL_ELECTION_DATE,
        candidates: [{ incumbent: false, party: "Democratic" }],
      },
    ]);
    expect(held.holder_party).toBe("Democratic");
    expect("holder_party" in open).toBe(false);
  });
});
