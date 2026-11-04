import { render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForecastLiveProjection from "./ForecastLiveProjection.svelte";
import type { LiveChamberProjection, LiveForecastFile } from "$lib/types";
import {
  fetchLiveForecast,
  fetchLiveForecastSnapshot,
  formatLiveControlProbability,
  liveChamberProjection,
  swingPosteriorNote,
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
    expect(screen.getByText("4 of 35 Senate races called")).toBeTruthy();
    expect(screen.getByText("62.0%")).toBeTruthy();
    expect(screen.getByText("Republican")).toBeTruthy();
    expect(screen.getByText("51R-49D")).toBeTruthy();
    const footnote = screen.getByText(/Called races count as decided/);
    expect(footnote.textContent).toMatch(/pre-election\s+forecast\. As of \S/);
    expect(footnote.textContent).not.toMatch(/forecast\.As of/);
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

  it("shows live seats and the pre-election odds beside the live ones", () => {
    render(ForecastLiveProjection, {
      props: {
        projection: senate,
        activeTab: "senate",
        preElectionProbability: 0.55,
        preElectionParty: "Democratic",
      },
    });
    expect(screen.getByText("Live projected seats")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /^Live projected seats: Democratic 49/ }),
    ).toBeTruthy();
    expect(
      screen.getByTestId("forecast-live-pre-election").textContent,
    ).toMatch(/Pre-election: 55\.0%\s+Democratic/);
  });
});

describe("swingPosteriorNote", () => {
  it("names the direction and the number of calls", () => {
    expect(
      swingPosteriorNote({
        mean_logit: -0.49,
        sd_logit: 0.41,
        informative_calls: 52,
        calls: 102,
        direction: "Democratic",
      }),
    ).toBe(
      "National swing estimated from 102 called races across the House, Senate and governors: results so far point to polls underestimating Democrats.",
    );
    expect(
      swingPosteriorNote({
        mean_logit: 0.03,
        sd_logit: 0.3,
        informative_calls: 6,
      }),
    ).toBe(
      "National swing estimated from 6 called races across the House, Senate and governors: results so far point to polls being about right.",
    );
    expect(
      swingPosteriorNote({
        mean_logit: 0.4,
        sd_logit: 0.3,
        informative_calls: 6,
      }),
    ).toMatch(/underestimating Republicans\.$/);
  });

  it("shows nothing without a usable update", () => {
    expect(swingPosteriorNote(undefined)).toBeNull();
    expect(swingPosteriorNote(null)).toBeNull();
    expect(
      swingPosteriorNote({
        mean_logit: Number.NaN,
        sd_logit: 0.3,
        informative_calls: 6,
      }),
    ).toBeNull();
  });

  it("renders the note on the live card only when the feed has one", () => {
    const { unmount } = render(ForecastLiveProjection, {
      props: { projection: senate },
    });
    expect(screen.queryByTestId("forecast-live-swing")).toBeNull();
    unmount();
    render(ForecastLiveProjection, {
      props: {
        projection: senate,
        swingPosterior: {
          mean_logit: 0.02,
          sd_logit: 0.2,
          informative_calls: 9,
          direction: "accurate",
        },
      },
    });
    expect(screen.getByTestId("forecast-live-swing").textContent).toMatch(
      /National swing estimated from 9 called races across the House, Senate and governors: results so far point to polls being about right\./,
    );
  });
});

describe("ForecastLiveProjection on the governors tab", () => {
  const governors: LiveChamberProjection = {
    control_party: "Democratic",
    control_probability: 0.99,
    outcome_probabilities: { Democratic: 0.99, Republican: 0.01 },
    projected_seats: { Democratic: 30, Republican: 20, Other: 0 },
    seat_distribution: { "30D-20R": 0.47, "29D-21R": 0.34 },
    threshold: 26,
    total_seats: 50,
    called_count: 26,
    total_count: 36,
    as_of: "2026-11-04T03:00:00Z",
  };

  it("counts governorships instead of claiming control of a chamber", () => {
    render(ForecastLiveProjection, {
      props: { projection: governors, activeTab: "governors" },
    });
    expect(screen.getByText("26 of 36 governor races called")).toBeTruthy();
    expect(screen.getByText("Chance of most governorships")).toBeTruthy();
    expect(screen.queryByText("Control chance")).toBeNull();
    expect(
      screen.getByTestId("forecast-live-governorships").textContent?.trim(),
    ).toBe("D 30 · R 20");
    expect(screen.getByText("Most (26)")).toBeTruthy();
    expect(screen.queryByText(/Majority/)).toBeNull();
  });
});

describe("fetchLiveForecastSnapshot", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("skips the build-time read when only the root Function route exists", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "");
    const fetchFn = vi.fn(respond(file({ senate })));
    expect(await fetchLiveForecastSnapshot(fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reads the static bucket copy and fails closed", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "https://storage.example/feeds");
    const body = file({ senate });
    const fetchFn = vi.fn(respond(body));
    expect(await fetchLiveForecastSnapshot(fetchFn)).toEqual(body);
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://storage.example/feeds/forecast-live.json",
    );
    expect(await fetchLiveForecastSnapshot(respond(body, false))).toBeNull();
    expect(await fetchLiveForecastSnapshot(respond({ nope: 1 }))).toBeNull();
    const failing = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect(await fetchLiveForecastSnapshot(failing)).toBeNull();
  });
});
