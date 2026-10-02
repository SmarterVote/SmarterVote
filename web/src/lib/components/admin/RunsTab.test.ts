import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PipelineApiService,
  QueueItem,
} from "$lib/services/pipelineApiService";
import type {
  PipelineMetricsSummary,
  PipelineRunRecord,
  RunHistoryItem,
} from "$lib/types";

const records: PipelineRunRecord[] = [
  {
    run_id: "run-newest",
    race_id: "mn-governor-2026",
    status: "completed",
    timestamp: "2026-05-04T12:00:00Z",
    model: "gpt-5.4-mini",
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    estimated_usd: 0.012,
    cost_usd: 0.011234,
    cost_source: "provider",
    serper_calls: 2,
    searlo_calls: 3,
    search_calls: 5,
    model_breakdown: {},
    duration_s: 42,
    candidate_count: 3,
    cheap_mode: true,
  },
];

const summary: PipelineMetricsSummary = {
  total_runs: 1,
  total_usd: 0.012,
  avg_usd: 0.012,
  recent_30d_usd: 0.012,
  success_rate: 1,
  cheap_runs: 1,
  avg_cheap_usd: 0.012,
  full_runs: 0,
  avg_full_usd: 0,
  avg_usd_per_candidate: 0.004,
};

const mockRuns: RunHistoryItem[] = [
  {
    run_id: "run-newest",
    race_id: "mn-governor-2026",
    status: "completed",
    started_at: "2026-05-04T12:00:00Z",
    completed_at: "2026-05-04T12:00:42Z",
    duration_ms: 42000,
    progress: 100,
    steps: [],
  } as unknown as RunHistoryItem,
];

