import { describe, expect, it } from "vitest";
import {
  isHomepagePreviewRace,
  mergeHomepagePreviewRaces,
} from "$lib/homepagePreview";
import type { Race } from "$lib/types";

const fixtureRace = (id: string): Race => ({
  id,
  title: `Fixture race ${id}`,
  office: "U.S. Senate",
  election_date: "2026-11-03",
  updated_utc: "2026-07-11T00:00:00Z",
  schema_version: "0.3",
  contest_stage: "unknown",
  generator: [],
  polling: [],
  reviews: [],
  candidates: [],
});
const gradeAHomepageFallbacks = [fixtureRace("a"), fixtureRace("b")];

describe("homepage preview races", () => {
  it("accepts a strong reviewed race without requiring a letter grade of A", () => {
    const race = {
      ...gradeAHomepageFallbacks[0],
      validation_grade: {
        grade: "B" as const,
        score: 89,
        passed: true,
        summary: "Validated by reviewers.",
      },
    };

    expect(isHomepagePreviewRace(race)).toBe(true);
  });

  it("deduplicates races and respects the display limit", () => {
    const [first, second] = gradeAHomepageFallbacks;

    expect(mergeHomepagePreviewRaces([first, second, first], 1)).toEqual([
      first,
    ]);
  });
});
