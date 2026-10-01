import { describe, expect, it } from "vitest";
import { candidateInitials, uniqueCandidatesByName } from "./candidates";

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
