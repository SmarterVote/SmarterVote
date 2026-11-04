import { describe, expect, it } from "vitest";
import type { PublicRaceResult } from "$lib/types";
import {
  GENERAL_ELECTION_DATE,
  calledRaceCount,
  formatPctReporting,
  isResultsSeason,
  resultDirectory,
} from "./results";

describe("isResultsSeason", () => {
  it("is off before Election Day", () => {
    expect(isResultsSeason(new Date(2026, 10, 2, 23, 59))).toBe(false);
    expect(isResultsSeason(new Date(2026, 0, 1))).toBe(false);
  });

  it("turns on at the start of Election Day, local time", () => {
    expect(GENERAL_ELECTION_DATE).toBe("2026-11-03");
    expect(isResultsSeason(new Date(2026, 10, 3, 0, 0))).toBe(true);
    expect(isResultsSeason(new Date(2026, 10, 3, 23, 30))).toBe(true);
  });

  it("stays on after Election Day", () => {
    expect(isResultsSeason(new Date(2026, 10, 4))).toBe(true);
    expect(isResultsSeason(new Date(2027, 5, 1))).toBe(true);
  });

  it("is off for an invalid clock", () => {
    expect(isResultsSeason(new Date(Number.NaN))).toBe(false);
  });
});

describe("calledRaceCount", () => {
  const row = (id: string, status: PublicRaceResult["status"]) =>
    [id, { id, status } as PublicRaceResult] as const;

  it("counts only races with a named winner", () => {
    const results = new Map([
      row("a", "called"),
      row("b", "certified"),
      row("c", "unopposed"),
      row("d", "counting"),
      row("e", "too_close"),
      row("f", "runoff_required"),
      row("g", "not_yet_reported"),
    ]);
    expect(calledRaceCount(results)).toBe(3);
  });

  it("is zero for a missing or empty file", () => {
    expect(calledRaceCount(null)).toBe(0);
    expect(calledRaceCount(undefined)).toBe(0);
    expect(calledRaceCount(new Map())).toBe(0);
  });
});

describe("formatPctReporting", () => {
  it("formats a partial count without rounding it up to 100%", () => {
    expect(formatPctReporting(10.3)).toBe("10%");
    expect(formatPctReporting(99.6)).toBe("99%");
    expect(formatPctReporting(100)).toBe("100%");
    expect(formatPctReporting(0.4)).toBe("<1%");
    expect(formatPctReporting(0)).toBe("0%");
  });

  it("is empty when the feed has no usable figure", () => {
    expect(formatPctReporting(null)).toBe("");
    expect(formatPctReporting(undefined)).toBe("");
    expect(formatPctReporting(Number.NaN)).toBe("");
    expect(formatPctReporting(-1)).toBe("");
  });
});

describe("resultDirectory", () => {
  it("normalizes postal-code states so a state is listed once", () => {
    const rows = resultDirectory([
      {
        id: "ca-governor-2026",
        title: "California Governor",
        office: "Governor",
        state: "CA",
        election_date: GENERAL_ELECTION_DATE,
      },
      {
        id: "ca-senate-2026",
        title: "California Senate",
        office: "U.S. Senate",
        state: "California",
        election_date: GENERAL_ELECTION_DATE,
      },
    ]);
    expect(rows.map((row) => row.state)).toEqual(["California", "California"]);
  });
});
