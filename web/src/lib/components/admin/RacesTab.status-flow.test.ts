import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { RaceRecord } from "$lib/types";

function makeRace(overrides: Partial<RaceRecord> = {}): RaceRecord {
  return {
    race_id: "ga-senate-2026",
    title: "Georgia Senate 2026",
    office: "Senate",
    jurisdiction: "Georgia",
    election_date: "2026-11-03",
    status: "empty",
    published_at: undefined,
    draft_updated_at: undefined,
    candidate_count: 2,
    quality_score: 78,
    freshness: "recent",
    total_runs: 0,
    requests_24h: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("RacesTab status flow", () => {
  let rows: RaceRecord[] = [];
  let mockFetchWithAuth: any;
  let openSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    vi.resetModules();

    mockFetchWithAuth = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ races: rows }),
    }));

    vi.doMock("$lib/stores/apiStore", () => {
      return {
        fetchWithAuth: mockFetchWithAuth,
      };
    });

    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    openSpy.mockRestore();
    vi.doUnmock("$lib/stores/apiStore");
  });

  async function renderTab() {
    const module = await import("./RacesTab.svelte");
    return render(module.default);
  }

  it("shows row publish action when status is draft even without draft_updated_at", async () => {
    rows = [
      makeRace({
        race_id: "draft-no-ts",
        status: "draft",
        draft_updated_at: undefined,
        published_at: undefined,
      }),
    ];

    const { component, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled());
    await waitFor(() => expect(getByText("draft-no-ts")).toBeTruthy());
    expect(getByText("Publish")).toBeTruthy();
  });

  it("includes draft-without-timestamp in bulk publish selection", async () => {
    rows = [
      makeRace({
        race_id: "draft-no-ts",
        status: "draft",
        draft_updated_at: undefined,
        published_at: undefined,
      }),
    ];

    const { component, getAllByRole, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled());
    await waitFor(() => expect(getByText("draft-no-ts")).toBeTruthy());

    const checkboxes = getAllByRole("checkbox");
    await fireEvent.click(checkboxes[1]);

    await waitFor(() => expect(getByText("Publish 1 Draft")).toBeTruthy());
  });

  it("shows publish and unpublish for published races with newer drafts", async () => {
    rows = [
      makeRace({
        race_id: "pub-with-newer-draft",
        status: "published",
        published_at: "2026-03-01T00:00:00Z",
        draft_updated_at: "2026-03-02T00:00:00Z",
      }),
    ];

    const { component, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled());
    await waitFor(() => expect(getByText("pub-with-newer-draft")).toBeTruthy());

    expect(getByText("Publish")).toBeTruthy();
    expect(getByText("Unpublish")).toBeTruthy();
  });

  it("does not publish or open draft previews from stale draft metadata", async () => {
    rows = [
      makeRace({
        race_id: "stale-draft-metadata",
        status: "published",
        published_at: "2026-03-01T00:00:00Z",
        draft_updated_at: "2026-03-02T00:00:00Z",
        draft_exists: false,
        published_exists: true,
      }),
    ];

    const { component, getByText, queryByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("stale-draft-metadata")).toBeTruthy());

    expect(queryByText("Publish")).toBeNull();

    await fireEvent.click(getByText("View Page"));
    expect(openSpy).toHaveBeenCalledWith("/races/stale-draft-metadata", "_blank");
  });

  it("opens draft previews only when storage confirms a draft exists", async () => {
    rows = [
      makeRace({
        race_id: "active-draft",
        status: "draft",
        draft_exists: true,
        published_exists: false,
      }),
    ];

    const { component, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("active-draft")).toBeTruthy());

    await fireEvent.click(getByText("View Draft"));
    expect(openSpy).toHaveBeenCalledWith("/races/active-draft?draft=true", "_blank");
  });
});
