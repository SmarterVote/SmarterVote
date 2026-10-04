import { beforeEach, describe, expect, it, vi } from "vitest";
import { FORECAST_DETAIL_FIELDS as SCRIPT_FIELDS } from "../../scripts/prepare-public-data.mjs";

const fullForecast = {
  predicted_winner_name: "Jamie Rivera",
  rating: "lean_d",
  rationale: "Rivera leads.",
  key_reasons: ["Polling advantage"],
  uncertainty: "Late undecideds.",
  market_signals: [],
  evidence_lineage: [],
  source_urls: ["https://example.com/poll"],
  panel: [],
  panel_spread: 0.04,
  model: "test-model",
  generated_at: "2026-07-01T00:00:00Z",
};

const json = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});
const notFound = { ok: false, status: 404, json: () => Promise.reject() };

describe("fetchForecastDetails", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("matches the deploy script's field list", async () => {
    const { FORECAST_DETAIL_FIELDS } = await import("./prerenderData");
    expect([...FORECAST_DETAIL_FIELDS]).toEqual(SCRIPT_FIELDS);
  });

  it("reads the small per-race payload from the site origin", async () => {
    const { fetchForecastDetails } = await import("./prerenderData");
    const fetchFn = vi.fn().mockResolvedValue(
      json({
        id: "mi-senate-2026",
        updated_utc: "2026-07-01T00:00:00Z",
        forecast: { rationale: "Rivera leads.", key_reasons: ["A"] },
      }),
    );

    await expect(
      fetchForecastDetails("mi-senate-2026", "2026-07-01T00:00:00Z", fetchFn),
    ).resolves.toEqual({ rationale: "Rivera leads.", key_reasons: ["A"] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/forecast/mi-senate-2026.json");

    // Cached per race version.
    await fetchForecastDetails(
      "mi-senate-2026",
      "2026-07-01T00:00:00Z",
      fetchFn,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the full race file when the payload is missing", async () => {
    const { fetchForecastDetails } = await import("./prerenderData");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce(
        json({ id: "mi-senate-2026", candidates: [], forecast: fullForecast }),
      );

    const details = await fetchForecastDetails(
      "mi-senate-2026",
      undefined,
      fetchFn,
    );
    expect(fetchFn).toHaveBeenLastCalledWith("/mi-senate-2026.json");
    expect(details).toMatchObject({
      rationale: "Rivera leads.",
      model: "test-model",
    });
    // Only drawer fields, not the collapsed-card ones.
    expect(details).not.toHaveProperty("predicted_winner_name");
    expect(details).not.toHaveProperty("rating");
  });

  it("falls back when the payload is from another race version", async () => {
    const { fetchForecastDetails } = await import("./prerenderData");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          id: "mi-senate-2026",
          updated_utc: "2026-06-01T00:00:00Z",
          forecast: { rationale: "Old." },
        }),
      )
      .mockResolvedValueOnce(
        json({ id: "mi-senate-2026", candidates: [], forecast: fullForecast }),
      );

    await expect(
      fetchForecastDetails("mi-senate-2026", "2026-07-01T00:00:00Z", fetchFn),
    ).resolves.toMatchObject({ rationale: "Rivera leads." });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("falls back when the payload request throws or is malformed", async () => {
    const { fetchForecastDetails } = await import("./prerenderData");
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(json({ forecast: fullForecast }))
      .mockResolvedValueOnce(json("<html>"))
      .mockResolvedValueOnce(json({ id: "b", forecast: null }));

    await expect(
      fetchForecastDetails("a", undefined, fetchFn),
    ).resolves.toEqual({
      rationale: "Rivera leads.",
      key_reasons: ["Polling advantage"],
      uncertainty: "Late undecideds.",
      market_signals: [],
      evidence_lineage: [],
      source_urls: ["https://example.com/poll"],
      panel: [],
      panel_spread: 0.04,
      model: "test-model",
      generated_at: "2026-07-01T00:00:00Z",
    });
    await expect(
      fetchForecastDetails("b", undefined, fetchFn),
    ).resolves.toEqual({});
  });

  it("retries after both requests fail", async () => {
    const { fetchForecastDetails } = await import("./prerenderData");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(json({ id: "a", forecast: { model: "m" } }));

    await expect(fetchForecastDetails("a", undefined, fetchFn)).rejects.toThrow(
      "Failed to fetch race a: 503",
    );
    await expect(
      fetchForecastDetails("a", undefined, fetchFn),
    ).resolves.toEqual({ model: "m" });
  });
});
