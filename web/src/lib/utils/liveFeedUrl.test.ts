import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveFeed, liveFeedUrl } from "./liveFeedUrl";
import { fetchLiveResultsFile } from "./results";
import { fetchLiveForecast } from "./liveForecast";

const ok = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;
const notOk = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

afterEach(() => vi.unstubAllEnvs());

describe("liveFeedUrl", () => {
  it("uses the Function routes when no static URL is configured", () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "");
    expect(liveFeedUrl("results-live.json")).toBe("/results-live.json");
    expect(liveFeedUrl("forecast-live.json")).toBe("/forecast-live.json");
  });

  it("uses the static URL when configured, ignoring a trailing slash", () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", " https://storage.example/feeds/ ");
    expect(liveFeedUrl("results-live.json")).toBe(
      "https://storage.example/feeds/results-live.json",
    );
  });
});

describe("fetchLiveFeed", () => {
  it("makes one request to the Function route when unconfigured", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "");
    const fetchFn = vi.fn().mockResolvedValue(notOk(503));
    const response = await fetchLiveFeed("results-live.json", fetchFn);
    expect(response.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/results-live.json");
  });

  it("reads the static file and skips the Function when it is there", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "https://storage.example/feeds");
    const fetchFn = vi.fn().mockResolvedValue(ok({}));
    await fetchLiveFeed("forecast-live.json", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://storage.example/feeds/forecast-live.json",
    );
  });

  it("falls back to the Function when the bucket file is missing", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "https://storage.example/feeds");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(notOk(404))
      .mockResolvedValueOnce(ok({}));
    const response = await fetchLiveFeed("results-live.json", fetchFn);
    expect(response.ok).toBe(true);
    expect(fetchFn).toHaveBeenLastCalledWith("/results-live.json");
  });

  it("falls back to the Function when the static fetch throws", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "https://storage.example/feeds");
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("CORS"))
      .mockResolvedValueOnce(ok({}));
    expect((await fetchLiveFeed("results-live.json", fetchFn)).ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("feed consumers with a static URL", () => {
  it("results: reads the static file", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "https://storage.example/feeds");
    const fetchFn = vi.fn().mockResolvedValue(
      ok({
        generated_at: "2026-11-04T03:00:00Z",
        races: [{ id: "a", status: "called" }],
      }),
    );
    const file = await fetchLiveResultsFile(fetchFn);
    expect(file?.results.has("a")).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://storage.example/feeds/results-live.json",
    );
  });

  it("results: both routes failing returns null, as today", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "https://storage.example/feeds");
    const fetchFn = vi.fn().mockResolvedValue(notOk(503));
    expect(await fetchLiveResultsFile(fetchFn)).toBeNull();
  });

  it("forecast: reads the static file, null when both routes fail", async () => {
    vi.stubEnv("VITE_LIVE_FEEDS_URL", "https://storage.example/feeds");
    const body = { chambers: { house: {} } };
    expect(
      await fetchLiveForecast(vi.fn().mockResolvedValue(ok(body))),
    ).toEqual(body);
    expect(
      await fetchLiveForecast(vi.fn().mockResolvedValue(notOk(503))),
    ).toBeNull();
  });
});
