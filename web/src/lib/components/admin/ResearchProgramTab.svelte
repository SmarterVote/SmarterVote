<script lang="ts" context="module">
  /**
   * Checkpoints store UTC ISO timestamps; <input type="datetime-local"> wants
   * local wall-clock "YYYY-MM-DDTHH:mm". Slicing the UTC string shifted every
   * timestamp by the viewer's UTC offset on each save.
   */
  export function isoToLocalInput(iso?: string | null): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  /** Parse a datetime-local value as local time and return UTC ISO. */
  export function localInputToIso(value: string): string | undefined {
    if (!value) return undefined;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return undefined;
    const [, y, mo, d, h, mi] = match.map(Number);
    const date = new Date(y, mo - 1, d, h, mi);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { analyticsService } from "$lib/services/analyticsService";
  import type { PipelineApiService } from "$lib/services/pipelineApiService";
  import { researchEventChoices } from "$lib/utils/researchProgram";
  import type {
    ResearchCheckpointInput,
    ResearchProgramRow,
    ResearchProgramStatus,
    ResearchResultState,
    TrafficAnalytics,
  } from "$lib/types";

  export let apiService: PipelineApiService;

  let status: ResearchProgramStatus | null = null;
  let traffic: TrafficAnalytics | null = null;
  let loading = true;
  let error = "";
  let search = "";
  let stateFilter = "all";
  let discoveryFilter = "all";
  let issueFilter = "all";
  let selected: ResearchProgramRow | null = null;
  let saving = false;
  let notice = "";
  let noticeType: "success" | "error" = "success";

  let resultState: ResearchResultState = "stabilizing";
  let operator = "";
  let officialResultUrl = "";
  let firstCheckedAt = "";
  let secondCheckedAt = "";
  let advancingNames = "";
  let blocker = "";
  let selectedEventKey = "";
  let discoveryReviewed = false;

  $: trafficByRace = aggregateTraffic(traffic?.top_pages ?? []);
  $: states = [
    ...new Set((status?.rows ?? []).map((row) => row.manifest.state)),
  ].sort();
  $: filteredRows = (status?.rows ?? [])
    .filter((row) => {
      const needle = search.trim().toLowerCase();
      if (
        needle &&
        !`${row.race_id} ${row.manifest.state} ${row.manifest.office}`
          .toLowerCase()
          .includes(needle)
      )
        return false;
      if (stateFilter !== "all" && row.manifest.state !== stateFilter)
        return false;
      if (discoveryFilter !== "all" && row.discovery_state !== discoveryFilter)
        return false;
      return issueFilter === "all" || row.issue_state === issueFilter;
    })
    .sort(
      (a, b) =>
        (trafficByRace.get(b.race_id) ?? 0) -
        (trafficByRace.get(a.race_id) ?? 0),
    );

  function aggregateTraffic(
    pages: { name: string; pageviews: number }[],
  ): Map<string, number> {
    const totals = new Map<string, number>();
    for (const page of pages) {
      const match = page.name.match(/^\/races\/([^/?#]+)/);
      if (!match) continue;
      const raceId = decodeURIComponent(match[1]);
      totals.set(raceId, (totals.get(raceId) ?? 0) + page.pageviews);
    }
    return totals;
  }

  function money(value: number): string {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    });
  }

  function shortDate(value?: string | null): string {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function badge(state: string): string {
    if (state === "complete" || state === "stable" || state === "ready")
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    if (
      state === "manual_review" ||
      state === "review_required" ||
      state === "runoff_pending"
    )
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    if (state === "queued" || state === "running" || state === "stabilizing")
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
    return "bg-surface-alt text-content-subtle";
  }

  async function loadData() {
    loading = true;
    error = "";
    const [statusResult, trafficResult] = await Promise.allSettled([
      apiService.getResearchProgramStatus(),
      analyticsService.getTraffic(24 * 30),
    ]);
    if (statusResult.status === "fulfilled") status = statusResult.value;
    else error = `Research status failed: ${String(statusResult.reason)}`;
    traffic = trafficResult.status === "fulfilled" ? trafficResult.value : null;
    loading = false;
  }

  function editCheckpoint(row: ResearchProgramRow) {
    selected = row;
    const checkpoint = row.checkpoint;
    resultState = checkpoint?.result_state ?? "stabilizing";
    operator = checkpoint?.operator ?? "";
    officialResultUrl = checkpoint?.official_result_url ?? "";
    firstCheckedAt = isoToLocalInput(checkpoint?.first_checked_at);
    secondCheckedAt = isoToLocalInput(checkpoint?.second_checked_at);
    advancingNames = checkpoint?.advancing_names?.join(", ") ?? "";
    blocker = checkpoint?.blocker ?? "";
    discoveryReviewed = Boolean(
      checkpoint?.result_fingerprint &&
        checkpoint.last_reviewed_discovery_fingerprint ===
          checkpoint.result_fingerprint,
    );
    const choices = researchEventChoices(row.manifest);
    const saved = choices.find(
      (choice) =>
        choice.eventType === checkpoint?.event_type &&
        choice.eventDate === checkpoint?.event_date,
    );
    const completed = choices.filter(
      (choice) => choice.eventDate <= new Date().toISOString().slice(0, 10),
    );
    selectedEventKey =
      saved?.key ?? completed.at(-1)?.key ?? choices[0]?.key ?? "";
    notice = "";
  }

  async function saveCheckpoint() {
    if (!selected) return;
    saving = true;
    notice = "";
    const existing = selected.checkpoint;
    // The API replaces the whole checkpoint document, so a non-stable save
    // must carry the existing result proof forward or it is silently erased
    // (and the result fingerprint changes).
    const payload: ResearchCheckpointInput = {
      result_state: resultState,
      operator: operator.trim(),
      blocker: blocker.trim() || undefined,
      official_result_url: existing?.official_result_url || undefined,
      first_checked_at: existing?.first_checked_at || undefined,
      second_checked_at: existing?.second_checked_at || undefined,
      advancing_names: existing?.advancing_names?.length
        ? [...existing.advancing_names]
        : undefined,
      event_type: existing?.event_type || undefined,
      event_date: existing?.event_date || undefined,
      last_reviewed_discovery_fingerprint:
        existing?.last_reviewed_discovery_fingerprint || undefined,
    };
    if (resultState === "stable") {
      const event = researchEventChoices(selected.manifest).find(
        (choice) => choice.key === selectedEventKey,
      );
      payload.official_result_url = officialResultUrl.trim();
      payload.first_checked_at = localInputToIso(firstCheckedAt);
      payload.second_checked_at = localInputToIso(secondCheckedAt);
      payload.advancing_names = advancingNames
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      payload.event_type = event?.eventType;
      payload.event_date = event?.eventDate;
      if (discoveryReviewed && existing?.result_fingerprint) {
        payload.last_reviewed_discovery_fingerprint =
          existing.result_fingerprint;
      }
    }
    for (const key of Object.keys(payload) as (keyof typeof payload)[]) {
      if (payload[key] === undefined) delete payload[key];
    }
    try {
      await apiService.recordResearchCheckpoint(selected.race_id, payload);
      await loadData();
      selected =
        status?.rows.find((row) => row.race_id === selected?.race_id) ?? null;
      noticeType = "success";
      notice = "Checkpoint saved.";
    } catch (err) {
      noticeType = "error";
      notice = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      saving = false;
    }
  }

  onMount(loadData);
</script>

<div class="flex flex-wrap items-start justify-between gap-3 mb-5">
  <div>
    <h2 class="text-lg font-semibold text-content">2026 research program</h2>
    <p class="text-sm text-content-subtle">
      Official event schedule, result proof, discovery readiness, issue backlog,
      demand, and actual pipeline spend.
    </p>
  </div>
  <button type="button" class="btn-secondary text-sm" on:click={loadData}
    >Refresh</button
  >
</div>

{#if loading}
  <p class="py-12 text-center text-content-subtle">Loading research status…</p>
{:else if error}
  <div
    class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
    role="alert"
  >
    {error}
  </div>
{:else if status}
  <div class="grid grid-cols-2 gap-3 mb-5 md:grid-cols-3 xl:grid-cols-6">
    <div class="card p-3">
      <div class="text-xs text-content-subtle">Coverage</div>
      <div class="text-xl font-semibold">{status.summary.coverage_count}</div>
    </div>
    <div class="card p-3">
      <div class="text-xs text-content-subtle">Catalog present</div>
      <div class="text-xl font-semibold">
        {status.summary.catalog_present_count}
      </div>
    </div>
    <div class="card p-3">
      <div class="text-xs text-content-subtle">Stable results</div>
      <div class="text-xl font-semibold">
        {status.summary.result_states.stable ?? 0}
      </div>
    </div>
    <div class="card p-3">
      <div class="text-xs text-content-subtle">Discovery review</div>
      <div class="text-xl font-semibold">
        {status.summary.discovery_states.review_required ?? 0}
      </div>
    </div>
    <div class="card p-3">
      <div class="text-xs text-content-subtle">Issues ready</div>
      <div class="text-xl font-semibold">
        {status.summary.issue_states.ready ?? 0}
      </div>
    </div>
    <div class="card p-3">
      <div class="text-xs text-content-subtle">Tracked spend</div>
      <div class="text-xl font-semibold">
        {money(status.summary.total_pipeline_spend_usd)}
      </div>
    </div>
  </div>

  <div
    class="mb-4 flex flex-wrap gap-3 rounded-lg border border-stroke bg-surface-alt p-3"
  >
    <input
      class="input min-w-56"
      aria-label="Search research races"
      placeholder="Race, state, or office"
      bind:value={search}
    />
    <select class="input" aria-label="State" bind:value={stateFilter}
      ><option value="all">All states</option>{#each states as state}<option
          value={state}>{state}</option
        >{/each}</select
    >
    <select
      class="input"
      aria-label="Discovery state"
      bind:value={discoveryFilter}
    >
      <option value="all">All discovery states</option><option
        value="waiting_event">Waiting event</option
      ><option value="stabilizing">Stabilizing</option><option value="ready"
        >Ready</option
      ><option value="review_required">Review required</option><option
        value="complete">Complete</option
      ><option value="queued">Queued</option><option value="running"
        >Running</option
      ><option value="manual_review">Manual review</option>
    </select>
    <select class="input" aria-label="Issue state" bind:value={issueFilter}>
      <option value="all">All issue states</option><option
        value="blocked_roster">Blocked on roster</option
      ><option value="ready">Ready</option><option value="complete"
        >Complete</option
      ><option value="manual_review">Manual review</option>
    </select>
    <span class="self-center text-sm text-content-subtle"
      >{filteredRows.length} races · sorted by 30-day demand</span
    >
  </div>

  {#if status.orphaned_catalog_race_ids.length}
    <div
      class="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <strong
        >{status.orphaned_catalog_race_ids.length} unverified catalog record(s):</strong
      >
      {status.orphaned_catalog_race_ids.join(", ")}
    </div>
  {/if}

  {#if selected}
    <form
      class="mb-5 rounded-lg border border-blue-300 bg-blue-50/60 p-4 dark:bg-blue-950/30"
      on:submit|preventDefault={saveCheckpoint}
    >
      <div class="mb-3 flex items-center justify-between">
        <h3 class="font-semibold">Result checkpoint · {selected.race_id}</h3>
        <button
          type="button"
          class="text-sm text-content-subtle hover:underline"
          on:click={() => (selected = null)}>Close</button
        >
      </div>
      <div class="grid gap-3 md:grid-cols-3">
        <label class="text-sm"
          >State<select class="input mt-1 w-full" bind:value={resultState}
            ><option value="waiting">Waiting</option><option value="stabilizing"
              >Stabilizing</option
            ><option value="stable">Stable</option><option
              value="runoff_pending">Runoff pending</option
            ><option value="manual_review">Manual review</option></select
          ></label
        >
        <label class="text-sm"
          >Operator<input
            class="input mt-1 w-full"
            required
            bind:value={operator}
          /></label
        >
        <label class="text-sm"
          >Blocker / note<input
            class="input mt-1 w-full"
            bind:value={blocker}
          /></label
        >
        {#if resultState === "stable"}
          <label class="text-sm"
            >Verified event<select
              class="input mt-1 w-full"
              required
              bind:value={selectedEventKey}
              >{#each researchEventChoices(selected.manifest) as event}<option
                  value={event.key}
                  >{event.kind} · {shortDate(event.eventDate)}</option
                >{/each}</select
            ></label
          >
          <label class="text-sm md:col-span-3"
            >Official results URL<input
              class="input mt-1 w-full"
              type="url"
              required
              bind:value={officialResultUrl}
            /></label
          >
          <label class="text-sm"
            >First check<input
              class="input mt-1 w-full"
              type="datetime-local"
              required
              bind:value={firstCheckedAt}
            /></label
          >
          <label class="text-sm"
            >Second check (≥6h later)<input
              class="input mt-1 w-full"
              type="datetime-local"
              required
              bind:value={secondCheckedAt}
            /></label
          >
          <label class="text-sm"
            >Advancing candidates<input
              class="input mt-1 w-full"
              required
              placeholder="Name, Name"
              bind:value={advancingNames}
            /></label
          >
          {#if selected.checkpoint?.result_fingerprint}
            <label class="flex items-center gap-2 text-sm md:col-span-3">
              <input type="checkbox" bind:checked={discoveryReviewed} />
              Discovery artifact reviewed against this exact result fingerprint
            </label>
          {/if}
        {/if}
      </div>
      <div class="mt-3 flex items-center gap-3">
        <button class="btn-primary text-sm" type="submit" disabled={saving}
          >{saving ? "Saving…" : "Save checkpoint"}</button
        >{#if notice}
          {#if noticeType === "error"}
            <span
              class="rounded border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
              role="alert">{notice}</span
            >
          {:else}
            <span
              class="rounded border border-green-300 bg-green-50 px-2 py-1 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
              role="status">{notice}</span
            >
          {/if}
        {/if}
      </div>
    </form>
  {/if}

  <div class="overflow-x-auto rounded-lg border border-stroke">
    <table class="min-w-full text-sm">
      <thead
        class="bg-surface-alt text-left text-xs uppercase tracking-wide text-content-subtle"
        ><tr
          ><th scope="col" class="p-3">Race</th><th scope="col" class="p-3"
            >Primary</th
          ><th scope="col" class="p-3">Result proof</th><th
            scope="col"
            class="p-3">Discovery</th
          ><th scope="col" class="p-3">Issues</th><th scope="col" class="p-3"
            >Artifact stage</th
          ><th scope="col" class="p-3 text-right">30d views</th><th
            scope="col"
            class="p-3 text-right">Spend</th
          ><th scope="col" class="p-3"><span class="sr-only">Actions</span></th
          ></tr
        ></thead
      >
      <tbody class="divide-y divide-stroke">
        {#each filteredRows as row}
          <tr class="hover:bg-surface-alt/60">
            <td class="p-3"
              ><a
                class="font-medium text-blue-600 hover:underline"
                href={`/races/${row.race_id}`}
                target="_blank"
                rel="noreferrer">{row.race_id}</a
              >
              <div class="text-xs text-content-subtle">
                {row.manifest.state} · {row.manifest.office.replaceAll(
                  "_",
                  " ",
                )}
              </div></td
            >
            <td class="p-3"
              ><div>{shortDate(row.manifest.primary_date)}</div>
              {#if row.manifest.runoff_date}<div
                  class="text-xs text-content-subtle"
                >
                  Runoff {shortDate(row.manifest.runoff_date)}
                </div>{/if}</td
            >
            <td class="p-3"
              ><span
                class={`rounded-full px-2 py-1 text-xs ${badge(row.checkpoint?.result_state ?? "waiting")}`}
                >{(row.checkpoint?.result_state ?? "waiting").replaceAll(
                  "_",
                  " ",
                )}</span
              >
              {#if row.checkpoint?.advancing_names?.length}
                <div class="mt-1 max-w-48 text-xs text-content-subtle">
                  {row.checkpoint.advancing_names.join(", ")}
                </div>
              {/if}</td
            >
            <td class="p-3"
              ><span
                class={`rounded-full px-2 py-1 text-xs ${badge(row.discovery_state)}`}
                >{row.discovery_state.replaceAll("_", " ")}</span
              ></td
            >
            <td class="p-3"
              ><span
                class={`rounded-full px-2 py-1 text-xs ${badge(row.issue_state)}`}
                >{row.issue_state.replaceAll("_", " ")}</span
              ></td
            >
            <td class="p-3"
              ><div>
                {row.latest.exists
                  ? row.latest.contest_stage.replaceAll("_", " ")
                  : "No artifact"}
              </div>
              <div class="text-xs text-content-subtle">
                {row.latest.exists ? row.latest_source : "manifest only"}
              </div></td
            >
            <td class="p-3 text-right tabular-nums"
              >{(trafficByRace.get(row.race_id) ?? 0).toLocaleString()}</td
            >
            <td
              class="p-3 text-right tabular-nums"
              title={Object.entries(row.cost.by_workflow)
                .map(([key, value]) => `${key}: ${money(value)}`)
                .join(" · ")}>{money(row.cost.total_usd)}</td
            >
            <td class="p-3"
              ><button
                type="button"
                class="text-xs text-blue-600 hover:underline"
                on:click={() => editCheckpoint(row)}>Checkpoint</button
              ></td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
