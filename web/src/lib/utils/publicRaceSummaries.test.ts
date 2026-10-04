import { describe, expect, it } from "vitest";
import type { RaceSummary } from "$lib/types";
import {
  toDirectoryRaceSummaries,
  toForecastRaceSummaries,
  toForecastSummary,
} from "./publicRaceSummaries";

const summary: RaceSummary = {
  id: "tx-senate-2026",
  title: "Texas Senate",
  office: "U.S. Senate",
  jurisdiction: "Texas",
  state: "Texas",
  election_date: "2026-11-03",
  updated_utc: "2026-07-01T00:00:00Z",
  candidates: [{ name: "Alex Example", incumbent: false }],
  quality_grade: "A",
  agent_metrics: { estimated_usd: 1.23 },
  forecast: {
    rating: "tossup",
    party_probabilities: { Democratic: 0.5, Republican: 0.5 },
    confidence: "low",
    rationale: "A deliberately large forecast explanation.",
    based_on_poll_count: 0,
    generated_at: "2026-07-01T00:00:00Z",
    model: "example-model",
    source_urls: [],
    key_reasons: [],
    market_signals: [],
  },
};

describe("public race summary payloads", () => {
  it("omits forecast and internal metadata from directory payloads", () => {
    expect(toDirectoryRaceSummaries([summary])).toEqual([
      {
        id: summary.id,
        title: summary.title,
        office: summary.office,
        jurisdiction: summary.jurisdiction,
        state: summary.state,
        contest_stage: undefined,
        election_date: summary.election_date,
        updated_utc: summary.updated_utc,
        candidates: summary.candidates,
      },
    ]);
  });

  it("keeps the collapsed-card forecast fields and drops drawer-only and internal data", () => {
    const [race] = toForecastRaceSummaries([
      {
        ...summary,
        forecast: {
          ...summary.forecast!,
          predicted_winner_name: "Alex Example",
          win_probability: 0.5,
          margin_estimate: 0.4,
          key_reasons: ["A reason"],
          uncertainty: "Some uncertainty",
          source_urls: ["https://example.com"],
        },
      },
    ]);
    expect(race.forecast).toEqual({
      predicted_winner_name: "Alex Example",
      win_probability: 0.5,
      party_probabilities: { Democratic: 0.5, Republican: 0.5 },
      margin_estimate: 0.4,
      rating: "tossup",
      // No takeaway was published, so the card's first-sentence fallback is
      // precomputed from the rationale it no longer carries.
      takeaway: "A deliberately large forecast explanation.",
      based_on_poll_count: 0,
    });
    expect(race).not.toHaveProperty("agent_metrics");
    expect(race).not.toHaveProperty("quality_grade");
    expect(race.candidates).toEqual([
      { name: "Alex Example", party: undefined, incumbent: false },
    ]);
  });

  it("keeps a published takeaway and races without a forecast", () => {
    const [withTakeaway, withoutForecast] = toForecastRaceSummaries([
      {
        ...summary,
        forecast: { ...summary.forecast!, takeaway: "Published takeaway." },
      },
      { ...summary, id: "tx-house-01-2026", forecast: null },
    ]);
    expect(withTakeaway.forecast?.takeaway).toBe("Published takeaway.");
    expect(withoutForecast).not.toHaveProperty("forecast");
  });

  it("compacts an API summary forecast whose scalars are null", () => {
    expect(
      toForecastSummary({
        predicted_winner_name: null,
        predicted_winner_party: null,
        win_probability: null,
        party_probabilities: {},
        margin_estimate: null,
        rating: null,
        rationale: null,
        takeaway: null,
        based_on_poll_count: 0,
        method: null,
        panel: null,
        panel_spread: null,
      }),
    ).toEqual({
      predicted_winner_name: null,
      predicted_winner_party: null,
      win_probability: null,
      party_probabilities: {},
      margin_estimate: null,
      rating: null,
      based_on_poll_count: 0,
    });
    expect(toForecastSummary(null)).toBeNull();
  });
});
