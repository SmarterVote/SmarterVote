<script lang="ts">
  import { browser } from "$app/environment";
  import { onDestroy, onMount } from "svelte";
  import AdminTabs, {
    ADMIN_TABPANEL_ID,
    tabId,
  } from "$lib/components/admin/AdminTabs.svelte";
  import DashboardTab from "$lib/components/admin/DashboardTab.svelte";
  import RacesTab from "$lib/components/admin/RacesTab.svelte";
  import RunsTab from "$lib/components/admin/RunsTab.svelte";
  import type { RunHistoryItem } from "$lib/types";
  import {
    initializeAuth,
    isLoginRequired,
    SIGN_IN_PATH,
  } from "$lib/stores/apiStore";
  import {
    PipelineApiService,
    RUN_HISTORY_MAX_LIMIT,
    RUN_HISTORY_POLL_LIMIT,
    type QueueItem,
  } from "$lib/services/pipelineApiService";
  import { racesApiBase } from "$lib/config/api";

  const API_BASE = racesApiBase();

  let apiService: PipelineApiService;
  let activeTab:
    | "dashboard"
    | "research"
    | "races"
    | "runs"
    | "forecasts"
    | "costs" = "dashboard";
  let queueItems: QueueItem[] = [];
  let runs: RunHistoryItem[] = [];
  let isRefreshingRuns = false;
  let isClearingQueue = false;
  let runsTruncated = false;
  /** Widest history window loaded so far (grows only on an explicit "Load more"). */
  let runsLimit = RUN_HISTORY_POLL_LIMIT;
  let runsError = "";
  let queueActionError = "";
  /** Queue item whose graceful cancel failed; offers a separate force remove. */
  let forceRemoveCandidate: QueueItem | null = null;
  let connected = false;
  let queueTimer: ReturnType<typeof setInterval> | null = null;
  let cancellingItemId: string | null = null;
  let racesTab: RacesTab | null = null;
  let authError = "";
  let ForecastsTabComponent:
    | typeof import("$lib/components/admin/ForecastsTab.svelte").default
    | null = null;
  let CostsTabComponent:
    | typeof import("$lib/components/admin/CostsTab.svelte").default
    | null = null;
  let ResearchProgramTabComponent:
    | typeof import("$lib/components/admin/ResearchProgramTab.svelte").default
    | null = null;

  $: if (activeTab === "research" && !ResearchProgramTabComponent) {
    void import("$lib/components/admin/ResearchProgramTab.svelte").then(
      (module) => (ResearchProgramTabComponent = module.default),
    );
  }

  $: if (activeTab === "forecasts" && !ForecastsTabComponent) {
    void import("$lib/components/admin/ForecastsTab.svelte").then(
      (module) => (ForecastsTabComponent = module.default),
    );
  }
  $: if (activeTab === "costs" && !CostsTabComponent) {
    void import("$lib/components/admin/CostsTab.svelte").then(
      (module) => (CostsTabComponent = module.default),
    );
  }
  $: if (activeTab === "runs" && apiService) {
    void refreshRuns();
  }

  $: activeQueueItems = queueItems.filter(
    (item) => item.status === "running" || item.status === "pending",
  );
  $: runningItems = activeQueueItems.filter(
    (item) => item.status === "running",
  );
  $: pendingItems = activeQueueItems.filter(
    (item) => item.status === "pending",
  );
  $: oldestPendingMs = Math.max(
    0,
    ...pendingItems.map((item) => {
      const created = item.created_at ? Date.parse(item.created_at) : NaN;
      return Number.isFinite(created) ? Date.now() - created : 0;
    }),
  );
  $: queueLikelyStalled =
    pendingItems.length > 0 &&
    runningItems.length === 0 &&
    oldestPendingMs >= 180000;

  let pollingIntervalMs = 0;

  function startOrUpdatePolling(activeItemsCount: number, currentTab: string) {
    let newIntervalMs = 0;
    if (activeItemsCount > 0) {
      newIntervalMs = 12000;
    } else if (
      currentTab === "dashboard" ||
      currentTab === "races" ||
      currentTab === "runs"
    ) {
      newIntervalMs = 30000;
    } else {
      newIntervalMs = 0;
    }

    if (newIntervalMs === pollingIntervalMs) {
      return;
    }

    pollingIntervalMs = newIntervalMs;
    if (queueTimer) {
      clearInterval(queueTimer);
      queueTimer = null;
    }

    if (pollingIntervalMs > 0) {
      queueTimer = setInterval(() => {
        if (!document.hidden) void refreshOperationalState();
      }, pollingIntervalMs);
    }
  }

  $: if (browser && apiService) {
    startOrUpdatePolling(activeQueueItems.length, activeTab);
  }

  onMount(async () => {
    if (!browser) return;
    try {
      await initializeAuth();
      apiService = new PipelineApiService(API_BASE);
    } catch (err) {
      // No session at all (signed out, direct visit): use the normal sign-in
      // flow rather than an "authentication failed" or "expired" notice.
      if (isLoginRequired(err)) {
        window.location.assign(SIGN_IN_PATH);
        return;
      }
      authError =
        err instanceof Error
          ? err.message
          : "Unable to initialize admin authentication.";
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (
      tabParam === "research" ||
      tabParam === "races" ||
      tabParam === "runs" ||
      tabParam === "forecasts" ||
      tabParam === "costs"
    ) {
      activeTab = tabParam;
    } else {
      activeTab = "dashboard";
    }

    // Run history loads when the Runs tab is shown (reactive block above).
    await refreshQueue();
  });

  onDestroy(() => {
    if (queueTimer) clearInterval(queueTimer);
  });

  async function refreshQueue() {
    if (!apiService) return;
    try {
      const result = await apiService.loadQueue();
      queueItems = result.items;
      connected = true;
    } catch {
      connected = false;
    }
  }

  async function refreshOperationalState() {
    const refreshes: Promise<void>[] = [refreshQueue()];
    if (activeTab === "runs") {
      refreshes.push(refreshRuns());
    } else if (activeTab === "races" && racesTab) {
      refreshes.push(racesTab.refresh(false));
    }
    await Promise.allSettled(refreshes);
  }

  async function refreshAllAdminState() {
    await Promise.allSettled([
      refreshQueue(),
      activeTab === "runs" ? refreshRuns() : Promise.resolve(),
      racesTab?.refresh(false) ?? Promise.resolve(),
    ]);
  }

  async function cancelQueueItem(item: QueueItem) {
    if (!confirm(`Cancel ${item.race_id || item.run_id || "this queue item"}?`))
      return;
    cancellingItemId = item.id;
    queueActionError = "";
    forceRemoveCandidate = null;
    try {
      await apiService.removeQueueItem(item.id);
    } catch (err) {
      // Never escalate to a force delete silently: surface the failure and
      // let the operator choose "Force remove" explicitly.
      queueActionError = `Could not cancel ${
        item.race_id || item.run_id || item.id
      }: ${err instanceof Error ? err.message : String(err)}`;
      forceRemoveCandidate = item;
    } finally {
      cancellingItemId = null;
      await refreshQueue();
    }
  }

  async function forceRemoveQueueItem(item: QueueItem) {
    if (
      !confirm(
        `Force remove ${item.race_id || item.run_id || item.id}?\n\n` +
          "This deletes the queue document even if a worker is still running it. " +
          "Use only for stuck items.",
      )
    )
      return;
    cancellingItemId = item.id;
    queueActionError = "";
    try {
      await apiService.removeQueueItem(item.id, true);
      forceRemoveCandidate = null;
    } catch (err) {
      queueActionError = `Force remove failed for ${
        item.race_id || item.run_id || item.id
      }: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      cancellingItemId = null;
      await refreshQueue();
    }
  }

  /**
   * Merge a fresh newest-first page with previously loaded (older) runs so a
   * small poll does not discard history the operator explicitly loaded.
   */
  function mergeRunPages(
    fresh: RunHistoryItem[],
    previous: RunHistoryItem[],
  ): RunHistoryItem[] {
    const seen = new Set(fresh.map((r) => r.run_id));
    return [...fresh, ...previous.filter((r) => !seen.has(r.run_id))];
  }

  /**
   * Refresh run history. Background polls read only RUN_HISTORY_POLL_LIMIT
   * docs; `pageSize` widens the read for an explicit "Load more".
   */
  let pendingWiderLoad = 0;

  async function refreshRuns(pageSize: number = RUN_HISTORY_POLL_LIMIT) {
    if (!apiService) return;
    if (isRefreshingRuns) {
      // Never drop an explicit wider load behind a background poll.
      if (pageSize > RUN_HISTORY_POLL_LIMIT)
        pendingWiderLoad = Math.max(pendingWiderLoad, pageSize);
      return;
    }
    isRefreshingRuns = true;
    runsError = "";
    try {
      const page = await apiService.loadRunHistoryPage(pageSize);
      if (page.limit >= runsLimit) {
        runs = page.runs;
        runsLimit = page.limit;
        runsTruncated = page.truncated;
      } else {
        // Small poll over a wider loaded window: keep the older rows and the
        // truncation state of the wider load.
        runs = mergeRunPages(page.runs, runs);
      }
    } catch (err) {
      console.error("Failed to load runs history:", err);
      runsError =
        err instanceof Error ? err.message : "Unable to load run history.";
    } finally {
      isRefreshingRuns = false;
    }
    if (pendingWiderLoad > runsLimit) {
      const next = pendingWiderLoad;
      pendingWiderLoad = 0;
      await refreshRuns(next);
    } else {
      pendingWiderLoad = 0;
    }
  }

  function loadMoreRuns() {
    return refreshRuns(RUN_HISTORY_MAX_LIMIT);
  }

  async function handleClearQueue() {
    if (!apiService || isClearingQueue) return;
    isClearingQueue = true;
    queueActionError = "";
    try {
      await apiService.clearPendingQueue();
    } catch (err) {
      queueActionError = `Failed to clear queue: ${
        err instanceof Error ? err.message : String(err)
      }`;
    } finally {
      isClearingQueue = false;
      await refreshQueue();
    }
  }
</script>

<svelte:head>
  <title>Admin Console | Smarter.Vote</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

{#if authError}
  <div class="mx-auto mt-16 max-w-xl px-4">
    <div
      class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
      role="alert"
    >
      <p class="font-semibold">Admin authentication failed</p>
      <p class="mt-1">{authError}</p>
    </div>
  </div>
{:else}
  <div class="w-full max-w-[1600px] mx-auto px-4 py-6">
    <div class="mt-2 mb-6 card p-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-content">Admin Console</h1>
          <p class="text-sm text-content-subtle">
            Race data and pipeline operations dashboard
          </p>
        </div>
        <div class="flex items-center gap-3 text-sm text-content-muted">
          <button
            type="button"
            class="rounded border border-stroke px-3 py-1.5 text-xs font-medium text-content hover:bg-surface-alt disabled:opacity-50"
            disabled={!apiService}
            on:click={refreshAllAdminState}
          >
            Refresh all
          </button>
          <div class="flex items-center gap-2">
            <span
              class="w-2.5 h-2.5 rounded-full {connected
                ? 'bg-green-500'
                : 'bg-red-500'}"
            ></span>
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>
      </div>
    </div>

    <AdminTabs bind:activeTab />

    {#if activeQueueItems.length > 0}
      <div
        class="mb-4 card border-blue-200 bg-blue-50 dark:bg-blue-900/20 overflow-hidden"
      >
        <div
          class="px-4 py-3 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between"
        >
          <p class="text-sm font-semibold text-blue-900 dark:text-blue-100">
            {runningItems.length} running, {pendingItems.length} queued
          </p>
          <button
            type="button"
            class="text-xs text-blue-700 hover:underline"
            on:click={refreshQueue}>Refresh</button
          >
        </div>
        <div class="divide-y divide-blue-100 dark:divide-blue-900/40">
          {#each activeQueueItems as item (item.id)}
            <div class="px-4 py-2.5 flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <span
                  class="block font-mono text-sm text-blue-900 dark:text-blue-100 truncate"
                  >{item.race_id || item.run_id}</span
                >
                <span
                  class="block text-xs text-blue-700 dark:text-blue-300 capitalize"
                  >{item.status}</span
                >
              </div>
              <button
                type="button"
                class="text-xs text-red-600 hover:underline disabled:opacity-50"
                disabled={cancellingItemId === item.id}
                on:click={() => cancelQueueItem(item)}>Cancel</button
              >
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if queueActionError}
      <div
        class="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        role="alert"
      >
        <p class="min-w-0 flex-1">{queueActionError}</p>
        <div class="flex shrink-0 items-center gap-2">
          {#if forceRemoveCandidate}
            {@const candidate = forceRemoveCandidate}
            <button
              type="button"
              class="rounded border border-red-400 px-3 py-1 text-xs font-semibold hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:hover:bg-red-900/40"
              disabled={cancellingItemId === candidate.id}
              on:click={() => forceRemoveQueueItem(candidate)}
              >Force remove</button
            >
          {/if}
          <button
            type="button"
            class="text-xs underline"
            on:click={() => {
              queueActionError = "";
              forceRemoveCandidate = null;
            }}>Dismiss</button
          >
        </div>
      </div>
    {/if}

    {#if queueLikelyStalled}
      <div
        class="mb-4 card p-3 border-amber-300 bg-amber-50 dark:bg-amber-900/20"
      >
        <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
          Queue appears stalled
        </p>
        <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
          {pendingItems.length} item{pendingItems.length === 1 ? "" : "s"} pending
          with no active runner for over three minutes.
        </p>
      </div>
    {/if}

    <div
      id={ADMIN_TABPANEL_ID}
      role="tabpanel"
      aria-labelledby={tabId(activeTab)}
      tabindex="0"
      class="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
    >
      {#if !apiService}
        <p
          class="flex items-center gap-2 py-12 text-sm text-content-muted"
          role="status"
        >
          <span
            class="h-4 w-4 animate-spin rounded-full border-2 border-stroke border-t-primary"
            aria-hidden="true"
          ></span>
          Checking your session…
        </p>
      {:else if activeTab === "dashboard"}
        <DashboardTab {apiService} on:view-runs={() => (activeTab = "runs")} />
      {:else if activeTab === "research" && apiService}
        <div class="card p-6">
          {#if ResearchProgramTabComponent}
            <svelte:component this={ResearchProgramTabComponent} {apiService} />
          {/if}
        </div>
      {:else if activeTab === "races" && apiService}
        <div class="card p-6">
          <RacesTab bind:this={racesTab} />
        </div>
      {:else if activeTab === "runs" && apiService}
        <RunsTab
          {apiService}
          {runs}
          {queueItems}
          isRefreshing={isRefreshingRuns}
          {isClearingQueue}
          historyTruncated={runsTruncated}
          historyLimit={runsLimit}
          {runsError}
          on:refresh={() => refreshRuns()}
          on:load-more={loadMoreRuns}
          on:clear-queue={handleClearQueue}
        />
      {:else if activeTab === "forecasts" && apiService}
        <div class="card p-6">
          {#if ForecastsTabComponent}
            <svelte:component this={ForecastsTabComponent} {apiService} />
          {/if}
        </div>
      {:else if activeTab === "costs" && apiService}
        {#if CostsTabComponent}
          <svelte:component this={CostsTabComponent} />
        {/if}
      {/if}
    </div>
  </div>
{/if}
