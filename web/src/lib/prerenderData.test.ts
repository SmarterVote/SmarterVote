import { beforeEach, describe, expect, it, vi } from "vitest";

describe("published data request caches", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("retries summaries after a failed request", async () => {
    const { fetchPublishedRaceSummaries } = await import("./prerenderData");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: "retry-race" }]),
      });

    await expect(fetchPublishedRaceSummaries(fetchFn)).rejects.toThrow(
      "Failed to fetch race summaries: 503",
    );
    await expect(fetchPublishedRaceSummaries(fetchFn)).resolves.toEqual([
      { id: "retry-race" },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries an individual race after a failed request", async () => {
    const { fetchPublishedRace } = await import("./prerenderData");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "retry-race", candidates: [] }),
      });

    await expect(fetchPublishedRace("retry-race", fetchFn)).rejects.toThrow(
      "Failed to fetch race retry-race: 404",
    );
    await expect(
      fetchPublishedRace("retry-race", fetchFn),
    ).resolves.toMatchObject({ id: "retry-race" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("refreshPrerenderedRaces", () => {
  const race = (id: string) =>
    ({
      id,
      title: id,
      office: "U.S. Senate",
      election_date: "2026-11-03",
      updated_utc: "2026-07-01T00:00:00Z",
      candidates: [],
    }) as import("$lib/types").RaceSummary;
  const identity = <T>(races: T) => races;

  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps the prerendered races when the refresh fails", async () => {
    const { refreshPrerenderedRaces } = await import("./prerenderData");
    const prerendered = { races: [race("a")], loadError: false };
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      refreshPrerenderedRaces(prerendered, identity, fetchFn),
    ).resolves.toBe(prerendered);
  });

  it("keeps the prerendered races when the refresh returns a non-OK status", async () => {
    const { refreshPrerenderedRaces } = await import("./prerenderData");
    const prerendered = { races: [race("a")], loadError: false };
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(
      refreshPrerenderedRaces(prerendered, identity, fetchFn),
    ).resolves.toBe(prerendered);
  });

  it("does not replace good prerendered races with an empty refresh", async () => {
    const { refreshPrerenderedRaces } = await import("./prerenderData");
    const prerendered = { races: [race("a")], loadError: false };
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

    await expect(
      refreshPrerenderedRaces(prerendered, identity, fetchFn),
    ).resolves.toBe(prerendered);
  });

  it("adopts fresher races and clears a build-time load error", async () => {
    const { refreshPrerenderedRaces } = await import("./prerenderData");
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([race("a"), race("b")]),
    });

    const result = await refreshPrerenderedRaces(
      { races: [], loadError: true },
      identity,
      fetchFn,
    );
    expect(result.loadError).toBe(false);
    expect(result.races.map(({ id }) => id)).toEqual(["a", "b"]);
  });
});
