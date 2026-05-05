<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import { writable } from "svelte/store";
  import {
    createSvelteTable,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
  } from "@tanstack/svelte-table";
  import type {
    ColumnDef,
    ColumnFiltersState,
    FilterFn,
    SortingFn,
    SortingState,
    TableOptions,
    Updater,
  } from "@tanstack/svelte-table";
  import { PipelineApiService } from "$lib/services/pipelineApiService";
  import type { RaceRecord, RaceStatusType } from "$lib/types";

  export let onSelectRace: (race: RaceRecord) => void = () => {};
  export let onBatchQueue: (raceIds: string[]) => void = () => {};
  export async function refresh() {
    loading = true;
    await loadData();
  }

  const dispatch = createEventDispatcher<{ addRaces: string }>();
  const API_BASE = import.meta.env.VITE_RACES_API_URL || "http://127.0.0.1:8080";
  const apiService = new PipelineApiService(API_BASE);

  let rows: RaceRecord[] = [];
  let loading = true;
  let error = "";
  let globalFilter = "";
  let statusFilter: RaceStatusType | "all" = "all";
  let sorting: SortingState = [{ id: "draft_updated_at", desc: true }];
  let columnFilters: ColumnFiltersState = [];
  let selected = new Set<string>();
  let publishing = new Set<string>();
  let bulkPublishing = false;
  let addInput = "";

  function hasDraft(row: RaceRecord): boolean {
    if (typeof row.draft_exists === "boolean") return row.draft_exists;
    return row.status === "draft" || !!row.draft_updated_at;
  }

  function hasPublished(row: RaceRecord): boolean {
    if (typeof row.published_exists === "boolean") return row.published_exists;
    return row.status === "published" || !!row.published_at;
  }

  function hasPendingDraft(row: RaceRecord): boolean {
    if (!hasDraft(row)) return false;
    if (!hasPublished(row)) return true;
    if (!row.draft_updated_at || !row.published_at) return true;
    return row.draft_updated_at > row.published_at;
  }

  function isDiscoveryOnly(row: RaceRecord): boolean {
    const opts = (row.last_run_options ?? row.queue_options) as { enabled_steps?: string[] } | undefined;
    if (!opts) return false;
    const steps = opts.enabled_steps;
    return Array.isArray(steps) && steps.length === 1 && steps[0] === "discovery";
  }

  function draftTimestamp(row: RaceRecord): string {
    return hasDraft(row) ? row.draft_updated_at ?? "" : "";
  }

  function qualityValue(row: RaceRecord): number {
    const grades: Record<string, number> = { A: 95, B: 85, C: 75, D: 65, F: 55 };
    return row.quality_grade ? grades[row.quality_grade] : -1;
  }

  function normalize(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
  }

  const textFilter: FilterFn<RaceRecord> = (row, columnId, value) => {
    const needle = normalize(value);
    if (!needle) return true;
    return normalize(row.getValue(columnId)).includes(needle);
  };

  const statusExactFilter: FilterFn<RaceRecord> = (row, columnId, value) => {
    const filter = normalize(value);
    return !filter || filter === "all" || normalize(row.getValue(columnId)) === filter;
  };

  const globalRaceFilter: FilterFn<RaceRecord> = (row, _columnId, value) => {
    const needle = normalize(value);
    if (!needle) return true;
    const race = row.original;
    return [
      race.race_id,
      race.title,
      race.office,
      race.jurisdiction,
      race.status,
      race.quality_grade,
      race.candidate_count,
      race.total_runs,
    ].some((item) => normalize(item).includes(needle));
  };

  const dateSort: SortingFn<RaceRecord> = (a, b, columnId) => {
    const av = Date.parse(String(a.getValue(columnId) || ""));
    const bv = Date.parse(String(b.getValue(columnId) || ""));
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return -1;
    if (Number.isNaN(bv)) return 1;
    return av - bv;
  };

  const columns: ColumnDef<RaceRecord>[] = [
    {
      id: "select",
      header: "",
      enableSorting: false,
      enableColumnFilter: false,
    },
    {
      accessorKey: "race_id",
      header: "Race ID",
      filterFn: textFilter,
      sortingFn: "alphanumeric",
    },
    {
      accessorKey: "title",
      header: "Title",
      filterFn: textFilter,
      sortingFn: "alphanumeric",
    },
    {
      accessorKey: "jurisdiction",
      header: "Jurisdiction",
      filterFn: textFilter,
      sortingFn: "alphanumeric",
    },
    {
      accessorKey: "candidate_count",
      header: "Cands",
      filterFn: textFilter,
      sortingFn: "basic",
    },
    {
      id: "draft_updated_at",
      header: "Updated",
      accessorFn: draftTimestamp,
      filterFn: textFilter,
      sortingFn: dateSort,
      sortUndefined: "last",
    },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: statusExactFilter,
      sortingFn: "alphanumeric",
    },
    {
      accessorKey: "total_runs",
      header: "Runs",
      filterFn: textFilter,
      sortingFn: "basic",
    },
    {
      id: "quality",
      header: "Quality",
      accessorFn: qualityValue,
      filterFn: (row, _columnId, value) => {
        const needle = normalize(value);
        if (!needle) return true;
        return normalize(row.original.quality_grade).includes(needle);
      },
      sortingFn: "basic",
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      enableColumnFilter: false,
    },
  ];

  const options = writable<TableOptions<RaceRecord>>({
    data: rows,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    filterFns: {
      text: textFilter,
      statusExact: statusExactFilter,
      globalRace: globalRaceFilter,
    },
    globalFilterFn: globalRaceFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const table = createSvelteTable(options);

  function updateTableState() {
    options.update((old) => ({
      ...old,
      data: rows,
      state: {
        ...old.state,
        sorting,
        columnFilters,
        globalFilter,
      },
    }));
  }

  function resolveUpdater<T>(updater: Updater<T>, current: T): T {
    return updater instanceof Function ? updater(current) : updater;
  }

  function setSorting(updater: Updater<SortingState>) {
    sorting = resolveUpdater(updater, sorting);
    updateTableState();
  }

  function setColumnFilters(updater: Updater<ColumnFiltersState>) {
    columnFilters = resolveUpdater(updater, columnFilters);
    statusFilter = (columnFilters.find((filter) => filter.id === "status")?.value as RaceStatusType | undefined) ?? "all";
    updateTableState();
  }

  function setGlobalFilter(updater: Updater<string>) {
    globalFilter = resolveUpdater(updater, globalFilter);
    updateTableState();
  }

  async function loadData() {
    try {
      error = "";
      rows = await apiService.listRaces();
      updateTableState();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function visibleRaceIds(): string[] {
    return $table.getRowModel().rows.map((row) => row.original.race_id);
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected = next;
  }

  function toggleAll() {
    const ids = visibleRaceIds();
    if (ids.length > 0 && ids.every((id) => selected.has(id))) {
      selected = new Set([...selected].filter((id) => !ids.includes(id)));
    } else {
      selected = new Set([...selected, ...ids]);
    }
  }

  function handleBatchAction() {
    if (selected.size < 1) return;
    onBatchQueue([...selected]);
    selected = new Set();
  }

  function handleAddRaces() {
    const raw = addInput.trim();
    if (!raw) return;
    dispatch("addRaces", raw);
    addInput = "";
  }

  function handleAddKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") handleAddRaces();
  }

  $: selectedWithDrafts = [...selected].filter((id) => {
    const row = rows.find((r) => r.race_id === id);
    return row && hasPendingDraft(row);
  });

  $: filteredCount = $table.getFilteredRowModel().rows.length;
  $: visibleCount = $table.getRowModel().rows.length;
  $: visibleSelectedCount = visibleRaceIds().filter((id) => selected.has(id)).length;
  $: allVisibleSelected = visibleCount > 0 && visibleSelectedCount === visibleCount;
  $: someVisibleSelected = visibleSelectedCount > 0 && visibleSelectedCount < visibleCount;

  async function handleBulkPublish() {
    if (selectedWithDrafts.length === 0) return;
    if (!confirm(`Publish ${selectedWithDrafts.length} race${selectedWithDrafts.length !== 1 ? "s" : ""}?`)) return;
    bulkPublishing = true;
    try {
      const result = await apiService.batchPublishRaces(selectedWithDrafts);
      if (result.errors.length > 0) {
        error = `Published ${result.published.length}, failed: ${result.errors.map((e) => `${e.race_id}: ${e.error}`).join(", ")}`;
      }
      selected = new Set();
      await loadData();
    } catch (e) {
      error = `Bulk publish failed: ${e}`;
    } finally {
      bulkPublishing = false;
    }
  }

  async function handlePublish(race_id: string) {
    publishing = new Set([...publishing, race_id]);
    try {
      await apiService.publishRace(race_id);
      await loadData();
    } catch (e) {
      error = `Publish failed: ${e}`;
    } finally {
      const next = new Set(publishing);
      next.delete(race_id);
      publishing = next;
    }
  }

  async function handleUnpublish(race_id: string) {
    if (!confirm(`Unpublish "${race_id}"? Removes from public site but keeps the draft.`)) return;
    publishing = new Set([...publishing, race_id]);
    try {
      await apiService.unpublishRaceRecord(race_id);
      await loadData();
    } catch (e) {
      error = `Unpublish failed: ${e}`;
    } finally {
      const next = new Set(publishing);
      next.delete(race_id);
      publishing = next;
    }
  }

  async function handleDelete(race_id: string) {
    if (!confirm(`Delete "${race_id}" entirely? This cannot be undone.`)) return;
    try {
      await apiService.deleteRaceRecord(race_id);
      await loadData();
    } catch (e) {
      error = `Delete failed: ${e}`;
    }
  }

  function previewUrl(row: RaceRecord): string | null {
    if (hasDraft(row)) return `/races/${row.race_id}?draft=true`;
    if (hasPublished(row)) return `/races/${row.race_id}`;
    return null;
  }

  function handlePreview(row: RaceRecord) {
    const url = previewUrl(row);
    if (url) window.open(url, "_blank");
  }

  function handleGlobalFilterInput(event: Event) {
    $table.setGlobalFilter((event.currentTarget as HTMLInputElement).value);
  }

  function handleColumnFilterInput(columnId: string, event: Event) {
    $table.getColumn(columnId)?.setFilterValue((event.currentTarget as HTMLInputElement).value);
  }

  function handleStatusFilter(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as RaceStatusType | "all";
    statusFilter = value;
    $table.getColumn("status")?.setFilterValue(value === "all" ? "" : value);
  }

  function columnFilterValue(columnId: string): string {
    return String($table.getColumn(columnId)?.getFilterValue() ?? "");
  }

  function statusBadgeClass(s: RaceStatusType) {
    switch (s) {
      case "published": return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200";
      case "draft": return "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200";
      case "queued": return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200";
      case "running": return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200";
      case "failed": return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200";
      default: return "bg-surface-alt text-content-muted";
    }
  }

  function gradeBadgeClass(g: string) {
    switch (g) {
      case "A": return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-200";
      case "B": return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-200";
      case "C": return "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-200";
      case "D": return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200";
      case "F": return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200";
      default: return "bg-surface-alt text-content-muted border-stroke";
    }
  }

  function formatDate(s?: string) {
    if (!s) return "-";
    return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const STATUS_OPTIONS: { value: RaceStatusType | "all"; label: string }[] = [
    { value: "all", label: "All" },
    { value: "published", label: "Published" },
    { value: "draft", label: "Draft" },
    { value: "queued", label: "Queued" },
    { value: "running", label: "Running" },
    { value: "failed", label: "Failed" },
    { value: "empty", label: "Empty" },
  ];

  onMount(loadData);
</script>

<div class="space-y-4">
  <!-- Add races input -->
  <div class="card p-3">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={addInput}
        on:keydown={handleAddKeydown}
        placeholder="Add races: ga-senate-2026, tx-governor-2026..."
        class="flex-1 px-3 py-2 border border-stroke rounded-lg text-sm font-mono bg-surface text-content focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
      <button
        type="button"
        on:click={handleAddRaces}
        disabled={!addInput.trim()}
        class="btn-primary px-4 py-2 text-sm rounded-lg whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + Queue
      </button>
    </div>
    <p class="mt-1 text-xs text-content-faint">Comma-separate IDs · <kbd class="px-1 py-0.5 bg-surface-alt rounded text-xs">Enter</kbd> to add</p>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <input
        type="search"
        value={globalFilter}
        on:input={handleGlobalFilterInput}
        placeholder="Search all visible race fields..."
        class="flex-1 min-w-48 px-3 py-2 text-sm border border-stroke rounded-lg bg-surface text-content focus:outline-none focus:border-blue-500"
      />
      <select
        value={statusFilter}
        on:change={handleStatusFilter}
        class="px-3 py-2 text-sm border border-stroke rounded-lg bg-surface text-content focus:outline-none focus:border-blue-500"
        aria-label="Filter by status"
      >
        {#each STATUS_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
    <div class="flex items-center space-x-2">
      {#if selected.size > 0}
        <button
          type="button"
          class="btn-primary px-4 py-2 text-sm rounded-lg"
          on:click={handleBatchAction}
        >
          Queue {selected.size} Selected
        </button>
        {#if selectedWithDrafts.length > 0}
          <button
            type="button"
            class="px-4 py-2 text-sm rounded-lg border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 font-medium disabled:opacity-40"
            disabled={bulkPublishing}
            on:click={handleBulkPublish}
          >
            {bulkPublishing ? "Publishing..." : `Publish ${selectedWithDrafts.length} Draft${selectedWithDrafts.length !== 1 ? "s" : ""}`}
          </button>
        {/if}
      {/if}
      <button
        type="button"
        class="px-3 py-2 text-sm border border-stroke rounded-lg hover:bg-surface-alt text-content"
        on:click={loadData}
      >
        Refresh
      </button>
    </div>
  </div>

  {#if error}
    <div class="card p-4 text-sm text-red-600">{error}</div>
  {:else if loading}
    <div class="card p-8 text-center text-content-faint text-sm">Loading races...</div>
  {:else if filteredCount === 0}
    <div class="card p-8 text-center text-content-faint text-sm">No races found</div>
  {:else}
    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-surface-alt border-b border-stroke">
            <tr>
              <th class="pl-4 pr-2 py-3 text-left align-top">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  indeterminate={someVisibleSelected}
                  on:change={toggleAll}
                  class="rounded border-stroke"
                  aria-label="Select visible races"
                />
              </th>
              {#each $table.getHeaderGroups()[0].headers.slice(1) as header}
                <th class="px-3 py-2 text-left font-medium text-content-muted align-top whitespace-nowrap">
                  {#if !header.isPlaceholder}
                    <button
                      type="button"
                      class="group inline-flex items-center gap-1 text-left hover:text-content disabled:cursor-default disabled:hover:text-content-muted"
                      disabled={!header.column.getCanSort()}
                      on:click={header.column.getToggleSortingHandler()}
                    >
                      <span>{header.column.columnDef.header}</span>
                      {#if header.column.getCanSort()}
                        <span class="inline-flex h-4 w-4 items-center justify-center text-content-faint group-hover:text-content-muted" aria-hidden="true">
                          {#if header.column.getIsSorted() === "asc"}
                            <svg viewBox="0 0 16 16" class="h-3 w-3" fill="currentColor"><path d="M8 3 3.5 9h9L8 3z" /></svg>
                          {:else if header.column.getIsSorted() === "desc"}
                            <svg viewBox="0 0 16 16" class="h-3 w-3" fill="currentColor"><path d="M8 13 3.5 7h9L8 13z" /></svg>
                          {:else}
                            <svg viewBox="0 0 16 16" class="h-3 w-3 opacity-60" fill="currentColor"><path d="M8 2.5 4.5 7h7L8 2.5zM8 13.5 4.5 9h7L8 13.5z" /></svg>
                          {/if}
                        </span>
                      {/if}
                    </button>
                  {/if}
                </th>
              {/each}
            </tr>
            <tr class="border-t border-stroke/70">
              <th class="pl-4 pr-2 py-2"></th>
              <th class="px-3 py-2">
                <input
                  type="search"
                  value={columnFilterValue("race_id")}
                  on:input={(event) => handleColumnFilterInput("race_id", event)}
                  placeholder="Filter ID"
                  class="w-44 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                />
              </th>
              <th class="px-3 py-2">
                <input
                  type="search"
                  value={columnFilterValue("title")}
                  on:input={(event) => handleColumnFilterInput("title", event)}
                  placeholder="Filter title"
                  class="w-48 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                />
              </th>
              <th class="px-3 py-2">
                <input
                  type="search"
                  value={columnFilterValue("jurisdiction")}
                  on:input={(event) => handleColumnFilterInput("jurisdiction", event)}
                  placeholder="Filter place"
                  class="w-36 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                />
              </th>
              <th class="px-3 py-2">
                <input
                  type="search"
                  value={columnFilterValue("candidate_count")}
                  on:input={(event) => handleColumnFilterInput("candidate_count", event)}
                  placeholder="#"
                  class="w-16 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                />
              </th>
              <th class="px-3 py-2">
                <input
                  type="search"
                  value={columnFilterValue("draft_updated_at")}
                  on:input={(event) => handleColumnFilterInput("draft_updated_at", event)}
                  placeholder="Filter date"
                  class="w-36 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                />
              </th>
              <th class="px-3 py-2">
                <select
                  value={statusFilter}
                  on:change={handleStatusFilter}
                  class="w-32 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                  aria-label="Filter status column"
                >
                  {#each STATUS_OPTIONS as opt}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              </th>
              <th class="px-3 py-2">
                <input
                  type="search"
                  value={columnFilterValue("total_runs")}
                  on:input={(event) => handleColumnFilterInput("total_runs", event)}
                  placeholder="#"
                  class="w-16 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                />
              </th>
              <th class="px-3 py-2">
                <input
                  type="search"
                  value={columnFilterValue("quality")}
                  on:input={(event) => handleColumnFilterInput("quality", event)}
                  placeholder="A / 90"
                  class="w-20 px-2 py-1.5 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
                />
              </th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stroke">
            {#each $table.getRowModel().rows as tableRow (tableRow.id)}
              {@const row = tableRow.original}
              <tr
                class="hover:bg-surface-alt cursor-pointer {selected.has(row.race_id) ? 'bg-blue-50 dark:bg-blue-900/20' : hasPendingDraft(row) ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}"
                on:click={() => onSelectRace(row)}
              >
                <td class="pl-4 pr-2 py-3" on:click|stopPropagation>
                  <input
                    type="checkbox"
                    checked={selected.has(row.race_id)}
                    on:change={() => toggleSelect(row.race_id)}
                    class="rounded border-stroke"
                    aria-label={`Select ${row.race_id}`}
                  />
                </td>
                <td class="px-3 py-3 font-mono text-xs text-content whitespace-nowrap">
                  <span>{row.race_id}</span>
                  {#if row.status === "running"}
                    <span class="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                      <svg class="animate-spin h-2.5 w-2.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      running
                    </span>
                  {:else if row.status === "queued"}
                    <span class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200">
                      queued
                    </span>
                  {/if}
                </td>
                <td class="px-3 py-3 text-content max-w-40 truncate" title={row.title ?? ""}>{row.title ?? "-"}</td>
                <td class="px-3 py-3 text-content-muted max-w-32 truncate">{row.jurisdiction ?? "-"}</td>
                <td class="px-3 py-3 text-content-muted text-center font-mono">{row.candidate_count || "-"}</td>
                <td class="px-3 py-3 text-content-muted whitespace-nowrap">{hasDraft(row) ? formatDate(row.draft_updated_at) : "-"}</td>
                <td class="px-3 py-3">
                  <div class="flex items-center gap-1.5">
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium {statusBadgeClass(row.status)}">
                      {row.status}
                    </span>
                    {#if isDiscoveryOnly(row)}
                      <span
                        class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700"
                        title="Last run was discovery-only - candidates found but issues/research/finance not yet populated"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        discovery
                      </span>
                    {/if}
                    {#if hasDraft(row)}
                      <span
                        class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                        title={hasPublished(row) ? "Draft available" : "Unpublished draft available"}
                      >
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                        draft
                      </span>
                    {/if}
                  </div>
                </td>
                <td class="px-3 py-3 text-content-muted text-center font-mono">{row.total_runs}</td>
                <td class="px-3 py-3">
                  {#if row.quality_grade}
                    <span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border {gradeBadgeClass(row.quality_grade)}">
                      {row.quality_grade}
                    </span>
                  {:else}
                    <span class="text-content-faint">-</span>
                  {/if}
                </td>
                <td class="px-3 py-3" on:click|stopPropagation>
                  <div class="flex items-center space-x-1">
                    {#if hasDraft(row)}
                      <button
                        type="button"
                        class="px-2 py-1 text-xs border border-green-300 dark:border-green-700 rounded text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40 font-medium"
                        disabled={publishing.has(row.race_id)}
                        on:click={() => handlePublish(row.race_id)}
                      >
                        {publishing.has(row.race_id) ? "..." : "Publish"}
                      </button>
                    {/if}
                    {#if row.status === "published"}
                      <button
                        type="button"
                        class="px-2 py-1 text-xs border border-amber-300 dark:border-amber-700 rounded text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40"
                        disabled={publishing.has(row.race_id)}
                        on:click={() => handleUnpublish(row.race_id)}
                      >
                        Unpublish
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="px-2 py-1 text-xs border border-stroke rounded text-content-muted hover:bg-surface-alt disabled:opacity-40"
                      disabled={!previewUrl(row)}
                      title={hasDraft(row) ? "Open draft preview" : hasPublished(row) ? "Open published page" : "No draft or published page exists"}
                      on:click={() => handlePreview(row)}
                    >
                      {hasDraft(row) ? "View Draft" : "View Page"}
                    </button>
                    {#if row.status !== "running" && row.status !== "queued"}
                      <button
                        type="button"
                        class="px-2 py-1 text-xs border border-red-200 dark:border-red-900 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        on:click={() => handleDelete(row.race_id)}
                      >
                        Delete
                      </button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="px-4 py-2 bg-surface-alt border-t border-stroke text-xs text-content-subtle flex items-center justify-between">
        <span>
          {filteredCount} race{filteredCount !== 1 ? "s" : ""}
          {#if globalFilter} matching "{globalFilter}"{/if}
          {#if statusFilter !== "all"} · filtered by {statusFilter}{/if}
        </span>
        <span>
          {rows.filter((r) => r.status === "published").length} published ·
          {rows.filter((r) => r.status === "draft").length} draft ·
          {rows.filter((r) => r.status === "queued" || r.status === "running").length} active
          {#if rows.filter(isDiscoveryOnly).length > 0}
            · <span class="text-violet-600 dark:text-violet-400">{rows.filter(isDiscoveryOnly).length} discovery-only</span>
          {/if}
        </span>
      </div>
    </div>
  {/if}
</div>
