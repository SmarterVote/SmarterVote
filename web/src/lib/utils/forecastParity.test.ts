import { describe, expect, it } from "vitest";
import type { RaceSummary } from "$lib/types";
import { aggregateForecasts, type ForecastTab } from "./forecast";
import fixture from "./__fixtures__/forecast_parity.json";

interface ParityCase {
  name: string;
  chamber: ForecastTab;
  races: unknown[];
  expected: {
    Democratic: number;
    Republican: number;
    Other: number;
    uncounted: number;
  };
}

/**
 * The same fixture drives `test_projected_seats_match_the_shared_parity_fixture`
 * in tests/test_forecast_summary.py. The forecast page and the chamber summary
 * the API publishes must count every one of these seats for the same party.
 */
describe("forecast seat parity with shared/forecast_summary.py", () => {
  const cases = (fixture as { cases: ParityCase[] }).cases;

  it("has cases to check", () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  for (const parityCase of cases) {
    it(parityCase.name, () => {
      const aggregate = aggregateForecasts(
        parityCase.races as RaceSummary[],
        parityCase.chamber,
      );
      expect({
        Democratic: aggregate.projected.Democratic ?? 0,
        Republican: aggregate.projected.Republican ?? 0,
        Other: aggregate.projected.Other ?? 0,
        uncounted: aggregate.uncountedSeats ?? 0,
      }).toEqual(parityCase.expected);
    });
  }
});
