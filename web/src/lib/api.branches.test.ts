import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_INDEX_VERSION } from "./utils/searchIndex";

// Each test gets a fresh module graph so prerenderData's summaries cache does
// not leak between cases.
async function freshApi() {
  vi.resetModules();
  return import("./api");
}

const okJson = (body: unknown) => ({
  ok: true,
  json: () => Promise.resolve(body),
});

const summary = {
  id: "tx-senate-2026",
  title: "Texas Senate",
  office: "U.S. Senate",
  election_date: "2026-11-03",
  updated_utc: "2026-07-01T00:00:00Z",
  candidates: [{ name: "Alex Example", incumbent: false }],
};

describe("api.ts error and fallback branches", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("$lib/stores/apiStore");
  });

  it("rejects a non-ok race response with its status", async () => {
    const { getRace } = await freshApi();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(getRace("x", fetchFn, false)).rejects.toThrow(/503/);
  });

  it("builds summaries from sample races when the fallback is enabled", async () => {
    const { getRaceSummaries } = await freshApi();
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));
    const summaries = await getRaceSummaries(fetchFn, true);
    const mo = summaries.find((race) => race.id === "mo-senate-2024");
    expect(mo?.candidates.length).toBeGreaterThan(0);
    expect(Object.keys(mo?.candidates[0] ?? {})).toEqual([
      "name",
      "party",
      "incumbent",
      "image_url",
    ]);
  });

  it("returns a valid prebuilt search index without loading summaries", async () => {
    const { getSearchIndex } = await freshApi();
    const index = {
      v: SEARCH_INDEX_VERSION,
      races: [{ i: "tx-senate-2026" }],
    };
    const fetchFn = vi.fn().mockResolvedValue(okJson(index));
    await expect(getSearchIndex(fetchFn)).resolves.toEqual(index);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/search-index.json");
  });

  it.each([
    ["a stale index version", okJson({ v: -1, races: [{}] })],
    ["an empty index", okJson({ v: SEARCH_INDEX_VERSION, races: [] })],
    ["a missing index file", { ok: false, status: 404 }],
  ])("rebuilds the search index from summaries for %s", async (_, first) => {
    const { getSearchIndex } = await freshApi();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(okJson([summary]));
    const index = await getSearchIndex(fetchFn);
    expect(index.v).toBe(SEARCH_INDEX_VERSION);
    expect(index.races).toHaveLength(1);
    expect(fetchFn).toHaveBeenLastCalledWith("/summaries.json");
  });

  it("rebuilds the search index when its request throws", async () => {
    const { getSearchIndex } = await freshApi();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(okJson([summary]));
    expect((await getSearchIndex(fetchFn)).races).toHaveLength(1);
  });

  it("rejects a failed draft request with its status", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.doMock("$lib/stores/apiStore", () => ({ fetchWithAuth }));
    const { getDraftRace } = await freshApi();
    await expect(getDraftRace("x y")).rejects.toThrow(/403/);
    expect(fetchWithAuth.mock.calls[0][0]).toContain("/api/races/x%20y/data");
  });
});
