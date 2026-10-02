import { describe, expect, it } from "vitest";
import {
  candidateInitials,
  hasNoResearchedPositions,
  neutralCandidateOrder,
  uniqueCandidatesByName,
} from "./candidates";

describe("candidateInitials", () => {
  it.each([
    ["Jane Doe", "JD"],
    ["Ana Maria Gomez Ruiz", "AR"],
    ["Robert F. Kennedy Jr.", "RK"],
    ["Cher", "C"],
    ["  josé   peña ", "JP"],
    ["'Bud' Smith", "BS"],
    ["", ""],
  ])("%j -> %j", (name, expected) => {
    expect(candidateInitials(name)).toBe(expected);
  });
});

describe("uniqueCandidatesByName", () => {
  it("keeps the first of each exact name and preserves order", () => {
    const roster = [
      { name: "Jane Doe", id: 1 },
      { name: "John Roe", id: 2 },
      { name: "Jane Doe", id: 3 },
    ];
    expect(uniqueCandidatesByName(roster).map((c) => c.id)).toEqual([1, 2]);
    expect(uniqueCandidatesByName(null)).toEqual([]);
  });
});

describe("neutralCandidateOrder", () => {
  const names = (list: { name: string }[]) => list.map((c) => c.name);

  it("puts major parties first, the incumbent first, then last names A–Z", () => {
    const roster = [
      { name: "Zed Green", party: "Green" },
      { name: "Sam Young", party: "Democratic" },
      { name: "Ann Brown", party: "Libertarian", incumbent: false },
      { name: "Kim Adams", party: "Republican" },
      { name: "Pat Moore", party: "Republican", incumbent: true },
      { name: "Lee Carter", party: "Independent", incumbent: true },
    ];
    expect(names(neutralCandidateOrder(roster))).toEqual([
      "Pat Moore",
      "Kim Adams",
      "Sam Young",
      "Lee Carter",
      "Ann Brown",
      "Zed Green",
    ]);
  });

  it("does not depend on roster order or party", () => {
    const a = { name: "Jane Doe", party: "Democratic" };
    const b = { name: "John Abbott", party: "Republican" };
    expect(names(neutralCandidateOrder([a, b]))).toEqual(
      names(neutralCandidateOrder([b, a])),
    );
    expect(names(neutralCandidateOrder([a, b]))).toEqual([
      "John Abbott",
      "Jane Doe",
    ]);
  });

  it("ignores suffixes and case, then breaks ties by full name", () => {
    expect(
      names(
        neutralCandidateOrder([
          { name: "Robert Smith Jr.", party: "Democratic" },
          { name: "alice smith", party: "Republican" },
          { name: "Nick Begich III", party: "Republican" },
        ]),
      ),
    ).toEqual(["Nick Begich III", "alice smith", "Robert Smith Jr."]);
  });
});

describe("hasNoResearchedPositions", () => {
  it("counts only real positions", () => {
    expect(hasNoResearchedPositions({ issues: {} })).toBe(true);
    expect(
      hasNoResearchedPositions({
        issues: {
          Healthcare: {
            stance: "No public position found",
            sources: [],
            confidence: "low",
          },
          Economy: {
            stance: "No public stance found on taxes.",
            sources: [],
            confidence: "low",
          },
        },
      }),
    ).toBe(true);
    expect(
      hasNoResearchedPositions({
        issues: {
          Healthcare: {
            stance: "Supports a public option.",
            sources: [],
            confidence: "high",
          },
        },
      }),
    ).toBe(false);
  });
});