describe("RunsTab", () => {
  let analyticsService: {
    getPipelineMetrics: ReturnType<typeof vi.fn>;
    getPipelineMetricsSummary: ReturnType<typeof vi.fn>;
  };
  let apiService: {
    getRunDetails: ReturnType<typeof vi.fn>;
    getRunLogs: ReturnType<typeof vi.fn>;
    getRunLogsTail: ReturnType<typeof vi.fn>;
    cancelRun: ReturnType<typeof vi.fn>;
    removeQueueItem: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    analyticsService = {
      getPipelineMetrics: vi.fn(),
      getPipelineMetricsSummary: vi.fn(),
    };
    analyticsService.getPipelineMetrics.mockResolvedValue({ records });
    analyticsService.getPipelineMetricsSummary.mockResolvedValue(summary);

    apiService = {
      getRunDetails: vi.fn().mockResolvedValue({
        run_id: "run-newest",
        race_id: "mn-governor-2026",
        status: "completed",
        started_at: "2026-05-04T12:00:00Z",
        completed_at: "2026-05-04T12:00:42Z",
        duration_ms: 42000,
        progress: 100,
        options: { research_model: "gpt-5.4-mini" },
        steps: [],
      }),
      getRunLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
      getRunLogsTail: vi.fn().mockResolvedValue({
        logs: [],
        next_cursor: null,
        truncated: false,
      }),
      cancelRun: vi.fn().mockResolvedValue(undefined),
      removeQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock("$lib/services/analyticsService", () => ({ analyticsService }));
  });

  afterEach(() => {
    cleanup();
    vi.doUnmock("$lib/services/analyticsService");
  });

  async function renderRunsTab() {
    const module = await import("./RunsTab.svelte");
    return render(module.default, {
      props: {
        runs: mockRuns,
        queueItems: [],
        isRefreshing: false,
        apiService: apiService as unknown as PipelineApiService,
      },
    });
  }

  it("renders pipeline metrics summary and historical runs", async () => {
    const { component, getByText, container } = await renderRunsTab();

    // Trigger metrics loading and await it
    await component.fetchMetrics();

    await waitFor(() => expect(getByText("Total Runs (24h)")).toBeTruthy());
    expect(getByText("Success Rate")).toBeTruthy();
    expect(getByText("100.0%")).toBeTruthy();
    expect(analyticsService.getPipelineMetrics).toHaveBeenCalledWith(50);

    // Check historical run item
    expect(getByText("mn-governor-2026")).toBeTruthy();
    expect(container.textContent).toContain("$0.0112");
    expect(container.textContent).toContain("150");
    expect(container.textContent).toMatch(/Total Searches:\s*5/);
  });

  it("shows a retryable run-history error", async () => {
    const module = await import("./RunsTab.svelte");
    const { getByRole, getByText } = render(module.default, {
      props: {
        runs: [],
        queueItems: [],
        runsError: "Request timed out after 20 seconds",
      },
    });
    expect(getByText("Run history could not be loaded")).toBeTruthy();
    expect(getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("opens logs drawer on clicking run history item", async () => {
    const { component, getByText } = await renderRunsTab();

    // Trigger metrics loading and await it
    await component.fetchMetrics();

    await waitFor(() => expect(getByText("mn-governor-2026")).toBeTruthy());
    const runRow = getByText("mn-governor-2026");
    await fireEvent.click(runRow);

    await waitFor(() =>
      expect(apiService.getRunDetails).toHaveBeenCalledWith("run-newest"),
    );
    // The initial drawer load pages to the end of the log so a finished
    // run shows its final lines, not the oldest page.
    expect(apiService.getRunLogsTail).toHaveBeenCalledWith(
      "run-newest",
      expect.any(Number),
    );

    // Expect drawer content to be displayed
    await waitFor(() => expect(getByText("Run Logs: run-newest")).toBeTruthy());
  });

  it("renders the drawer as a labelled modal dialog that Escape closes", async () => {
    const { getByText, getByRole, queryByRole } = await renderRunsTab();
    const opener = getByText("mn-governor-2026").closest("button")!;
    opener.focus();
    await fireEvent.click(opener);

    const dialog = await waitFor(() => getByRole("dialog"));
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("run-drawer-title");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    await fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("ignores a late response after the drawer was closed", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    apiService.getRunDetails.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const { getByText, getByRole, queryByRole } = await renderRunsTab();
    await fireEvent.click(getByText("mn-governor-2026"));
    const dialog = await waitFor(() => getByRole("dialog"));
    await fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(queryByRole("dialog")).toBeNull());

    resolveFirst({
      run_id: "run-newest",
      status: "running",
      steps: [],
      options: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The stale open must not fetch logs or start polling for a closed drawer.
    expect(apiService.getRunLogsTail).not.toHaveBeenCalled();
    expect(queryByRole("dialog")).toBeNull();
  });

  it("cancels an active run via the cancel-only endpoint", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const module = await import("./RunsTab.svelte");
    const { getByRole } = render(module.default, {
      props: {
        runs: [
          {
            ...mockRuns[0],
            run_id: "run-active",
            status: "running",
          } as RunHistoryItem,
        ],
        queueItems: [],
        apiService: apiService as unknown as PipelineApiService,
      },
    });

    await fireEvent.click(
      getByRole("button", { name: "Cancel run for mn-governor-2026" }),
    );

    await waitFor(() =>
      expect(apiService.cancelRun).toHaveBeenCalledWith("run-active"),
    );
  });

  it("cancels a queue-only row through its queue item", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const module = await import("./RunsTab.svelte");
    const { getByRole } = render(module.default, {
      props: {
        runs: [],
        queueItems: [
          {
            id: "queue-1",
            race_id: "ga-senate-2026",
            run_id: "run-queued",
            status: "pending",
            created_at: "2026-05-04T12:00:00Z",
          } as unknown as QueueItem,
        ],
        apiService: apiService as unknown as PipelineApiService,
      },
    });

    await fireEvent.click(
      getByRole("button", { name: "Cancel run for ga-senate-2026" }),
    );

    await waitFor(() =>
      expect(apiService.removeQueueItem).toHaveBeenCalledWith("queue-1"),
    );
    expect(apiService.cancelRun).not.toHaveBeenCalled();
  });

  it("explains a 409 instead of deleting an already-finished run", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiService.cancelRun.mockRejectedValue(
      new Error(
        'HTTP 409: Conflict. {"detail":"Run is not active (status: completed)"}',
      ),
    );
    const module = await import("./RunsTab.svelte");
    const { getByRole, findByRole } = render(module.default, {
      props: {
        runs: [
          {
            ...mockRuns[0],
            run_id: "run-active",
            status: "running",
          } as RunHistoryItem,
        ],
        queueItems: [],
        apiService: apiService as unknown as PipelineApiService,
      },
    });

    await fireEvent.click(
      getByRole("button", { name: "Cancel run for mn-governor-2026" }),
    );

    const alert = await findByRole("alert");
    // The server's own 409 detail is shown, not a guess.
    expect(alert.textContent).toContain(
      "Run run-active was not cancelled: Run is not active (status: completed)",
    );
  });

  it("flags truncated run history", async () => {
    const module = await import("./RunsTab.svelte");
    const { container } = render(module.default, {
      props: {
        runs: mockRuns,
        queueItems: [],
        historyTruncated: true,
        historyLimit: 500,
      },
    });
    expect(container.textContent).toContain("500 most recent runs");
  });

  function activeRun(runId = "run-active") {
    return {
      ...mockRuns[0],
      run_id: runId,
      status: "running",
    } as RunHistoryItem;
  }

  it("shows a cancelled run as cancelled immediately and schedules a follow-up refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const module = await import("./RunsTab.svelte");
    const refreshes = vi.fn();
    const { getByRole, queryByRole } = render(module.default, {
      props: {
        runs: [activeRun()],
        queueItems: [],
        apiService: apiService as unknown as PipelineApiService,
      },
      events: { refresh: refreshes },
    });

    await fireEvent.click(
      getByRole("button", { name: "Cancel run for mn-governor-2026" }),
    );

    await waitFor(() =>
      expect(
        queryByRole("button", { name: "Cancel run for mn-governor-2026" }),
      ).toBeNull(),
    );
    expect(refreshes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3500);
    expect(refreshes).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("tracks cancelling state per run so two cancels can be in flight", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const pending: ((v?: unknown) => void)[] = [];
    apiService.cancelRun.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const module = await import("./RunsTab.svelte");
    const first = {
      ...activeRun("run-a"),
      race_id: "race-a",
    } as RunHistoryItem;
    const second = {
      ...activeRun("run-b"),
      race_id: "race-b",
    } as RunHistoryItem;
    (first as { payload?: unknown }).payload = { race_id: "race-a" };
    (second as { payload?: unknown }).payload = { race_id: "race-b" };
    const { getByRole } = render(module.default, {
      props: {
        runs: [first, second],
        queueItems: [],
        apiService: apiService as unknown as PipelineApiService,
      },
    });

    const buttonA = getByRole("button", { name: "Cancel run for race-a" });
    const buttonB = getByRole("button", { name: "Cancel run for race-b" });
    await fireEvent.click(buttonA);
    await waitFor(() =>
      expect((buttonA as HTMLButtonElement).disabled).toBe(true),
    );
    expect((buttonB as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(buttonB);

    await waitFor(() => expect(apiService.cancelRun).toHaveBeenCalledTimes(2));
    pending.forEach((resolve) => resolve());
  });

  it("falls back to the active queue item when a collapsed continuation row 404s", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiService.cancelRun.mockRejectedValue(
      new Error('HTTP 404: Not Found. {"detail":"Run not found"}'),
    );
    const module = await import("./RunsTab.svelte");
    const collapsed = {
      ...activeRun("run-next"),
      invocation_run_ids: ["run-root", "run-next"],
    } as RunHistoryItem;
    const { getByRole } = render(module.default, {
      props: {
        runs: [collapsed],
        queueItems: [
          {
            id: "queue-cont",
            race_id: "mn-governor-2026",
            run_id: "run-next",
            parent_run_id: "run-root",
            status: "pending",
            is_continuation: true,
          } as unknown as QueueItem,
        ],
        apiService: apiService as unknown as PipelineApiService,
      },
    });

    await fireEvent.click(
      getByRole("button", { name: "Cancel run for mn-governor-2026" }),
    );

    await waitFor(() =>
      expect(apiService.removeQueueItem).toHaveBeenCalledWith("queue-cont"),
    );
    expect(apiService.cancelRun).toHaveBeenCalledWith("run-next");
  });

  it("offers an explicit load-more when the polled page is truncated", async () => {
    const module = await import("./RunsTab.svelte");
    const loadMore = vi.fn();
    const { getByRole } = render(module.default, {
      props: {
        runs: mockRuns,
        queueItems: [],
        historyTruncated: true,
        historyLimit: 50,
      },
      events: { "load-more": loadMore },
    });

    await fireEvent.click(getByRole("button", { name: /Load up to 500 runs/ }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("widens a truncated history once when a filter is used", async () => {
    const module = await import("./RunsTab.svelte");
    const loadMore = vi.fn();
    const { getByLabelText } = render(module.default, {
      props: {
        runs: mockRuns,
        queueItems: [],
        historyTruncated: true,
        historyLimit: 50,
      },
      events: { "load-more": loadMore },
    });
    const search = getByLabelText(
      "Filter run history by race ID or run ID",
    ) as HTMLInputElement;

    await fireEvent.input(search, { target: { value: "mn" } });
    await fireEvent.input(search, { target: { value: "mn-g" } });

    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
