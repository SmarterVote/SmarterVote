import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getDraftRace, getRace, getRaceSummaries } from "./api";
import { sampleRaces } from "./sampleData";

describe("API Fallback Functionality", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("should return live data when static file is available", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "test-race",
          title: "Live Data Race",
          candidates: [],
        }),
    });

    const result = await getRace("test-race", mockFetch);

    expect(result.title).toBe("Live Data Race");
    expect(mockFetch).toHaveBeenCalledWith("/test-race.json");
  });

  it("should fallback to sample data when API fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await getRace("mo-senate-2024", mockFetch, true);

    expect(result.id).toBe("mo-senate-2024");
    expect(result.title).toBe("Missouri U.S. Senate Race 2024");
    expect(result.jurisdiction).toBe("Missouri");
  });

  it("uses static race data only when VITE_PUBLIC_DATA_URL is configured", async () => {
    vi.stubEnv("VITE_PUBLIC_DATA_URL", "https://static.example/races");
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "test-race", candidates: [] }),
    });

    const result = await getRace("test-race", mockFetch, false);

    expect(result.id).toBe("test-race");
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://static.example/races/test-race.json",
    );
  });

  it("throws when static summaries are unavailable in GCS mode", async () => {
    vi.stubEnv("VITE_PUBLIC_DATA_URL", "https://static.example/races");
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(getRaceSummaries(mockFetch, false)).rejects.toThrow(
      "Static data request failed: 404",
    );
  });

  it("fetches draft races through the lazily loaded auth fetcher", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "draft-race", candidates: [] }),
    });
    vi.doMock("$lib/stores/apiStore", () => ({ fetchWithAuth }));
    try {
      const result = await getDraftRace("draft-race");
      expect(result.id).toBe("draft-race");
      expect(fetchWithAuth.mock.calls[0][0]).toContain(
        "/api/races/draft-race/data?draft=true",
      );
    } finally {
      vi.doUnmock("$lib/stores/apiStore");
    }
  });

  it("keeps the public fetch module free of static auth imports", async () => {
    const { default: source } = await import("./api.ts?raw");
    expect(source).not.toMatch(/^import[^;]*(\$lib\/auth|apiStore|auth0)/m);
    expect(source).not.toMatch(/^import[^;]*sampleData/m);
  });

  it("should not show generic sample data for unknown race IDs", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(getRace("unknown-race", mockFetch, true)).rejects.toThrow(
      "Network error",
    );
  });

  it("should throw error when fallback is disabled", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(getRace("test-race", mockFetch, false)).rejects.toThrow(
      "Network error",
    );
  });

  it("should have all required sample races", () => {
    const expectedRaces = [
      "mo-senate-2024",
      "ca-senate-2024",
      "ny-house-03-2024",
      "tx-governor-2024",
    ];

    expectedRaces.forEach((raceId) => {
      expect(sampleRaces[raceId]).toBeDefined();
      expect(sampleRaces[raceId].id).toBe(raceId);
    });
  });
});
