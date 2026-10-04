<script lang="ts">
  import { onMount } from "svelte";
  import { analyticsService } from "$lib/services/analyticsService";
  import type {
    GcpCostSummary,
    PipelineMetricsSummary,
    PipelineRunRecord,
  } from "$lib/types";

  const RANGES = [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
  ];
  let selectedDays = 30;
  $: rangeLabel =
    RANGES.find((r) => r.days === selectedDays)?.label ?? `${selectedDays}d`;

  /** Server cap on `GET /pipeline/metrics?limit=` (routers/pipeline.py). */
  const METRICS_RECORD_LIMIT = 500;
  /** Serper price the pipeline already folds into cost_usd/estimated_usd. */
  const SERPER_USD_PER_CALL = 0.001;
  // Mirrors DEFAULT_SEARLO_COST_PER_CALL_USD in pipeline_client/agent/cost.py.
  const SEARLO_USD_PER_CALL = 0.0004;

  // Records written since the cost split carry llm_cost_usd / search_cost_usd
  // (pipeline_client/agent/agent.py). cost_usd and estimated_usd ALREADY
  // include Serper at $0.001/call, so search must never be added on top.
  type CostRecord = PipelineRunRecord & {
    llm_cost_usd?: number | null;
    search_cost_usd?: number | null;
  };

  let summary: PipelineMetricsSummary | null = null;
  let windowSummary: PipelineMetricsSummary | null = null;
  let records: CostRecord[] = [];
  let recordsError = "";
  let gcp: GcpCostSummary | null = null;
  let loading = true;
  let error = "";
  let errorDetails: string[] = [];

  function recordCost(r: CostRecord): number {
    return r.cost_usd ?? r.estimated_usd ?? 0;
  }

  function recordSearchCost(r: CostRecord): number {
    if (typeof r.search_cost_usd === "number") return r.search_cost_usd;
    return (
      (r.serper_calls ?? 0) * SERPER_USD_PER_CALL +
      (r.searlo_calls ?? 0) * SEARLO_USD_PER_CALL
    );
  }

  // Records fall in the selected window for the search breakdown + top races.
  $: windowCutoff = Date.now() - selectedDays * 86400_000;
  $: windowRecords = records.filter((r) => {
    const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
    return Number.isFinite(t) ? t >= windowCutoff : true;
  });
  // The metrics endpoint returns at most METRICS_RECORD_LIMIT runs; when the
  // page is full and does not reach back to the window start, per-run
  // breakdowns below only cover part of the window.
  $: oldestRecordMs = records.reduce((oldest, r) => {
    const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
    return Number.isFinite(t) ? Math.min(oldest, t) : oldest;
  }, Infinity);
  $: recordsTruncated =
    records.length >= METRICS_RECORD_LIMIT && oldestRecordMs > windowCutoff;

  $: serperCalls = windowRecords.reduce((s, r) => s + (r.serper_calls ?? 0), 0);
  $: searloCalls = windowRecords.reduce((s, r) => s + (r.searlo_calls ?? 0), 0);
  $: searchShareUsd = windowRecords.reduce(
    (s, r) => s + recordSearchCost(r),
    0,
  );

  // Pipeline spend in window (server-side aggregate; already includes Serper).
  $: pipelineWindowUsd = windowSummary?.total_usd ?? 0;
  $: gcpWindowUsd = gcp?.configured ? (gcp.total_net_usd ?? 0) : 0;
  $: combinedWindowUsd = pipelineWindowUsd + gcpWindowUsd;

  $: topRaces = (() => {
    const totals = new Map<string, number>();
    for (const r of windowRecords) {
      if (!r.race_id) continue;
      totals.set(r.race_id, (totals.get(r.race_id) ?? 0) + recordCost(r));
    }
    return [...totals.entries()]
      .map(([race_id, usd]) => ({ race_id, usd }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 8);
  })();

  $: maxGcpService = gcp?.by_service?.length
    ? Math.max(...gcp.by_service.map((s) => s.net_usd))
    : 0;

  function usd(n: number | undefined | null, digits = 2): string {
    return `$${(n ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}`;
  }

  let loadSeq = 0;

  function reason(result: PromiseSettledResult<unknown>): string {
    if (result.status !== "rejected") return "";
    const r = result.reason;
    return r instanceof Error ? r.message : String(r);
  }

  async function load() {
    const seq = ++loadSeq;
    loading = true;
    error = "";
    errorDetails = [];
    recordsError = "";
    const hours = selectedDays * 24;
    const [allRes, winRes, recRes, gcpRes] = await Promise.allSettled([
      analyticsService.getPipelineMetricsSummary(),
      analyticsService.getPipelineMetricsSummary(hours),
      analyticsService.getPipelineMetrics(METRICS_RECORD_LIMIT),
      analyticsService.getGcpCosts(selectedDays),
    ]);
    if (seq !== loadSeq) return;
    summary = allRes.status === "fulfilled" ? allRes.value : null;
    windowSummary = winRes.status === "fulfilled" ? winRes.value : null;
    if (recRes.status === "fulfilled") {
      records = recRes.value.records as CostRecord[];
    } else {
      records = [];
      recordsError = reason(recRes);
    }
    if (gcpRes.status === "fulfilled") gcp = gcpRes.value;
    else gcp = { configured: false, reason: reason(gcpRes) };

    const labelled: Array<[string, PromiseSettledResult<unknown>]> = [
      ["All-time summary", allRes],
      [`${rangeLabel} summary`, winRes],
      ["Run records", recRes],
    ];
    errorDetails = labelled
      .filter(([, r]) => r.status === "rejected")
      .map(([label, r]) => `${label}: ${reason(r)}`);
    if (errorDetails.length > 0)
      error = `${errorDetails.length} cost request${
        errorDetails.length === 1 ? "" : "s"
      } failed — totals below may be incomplete`;
    loading = false;
  }

  async function changeRange(days: number) {
    selectedDays = days;
    await load();
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-4">
  <div class="flex items-center gap-1 bg-surface-alt rounded-lg p-1">
    {#each RANGES as range}
      <button
        type="button"
        class="px-3 py-1 rounded-md text-sm font-medium transition-colors
          {selectedDays === range.days
          ? 'bg-surface text-content shadow-xs'
          : 'text-content-subtle hover:text-content-muted'}"
        on:click={() => changeRange(range.days)}
      >
        {range.label}
      </button>
    {/each}
  </div>
  <button
    type="button"
    class="text-xs text-blue-600 hover:underline"
    on:click={load}>Refresh</button
  >
</div>

{#if loading}
  <div
    class="flex items-center justify-center py-16 text-content-subtle text-sm"
  >
    Loading costs...
  </div>
{:else}
  {#if error}
    <div
      class="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200"
      role="alert"
    >
      <p class="font-medium">{error}</p>
      <ul class="mt-1 list-disc pl-5 text-xs">
        {#each errorDetails as detail}
          <li>{detail}</li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if recordsTruncated}
    <p
      class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
      role="status"
    >
      Search breakdown and top races cover only the latest {METRICS_RECORD_LIMIT}
      runs (back to {new Date(oldestRecordMs).toLocaleDateString()}), not the
      full {rangeLabel} window. Totals above come from the server-side summary.
    </p>
  {/if}

  <!-- Top stat cards -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <div class="card p-4">
      <p
        class="text-xs font-medium text-content-subtle uppercase tracking-wide"
      >
        Combined ({rangeLabel})
      </p>
      <p class="mt-1 text-2xl font-bold text-content">
        {usd(combinedWindowUsd)}
      </p>
      <p class="mt-1 text-xs text-content-faint">
        Pipeline (LLM + Serper) + GCP
      </p>
    </div>
    <div class="card p-4">
      <p
        class="text-xs font-medium text-content-subtle uppercase tracking-wide"
      >
        Pipeline spend ({rangeLabel})
      </p>
      <p class="mt-1 text-2xl font-bold text-content">
        {windowSummary ? usd(pipelineWindowUsd) : "—"}
      </p>
      <p class="mt-1 text-xs text-content-faint">
        {windowSummary?.total_runs ?? 0} runs
      </p>
    </div>
    <div class="card p-4">
      <p
        class="text-xs font-medium text-content-subtle uppercase tracking-wide"
      >
        Web search ({rangeLabel})
      </p>
      {#if recordsError}
        <p class="mt-1 text-xl font-bold text-content-faint">—</p>
        <p class="mt-1 text-xs text-content-faint">run records unavailable</p>
      {:else}
        <p class="mt-1 text-2xl font-bold text-content">
          {usd(searchShareUsd)}
        </p>
        <p class="mt-1 text-xs text-content-faint">
          {serperCalls.toLocaleString()} Serper · {searloCalls.toLocaleString()}
          Searlo calls — included in pipeline spend
        </p>
      {/if}
    </div>
    <div class="card p-4">
      <p
        class="text-xs font-medium text-content-subtle uppercase tracking-wide"
      >
        GCP infra ({rangeLabel})
      </p>
      {#if gcp?.configured}
        <p class="mt-1 text-2xl font-bold text-content">{usd(gcpWindowUsd)}</p>
        <p class="mt-1 text-xs text-content-faint">net of credits</p>
      {:else}
        <p class="mt-1 text-xl font-bold text-content-faint">—</p>
        <p class="mt-1 text-xs text-content-faint">not set up</p>
      {/if}
    </div>
  </div>

  <!-- Pipeline detail -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
    <div class="card p-4">
      <h3 class="text-sm font-semibold text-content-muted mb-3">
        Pipeline spend (all time)
      </h3>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p class="text-xs text-content-faint">Total</p>
          <p class="font-semibold text-content">{usd(summary?.total_usd)}</p>
        </div>
        <div>
          <p class="text-xs text-content-faint">Avg / run</p>
          <p class="font-semibold text-content">{usd(summary?.avg_usd, 3)}</p>
        </div>
        <div>
          <p class="text-xs text-content-faint">Avg / candidate</p>
          <p class="font-semibold text-content">
            {usd(summary?.avg_usd_per_candidate, 3)}
          </p>
        </div>
        <div>
          <p class="text-xs text-content-faint">Success rate</p>
          <p class="font-semibold text-content">
            {Math.round((summary?.success_rate ?? 0) * 100)}%
          </p>
        </div>
        <div>
          <p class="text-xs text-content-faint">Cheap runs</p>
          <p class="font-semibold text-content">
            {summary?.cheap_runs ?? 0} · {usd(summary?.avg_cheap_usd, 3)} avg
          </p>
        </div>
        <div>
          <p class="text-xs text-content-faint">Full runs</p>
          <p class="font-semibold text-content">
            {summary?.full_runs ?? 0} · {usd(summary?.avg_full_usd, 3)} avg
          </p>
        </div>
      </div>
      <p class="mt-4 pt-3 border-t border-stroke text-xs text-content-faint">
        Run costs already include search: Serper at ${SERPER_USD_PER_CALL.toFixed(
          3,
        )}/call, Searlo at ${SEARLO_USD_PER_CALL.toFixed(4)}/call.
      </p>
    </div>

    <div class="card p-4">
      <h3 class="text-sm font-semibold text-content-muted mb-3">
        Top races by cost ({rangeLabel})
      </h3>
      {#if topRaces.length > 0}
        <div class="space-y-1.5">
          {#each topRaces as r}
            <div class="flex items-center justify-between gap-3 text-xs">
              <span
                class="font-mono text-content-muted truncate"
                title={r.race_id}>{r.race_id}</span
              >
              <span class="font-semibold text-content shrink-0"
                >{usd(r.usd, 3)}</span
              >
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-sm text-content-faint py-4 text-center">
          No runs in range
        </p>
      {/if}
    </div>
  </div>

  <!-- GCP infra -->
  <div class="card p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-content-muted">
        GCP infrastructure ({rangeLabel})
      </h3>
      {#if gcp?.configured && gcp.total_credits_usd}
        <span class="text-xs text-content-faint">
          {usd(gcp.total_gross_usd)} gross · {usd(gcp.total_credits_usd)} credits
        </span>
      {/if}
    </div>

    {#if gcp?.configured && (gcp.by_service?.length ?? 0) > 0}
      <div class="space-y-2">
        {#each gcp.by_service ?? [] as line}
          <div>
            <div class="flex items-center justify-between gap-3 text-xs mb-0.5">
              <span class="text-content-muted truncate" title={line.service}
                >{line.service}</span
              >
              <span class="font-semibold text-content shrink-0"
                >{usd(line.net_usd, 2)}</span
              >
            </div>
            <div class="h-1.5 rounded-sm bg-surface-alt overflow-hidden">
              <div
                class="h-full bg-blue-500"
                style="width: {maxGcpService > 0
                  ? Math.max(2, (line.net_usd / maxGcpService) * 100)
                  : 0}%"
              ></div>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div
        class="rounded-lg border border-dashed border-stroke px-4 py-5 text-sm text-content-subtle"
      >
        <p class="font-medium text-content-muted">
          GCP cost export not active yet
        </p>
        <p class="mt-1 text-xs">
          {gcp?.reason ?? "Billing export not configured."}
        </p>
        <ol class="mt-3 list-decimal pl-4 text-xs space-y-1 text-content-faint">
          <li>
            Apply Terraform to create the <code>billing_export</code> dataset.
          </li>
          <li>
            Cloud Console → Billing → Billing export → BigQuery export → enable
            <em>Detailed usage cost</em> into that dataset.
          </li>
          <li>Data appears here ~24h after enabling.</li>
        </ol>
      </div>
    {/if}
  </div>
{/if}
