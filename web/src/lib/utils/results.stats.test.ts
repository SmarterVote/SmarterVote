import { describe, expect, it } from "vitest";
import type {
  LiveChamberProjection,
  PublicRaceResult,
  PublicResultCandidate,
} from "$lib/types";
import {
  GENERAL_ELECTION_DATE,
  biggestLeads,
  chamberSeats,
  closestRaces,
  countingProgress,
  resultDirectory,
  resultLeader,
  seatParty,
  shortRaceTitle,
  upsetWatch,
  type ResultStatsRow,
} from "./results";

const cand = (
  name: string,
  party: string,
  pct: number | null,
): PublicResultCandidate => ({ name, party, pct, votes: null });

function row(
  id: string,
  office: ResultStatsRow["office"],
  result: Partial<PublicRaceResult> | null,
  extra: Partial<ResultStatsRow> = {},
): ResultStatsRow {
  return {
    id,
    title: `2026 ${id} Election`,
    office,
    state: "Ohio",
    result: result
      ? ({ id, candidates: [], sources: [], ...result } as PublicRaceResult)
      : null,
    ...extra,
  };
}

const counting = (dem: number, rep: number, pct_reporting = 50) => ({
  status: "counting" as const,
  pct_reporting,
  candidates: [
    cand("Dana Dem", "Democratic", dem),
    cand("Rob Rep", "Republican", rep),
  ],
});

describe("resultDirectory forecast picks", () => {
  const base = { election_date: GENERAL_ELECTION_DATE, office: "U.S. Senate" };

  it("carries the predicted winner when the summary has one", () => {
    const [race] = resultDirectory([
      {
        ...base,
        id: "oh-senate-2026",
        forecast: {
          rating: "lean_r",
          predicted_winner_name: "Rob Rep",
          predicted_winner_party: "Republican",
        },
      },
    ]);
    expect(race.predicted_winner_name).toBe("Rob Rep");
    expect(race.predicted_winner_party).toBe("Republican");
    expect(race.competitive).toBe(true);
  });

  it("adds no forecast keys without a pick, keeping the payload small", () => {
    const [race] = resultDirectory([
      { ...base, id: "a", forecast: { rating: "safe_d" } },
    ]);
    expect("predicted_winner_name" in race).toBe(false);
    expect("predicted_winner_party" in race).toBe(false);
  });
});

describe("resultLeader and seatParty", () => {
  it("finds the leader and the margin over second place", () => {
    const leader = resultLeader({
      id: "x",
      status: "counting",
      sources: [],
      candidates: [
        cand("A", "Democratic", 48.2),
        cand("B", "Republican", 50.1),
      ],
    });
    expect(leader?.name).toBe("B");
    expect(leader?.margin).toBeCloseTo(1.9);
  });

  it("is null with no shares", () => {
    expect(resultLeader(null)).toBeNull();
    expect(
      resultLeader({
        id: "x",
        status: "counting",
        sources: [],
        candidates: [cand("A", "Democratic", null)],
      }),
    ).toBeNull();
  });

  it("buckets parties", () => {
    expect(seatParty("DFL")).toBe("Democratic");
    expect(seatParty("GOP")).toBe("Republican");
    expect(seatParty("Independent")).toBe("Other");
    expect(seatParty(null)).toBe("Other");
  });
});

describe("chamberSeats", () => {
  const rows = [
    row("oh-senate-2026", "senate", {
      status: "called",
      winner_party: "Republican",
    }),
    row("co-senate-2026", "senate", counting(52, 46), { state: "Colorado" }),
    row("ma-senate-2026", "senate", counting(60, 39), {
      state: "Massachusetts",
    }),
    row("tn-senate-2026", "senate", null, { state: "Tennessee" }),
    row("oh-house-01-2026", "house", counting(40, 59)),
  ];

  it("splits called and leading by party, with holdovers from the tables", () => {
    const seats = chamberSeats(rows, "senate");
    expect(seats.total).toBe(100);
    expect(seats.threshold).toBe(51);
    expect(seats.called).toEqual({ Democratic: 0, Republican: 1, Other: 0 });
    expect(seats.leading).toEqual({ Democratic: 2, Republican: 0, Other: 0 });
    const held =
      seats.holdovers.Democratic +
      seats.holdovers.Republican +
      seats.holdovers.Other;
    expect(held).toBeGreaterThan(60);
    expect(seats.open).toBe(100 - held - 3);
  });

  it("uses the live file's total and majority, and its count of seats not up", () => {
    const live = {
      total_seats: 100,
      threshold: 51,
      total_count: 35,
    } as LiveChamberProjection;
    const seats = chamberSeats(rows, "senate", live);
    expect(
      seats.holdovers.Democratic +
        seats.holdovers.Republican +
        seats.holdovers.Other,
    ).toBe(65);
  });

  it("has no holdovers in the House", () => {
    const seats = chamberSeats(rows, "house");
    expect(seats.holdovers).toEqual({ Democratic: 0, Republican: 0, Other: 0 });
    expect(seats.leading.Republican).toBe(1);
    expect(seats.open).toBe(434);
  });

  it("counts the 14 governors not up", () => {
    const seats = chamberSeats([], "governor");
    expect(seats.holdovers.Democratic + seats.holdovers.Republican).toBe(14);
    expect(seats.threshold).toBe(26);
    expect(seats.open).toBe(36);
  });
});

