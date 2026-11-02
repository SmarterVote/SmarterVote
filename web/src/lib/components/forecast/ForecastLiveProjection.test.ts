import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ForecastLiveProjection from "./ForecastLiveProjection.svelte";
import type { LiveChamberProjection, LiveForecastFile } from "$lib/types";
import {
  fetchLiveForecast,
  formatLiveControlProbability,
  liveChamberProjection,
} from "$lib/utils/liveForecast";

const senate: LiveChamberProjection = {
  control_party: "Republican",
  control_probability: 0.62,
  outcome_probabilities: { Democratic: 0.38, Republican: 0.62 },
  projected_seats: { Democratic: 49, Republican: 51, Other: 0 },
  seat_distribution: { "51R-49D": 0.3, "50R-50D": 0.2, "52R-48D": 0.1 },
  threshold: 51,
  total_seats: 100,
  vp_tiebreak_party: "Republican",
  called_count: 4,
  total_count: 35,
  as_of: "2026-11-04T03:00:00Z",
};

function file(
  chambers: LiveForecastFile["chambers"],
  overrides: Partial<LiveForecastFile> = {},
): LiveForecastFile {
  return {
    schema_version: "forecast_live.v1",
    results_updated_at: "2026-11-04T03:01:00Z",
    generated_at: "2026-11-04T03:01:30Z",
    chambers,
    ...overrides,
  };
}

function respond(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

describe("liveChamberProjection", () => {
  it("returns the chamber once a race in it is called", () => {
    expect(liveChamberProjection(file({ senate }), "senate")).toEqual(senate);
  });

  it("shows nothing before any call, for another chamber, or without a file", () => {
    expect(
      liveChamberProjection(
        file({ senate: { ...senate, called_count: 0 } }),
        "senate",
      ),
    ).toBeNull();
    expect(liveChamberProjection(file({ senate }), "house")).toBeNull();
    expect(liveChamberProjection(null, "senate")).toBeNull();
    expect(liveChamberProjection(undefined, "senate")).toBeNull();
  });

  it("fails closed on a malformed row", () => {
    const bad: Partial<LiveChamberProjection>[] = [
      { control_probability: Number.NaN },
      { control_probability: 1.2 },
      { called_count: 36 },
      { called_count: 1.5 },
      { seat_distribution: undefined },
    ];
    for (const override of bad) {
      expect(
        liveChamberProjection(
          file({ senate: { ...senate, ...override } as LiveChamberProjection }),
          "senate",
        ),
      ).toBeNull();
    }
  });
});

describe("fetchLiveForecast", () => {
  it("reads the edge file", async () => {
    const body = file({ senate });
    expect(await fetchLiveForecast(respond(body))).toEqual(body);
  });

  it("returns null on an error status, a bad body, or a network failure", async () => {
    expect(
      await fetchLiveForecast(respond(file({ senate }), false)),
    ).toBeNull();
    expect(await fetchLiveForecast(respond({ error: "x" }))).toBeNull();
    expect(await fetchLiveForecast(respond(null))).toBeNull();
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchLiveForecast(failing)).toBeNull();
  });
});

describe("formatLiveControlProbability", () => {
  it("reads a settled outcome exactly and keeps the usual bounds otherwise", () => {
    expect(formatLiveControlProbability(1)).toBe("100%");
    expect(formatLiveControlProbability(0)).toBe("0%");
    expect(formatLiveControlProbability(0.9999)).toBe(">99.9%");
    expect(formatLiveControlProbability(0.0001)).toBe("<0.1%");
    expect(formatLiveControlProbability(0.62)).toBe("62.0%");
  });
});

describe("ForecastLiveProjection", () => {
  it("shows the live odds, the likeliest split, and how many races are called", () => {
    render(ForecastLiveProjection, { props: { projection: senate } });
    expect(screen.getByText("Live projection")).toBeTruthy();
    expect(screen.getByText("4 of 35 races called")).toBeTruthy();
    expect(screen.getByText("62.0%")).toBeTruthy();
    expect(screen.getByText("Republican")).toBeTruthy();
    expect(screen.getByText("51R-49D")).toBeTruthy();
    expect(screen.getByText(/Called races count as decided/)).toBeTruthy();
    expect(screen.getByText(/As of /)).toBeTruthy();
  });

  it("falls back to the results file time and omits a missing time", () => {
    const { unmount } = render(ForecastLiveProjection, {
      props: {
        projection: { ...senate, as_of: null },
        resultsUpdatedAt: "2026-11-04T03:01:00Z",
      },
    });
    expect(screen.getByText(/As of /)).toBeTruthy();
    unmount();
    render(ForecastLiveProjection, {
      props: { projection: { ...senate, as_of: null } },
    });
    expect(screen.queryByText(/As of /)).toBeNull();
  });
});
