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
    freshness: "recent",
    total_runs: 0,
    requests_24h: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("RacesTab preview and render flow", () => {
  let rows: RaceRecord[] = [];
  let mockFetchWithAuth: any;
  let openSpy: any;
  let confirmSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];

    mockFetchWithAuth ??= vi.fn();
    mockFetchWithAuth.mockReset();
    mockFetchWithAuth.mockImplementation(
      async (url: string, options?: RequestInit) => {
        if (url.includes("/api/races/queue") && options?.method === "POST") {
          const body = JSON.parse(String(options.body ?? "{}"));
          return jsonResponse({
            added: (body.race_ids ?? []).map((race_id: string) => ({
              race_id,
              status: "pending",
            })),
            errors: [],
          });
        }
        if (url.endsWith("/api/races/publish") && options?.method === "POST") {
          const body = JSON.parse(String(options.body ?? "{}"));
          return jsonResponse({ published: body.race_ids ?? [], errors: [] });
        }
        return jsonResponse({ races: rows });
      },
    );

    vi.doMock("$lib/stores/apiStore", () => {
      return {
        fetchWithAuth: mockFetchWithAuth,
      };
    });

    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    openSpy.mockRestore();
    confirmSpy.mockRestore();
    vi.doUnmock("$lib/stores/apiStore");
  });

  async function renderTab() {
    const module = await import("./RacesTab.svelte");
    return render(module.default);
  }

  async function chooseAction(
    getByLabelText: (text: string) => HTMLElement,
    raceId: string,
    value: string,
  ) {
    await fireEvent.change(getByLabelText(`Actions for ${raceId}`), {
      target: { value },
    });
    await fireEvent.click(getByLabelText(`Run selected action for ${raceId}`));
  }

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: async () => body,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    };
  }

  it("renders the list of races successfully", async () => {
    rows = [
      makeRace({
        race_id: "ga-senate-2026",
        status: "published",
        published_at: "2026-03-01T00:00:00Z",
      }),
    ];

    const { component, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled());
    await waitFor(() => expect(getByText("ga-senate-2026")).toBeTruthy());
  });

  it("opens draft preview when draft exists", async () => {
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
    expect(openSpy).toHaveBeenCalledWith(
      "/races/active-draft?draft=true",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens normal page preview when published and no newer draft exists", async () => {
    rows = [
      makeRace({
        race_id: "published-only",
        status: "published",
        draft_exists: false,
        published_exists: true,
      }),
    ];

    const { component, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("published-only")).toBeTruthy());

    await fireEvent.click(getByText("View Page"));
    expect(openSpy).toHaveBeenCalledWith(
      "/races/published-only",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not act when the action selector merely changes", async () => {
    rows = [makeRace({ race_id: "ready-to-run" })];

    const { component, getByLabelText, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("ready-to-run")).toBeTruthy());
    const callsBefore = mockFetchWithAuth.mock.calls.length;

    // Arrow-key navigation fires change events; that must not queue work.
    await fireEvent.change(getByLabelText("Actions for ready-to-run"), {
      target: { value: "run" },
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockFetchWithAuth.mock.calls.length).toBe(callsBefore);
  });

  it("queues the lightweight refresh (not full research) from the action selector", async () => {
    rows = [makeRace({ race_id: "ready-to-run" })];

    const { component, getByLabelText, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("ready-to-run")).toBeTruthy());

    await chooseAction(getByLabelText, "ready-to-run", "run");

    await waitFor(() =>
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/races\/queue$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const queueCall = mockFetchWithAuth.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("/api/races/queue"),
    );
    const body = JSON.parse(String(queueCall[1].body));
    expect(body.race_ids).toEqual(["ready-to-run"]);
    expect(body.options.enabled_steps).toEqual([
      "discovery",
      "images",
      "polling",
      "forecast",
      "voter_resources",
    ]);
    expect(body.options.model_profile).toBe("default");
    expect(confirmSpy.mock.calls[0][0]).toMatch(/Estimated cost: ~\$0\.09/);
    await waitFor(() =>
      expect(
        getByText(/ready-to-run was added to the pipeline queue/),
      ).toBeTruthy(),
    );
  });

  it("reports row queue API partial failures as errors", async () => {
    rows = [makeRace({ race_id: "stuck-race" })];
    mockFetchWithAuth.mockImplementation(async (url: string) => {
      if (url.includes("/api/races/queue")) {
        return jsonResponse({
          added: [],
          errors: [{ race_id: "stuck-race", error: "Race is already running" }],
        });
      }
      return jsonResponse({ races: rows });
    });

    const { component, getByLabelText, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("stuck-race")).toBeTruthy());

    await chooseAction(getByLabelText, "stuck-race", "run");

    await waitFor(() =>
      expect(getByText(/Queue failed for stuck-race/)).toBeTruthy(),
    );
    expect(getByText(/Race is already running/)).toBeTruthy();
  });

  it("publishes, unpublishes, rechecks, cancels, and deletes row actions", async () => {
    rows = [
      makeRace({
        race_id: "row-action-race",
        status: "running",
        draft_exists: true,
        published_exists: true,
        draft_updated_at: "2026-02-01T00:00:00Z",
        published_at: "2026-01-01T00:00:00Z",
      }),
    ];

    const { component, getByLabelText, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("row-action-race")).toBeTruthy());

    const act = (value: string) =>
      chooseAction(getByLabelText, "row-action-race", value);

    await act("publish");
    await waitFor(() => expect(getByText(/was published/)).toBeTruthy());
    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/races\/row-action-race\/publish$/),
      { method: "POST" },
      expect.any(Number),
    );

    await act("unpublish");
    await waitFor(() => expect(getByText(/was unpublished/)).toBeTruthy());

    await act("recheck");
    await waitFor(() => expect(getByText(/was rechecked/)).toBeTruthy());

    await act("cancel");
    await waitFor(() => expect(getByText(/was cancelled/)).toBeTruthy());

    await act("delete");
    await waitFor(() =>
      expect(getByText(/stored data were deleted/)).toBeTruthy(),
    );
  });

  it("offers cancel instead of queue for an active race", async () => {
    rows = [makeRace({ race_id: "active-race", status: "running" })];

    const { component, getByLabelText, getByText, queryByText } =
      await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("active-race")).toBeTruthy());

    expect(queryByText(/Queue refresh/)).toBeNull();
    await chooseAction(getByLabelText, "active-race", "cancel");

    await waitFor(() =>
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/races\/active-race\/cancel$/),
        { method: "POST" },
        expect.any(Number),
      ),
    );
  });

  it("reports batch queue partial failures inline and clears selected rows", async () => {
    rows = [
      makeRace({ race_id: "batch-ok" }),
      makeRace({ race_id: "batch-bad" }),
    ];
    mockFetchWithAuth.mockImplementation(
      async (url: string, options?: RequestInit) => {
        if (url.includes("/api/races/queue") && options?.method === "POST") {
          return jsonResponse({
            added: [{ race_id: "batch-ok", status: "pending" }],
            errors: [{ race_id: "batch-bad", error: "Race is already queued" }],
          });
        }
        return jsonResponse({ races: rows });
      },
    );

    const { component, getAllByLabelText, getByText, queryByText } =
      await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("batch-ok")).toBeTruthy());

    for (const checkbox of getAllByLabelText(/^Select row /)) {
      await fireEvent.click(checkbox);
    }

    await fireEvent.click(getByText("Batch Refresh"));

    await waitFor(() =>
      expect(getByText(/Queued 1 of 2 selected race/)).toBeTruthy(),
    );
    expect(getByText(/batch-bad: Race is already queued/)).toBeTruthy();
    await waitFor(() => expect(queryByText(/2 races selected/)).toBeNull());
  });

  it("reports batch publish and delete failures inline", async () => {
    rows = [
      makeRace({ race_id: "batch-one", draft_exists: true }),
      makeRace({ race_id: "batch-two", draft_exists: true }),
    ];
    mockFetchWithAuth.mockImplementation(
      async (url: string, options?: RequestInit) => {
        if (url.endsWith("/api/races/publish") && options?.method === "POST") {
          return jsonResponse({
            published: ["batch-one"],
            errors: [{ race_id: "batch-two", error: "Draft not found" }],
          });
        }
        if (url.includes("/batch-two") && options?.method === "DELETE") {
          return jsonResponse("delete failed", false, 500);
        }
        return jsonResponse({ races: rows });
      },
    );

    const { component, getAllByLabelText, getByText } = await renderTab();

    await component.refresh();
    await waitFor(() => expect(getByText("batch-one")).toBeTruthy());

    for (const checkbox of getAllByLabelText(/^Select row /)) {
      await fireEvent.click(checkbox);
    }

    await fireEvent.click(getByText("Batch Publish"));
    await waitFor(() => expect(getByText(/Published 1 of 2/)).toBeTruthy());
    expect(getByText(/batch-two: Draft not found/)).toBeTruthy();

    for (const checkbox of getAllByLabelText(/^Select row /)) {
      await fireEvent.click(checkbox);
    }

    await fireEvent.click(getByText("Batch Delete"));
    await waitFor(() => expect(getByText(/Deleted 1 of 2/)).toBeTruthy());
    expect(getByText(/Failures: batch-two/)).toBeTruthy();
  });

  it("queues full research only when chosen explicitly, with the combined step list", async () => {
    rows = [makeRace({ race_id: "deep-race", candidate_count: 3 })];

    const { component, getByLabelText, getByText } = await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("deep-race")).toBeTruthy());

    await chooseAction(getByLabelText, "deep-race", "run-full");

    await waitFor(() =>
      expect(
        mockFetchWithAuth.mock.calls.some((c: unknown[]) =>
          String(c[0]).includes("/api/races/queue"),
        ),
      ).toBe(true),
    );
    const queueCall = mockFetchWithAuth.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("/api/races/queue"),
    );
    const body = JSON.parse(String(queueCall[1].body));
    expect(body.options.enabled_steps).toEqual([
      "issues",
      "finance",
      "refinement",
      "polling",
      "forecast",
      "voter_resources",
      "review",
      "iteration",
    ]);
    expect(body.options.baseline_source).toBe("latest");
    expect(confirmSpy.mock.calls[0][0]).toMatch(/FULL issue research/);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/3 candidates/);
  });

  it("caps batch refresh size and queues nothing above the cap", async () => {
    rows = Array.from({ length: 11 }, (_, i) =>
      makeRace({ race_id: `cap-race-${i}` }),
    );

    const { component, getAllByLabelText, getByText } = await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("cap-race-0")).toBeTruthy());

    for (const checkbox of getAllByLabelText(/^Select row /)) {
      await fireEvent.click(checkbox);
    }
    await fireEvent.click(getByText("Batch Refresh"));

    await waitFor(() => expect(getByText(/capped at 10 races/)).toBeTruthy());
    expect(
      mockFetchWithAuth.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("/api/races/queue"),
      ),
    ).toBe(false);
  });

  it("drops hidden rows from the batch selection and lists ids in the confirm", async () => {
    rows = [
      makeRace({ race_id: "keep-me", jurisdiction: "Georgia" }),
      makeRace({ race_id: "hide-me", jurisdiction: "Texas" }),
    ];

    const { component, container, getAllByLabelText, getByText, queryByText } =
      await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("hide-me")).toBeTruthy());

    for (const checkbox of getAllByLabelText(/^Select row /)) {
      await fireEvent.click(checkbox);
    }
    await waitFor(() => expect(getByText(/2 races selected/)).toBeTruthy());

    const jurisdiction = container.querySelector(
      "#jurisdiction-filter",
    ) as HTMLInputElement;
    await fireEvent.input(jurisdiction, { target: { value: "Georgia" } });

    await waitFor(() => expect(queryByText("hide-me")).toBeNull());
    await waitFor(() => expect(getByText(/1 race selected/)).toBeTruthy());

    await fireEvent.click(getByText("Batch Refresh"));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    const message = String(confirmSpy.mock.calls.at(-1)[0]);
    expect(message).toContain("keep-me");
    expect(message).not.toContain("hide-me");
    const queueCall = mockFetchWithAuth.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("/api/races/queue"),
    );
    expect(JSON.parse(String(queueCall[1].body)).race_ids).toEqual(["keep-me"]);
  });

  it("keeps the last good table when a background refresh fails", async () => {
    rows = [makeRace({ race_id: "still-here" })];

    const { component, getByText } = await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("still-here")).toBeTruthy());

    mockFetchWithAuth.mockImplementation(async () => {
      throw new Error("network down");
    });
    await component.refresh(false);

    await waitFor(() =>
      expect(getByText(/Showing the last loaded data/)).toBeTruthy(),
    );
    expect(getByText("still-here")).toBeTruthy();
  });

  it("ignores an out-of-order response from an older refresh", async () => {
    rows = [makeRace({ race_id: "initial" })];
    const { component, getByText, queryByText } = await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("initial")).toBeTruthy());

    let releaseSlow: () => void = () => {};
    mockFetchWithAuth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSlow = () =>
            resolve(jsonResponse({ races: [makeRace({ race_id: "stale" })] }));
        }),
    );
    mockFetchWithAuth.mockImplementationOnce(async () =>
      jsonResponse({ races: [makeRace({ race_id: "fresh" })] }),
    );

    const slow = component.refresh(false);
    await component.refresh(false);
    releaseSlow();
    await slow;

    await waitFor(() => expect(getByText("fresh")).toBeTruthy());
    expect(queryByText("stale")).toBeNull();
  });

  it("offers cancelled and idle status filters with badges", async () => {
    rows = [
      makeRace({ race_id: "was-cancelled", status: "cancelled" }),
      makeRace({ race_id: "now-idle", status: "idle" }),
    ];
    const { component, container, getByText } = await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("was-cancelled")).toBeTruthy());

    const options = Array.from(
      container.querySelectorAll('[aria-label="Filter by status"] option'),
    ).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(expect.arrayContaining(["cancelled", "idle"]));
    expect(getByText("cancelled").className).toContain("bg-orange-100");
  });

  it("drops a chosen action the row no longer offers after a refresh", async () => {
    rows = [makeRace({ race_id: "state-change", status: "queued" })];

    const { component, getByLabelText, getByText } = await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("state-change")).toBeTruthy());

    const select = getByLabelText(
      "Actions for state-change",
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "cancel" } });
    const go = getByLabelText(
      "Run selected action for state-change",
    ) as HTMLButtonElement;
    expect(go.disabled).toBe(false);

    // The run finished between the choice and the click.
    rows = [
      makeRace({
        race_id: "state-change",
        status: "draft",
        draft_exists: true,
      }),
    ];
    await component.refresh();

    const goAfter = () =>
      getByLabelText(
        "Run selected action for state-change",
      ) as HTMLButtonElement;
    await waitFor(() => expect(goAfter().disabled).toBe(true));
    const selectAfter = getByLabelText(
      "Actions for state-change",
    ) as HTMLSelectElement;
    expect(Array.from(selectAfter.options).map((o) => o.value)).not.toContain(
      "cancel",
    );
    const callsBefore = mockFetchWithAuth.mock.calls.length;
    await fireEvent.click(goAfter());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockFetchWithAuth.mock.calls.length).toBe(callsBefore);
  });

  it("refuses to price full research when the candidate count is unknown", async () => {
    rows = [makeRace({ race_id: "no-roster", candidate_count: 0 })];
    confirmSpy.mockReturnValue(false);

    const { component, getByLabelText, getByText } = await renderTab();
    await component.refresh();
    await waitFor(() => expect(getByText("no-roster")).toBeTruthy());

    await chooseAction(getByLabelText, "no-roster", "run-full");

    expect(confirmSpy.mock.calls[0][0]).toContain(
      "unknown candidate count — verify roster first",
    );
    expect(confirmSpy.mock.calls[0][0]).not.toMatch(/Estimated cost: ~\$0\.20/);
  });
});