describe("countingProgress", () => {
  it("counts reporting and awaiting, and averages the share counted", () => {
    const progress = countingProgress([
      row("a", "house", counting(50, 50, 20)),
      row("b", "house", counting(50, 50, 80)),
      row("c", "house", { status: "called", pct_reporting: 99 }),
      row("d", "house", { status: "not_yet_reported" }),
      row("e", "house", null),
    ]);
    expect(progress.reporting).toBe(3);
    expect(progress.awaiting).toBe(2);
    expect(progress.counting).toBe(2);
    expect(progress.averagePct).toBe(50);
    expect(progress.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1, 0]);
  });

  it("has no average with nothing counting", () => {
    expect(countingProgress([]).averagePct).toBeNull();
  });
});

describe("closestRaces and biggestLeads", () => {
  const rows = [
    row("a", "house", counting(50.5, 49.5)),
    row("b", "house", counting(70, 30)),
    row("c", "house", counting(55, 45)),
    row("d", "house", {
      status: "called",
      candidates: [cand("X", "D", 50), cand("Y", "R", 50)],
    }),
    row("e", "house", {
      status: "counting",
      candidates: [cand("Solo", "D", 100)],
    }),
  ];

  it("orders races still counting by margin, skipping called and one-candidate races", () => {
    expect(closestRaces(rows).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(biggestLeads(rows, 2).map((r) => r.id)).toEqual(["b", "c"]);
    expect(closestRaces(rows)[0].margin).toBeCloseTo(1);
  });
});

describe("upsetWatch", () => {
  const pick = {
    predicted_winner_name: "Rob Rep",
    predicted_winner_party: "Republican",
  };

  it("flags a leader of another party, and a called upset first", () => {
    const upsets = upsetWatch([
      row("lead", "senate", counting(51, 49), pick),
      row("held", "senate", counting(40, 60), pick),
      row(
        "won",
        "senate",
        {
          status: "called",
          winner_name: "Dana Dem",
          winner_party: "Democratic",
        },
        pick,
      ),
      row("none", "senate", counting(51, 49)),
    ]);
    expect(upsets.map((u) => u.id)).toEqual(["won", "lead"]);
    expect(upsets[0]).toMatchObject({
      called: true,
      leader: "Dana Dem",
      predicted: "Rob Rep",
    });
  });

  it("compares surnames in a same-party race and ignores first-name variants", () => {
    const sameParty = {
      status: "counting" as const,
      candidates: [
        cand("Mike Rogers Jr.", "Republican", 55),
        cand("Al Other", "Republican", 45),
      ],
    };
    expect(
      upsetWatch([
        row("x", "house", sameParty, {
          predicted_winner_name: "Michael Rogers",
          predicted_winner_party: "Republican",
        }),
      ]),
    ).toEqual([]);
    expect(
      upsetWatch([
        row("y", "house", sameParty, {
          predicted_winner_name: "Al Other",
          predicted_winner_party: "Republican",
        }),
      ]).map((u) => u.id),
    ).toEqual(["y"]);
  });
});

describe("shortRaceTitle", () => {
  it("drops the year and the trailing Election", () => {
    expect(
      shortRaceTitle("2026 Alabama's 2nd Congressional District Election"),
    ).toBe("Alabama's 2nd Congressional District");
    expect(shortRaceTitle("Ohio Governor")).toBe("Ohio Governor");
  });
});

describe("toss-up placeholders", () => {
  it("are not a forecast pick", () => {
    const [race] = resultDirectory([
      {
        id: "ar-house-02-2026",
        election_date: GENERAL_ELECTION_DATE,
        forecast: { predicted_winner_party: "Toss-up" },
      },
    ]);
    expect("predicted_winner_party" in race).toBe(false);
    expect(
      upsetWatch([
        row("x", "house", counting(40, 60), {
          predicted_winner_party: "Toss-up",
        }),
      ]),
    ).toEqual([]);
  });
});
