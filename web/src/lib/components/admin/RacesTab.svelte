<script lang="ts">
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import {
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
  } from "@tanstack/table-core";
  import type {
    ColumnDef,
    ColumnFiltersState,
    FilterFn,
    SortingFn,
    SortingState,
    TableOptions,
    Updater,
  } from "@tanstack/table-core";
  import { createSvelteTable } from "$lib/utils/svelteTable";
  import { PipelineApiService } from "$lib/services/pipelineApiService";
  import type { RaceRecord, RaceStatusType } from "$lib/types";
  import { racesApiBase } from "$lib/config/api";
  import {
    FULL_RESEARCH_STEPS,
    MAX_BATCH_QUEUE,
    REFRESH_STEPS,
    fullResearchCostEstimate,
    fullResearchRunOptions,
    refreshCostEstimate,
    refreshRunOptions,
  } from "./pipelinePresets";

  const API_BASE = racesApiBase();
  const apiService = new PipelineApiService(API_BASE);

  let rows: RaceRecord[] = [];
  let loading = true;
  let error = "";
  /** Background refresh failure while earlier data is still shown. */
  let staleError = "";
  let loadSeq = 0;
  let rowActionChoice: Record<string, string> = {};
  let globalFilter = "";
  let statusFilter: RaceStatusType | "all" = "all";
  let sorting: SortingState = [{ id: "draft_updated_at", desc: true }];
  let columnFilters: ColumnFiltersState = [];
  let rowSelection = {};

  // Advanced filters
  let onlyUnpublishedFilter = false;
  let qualityFilter = "all";
  let jurisdictionFilter = "";
  let filteredRows: RaceRecord[] = [];

  // Action states
  let rowActionLoading: Record<string, string> = {}; // race_id -> action
  let batchActionLoading = false;
  let actionNotice: { type: "success" | "error"; message: string } | null =
    null;

  export async function refresh(showLoading = true) {
    if (showLoading) loading = true;
    await loadData();
  }

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

  type RowAction = { value: string; label: string };

  /** The actions a row offers for its current state (also used to validate). */
  function rowActionOptions(row: RaceRecord): RowAction[] {
    const options: RowAction[] = [];
    if (hasDraft(row) && (!hasPublished(row) || hasPendingDraft(row)))
      options.push({ value: "publish", label: "Publish draft" });
    if (hasPublished(row))
      options.push({ value: "unpublish", label: "Unpublish" });
    if (row.status === "queued" || row.status === "running") {
      options.push({ value: "cancel", label: "Cancel run" });
      options.push({ value: "recheck", label: "Recheck status" });
    } else {
      options.push({ value: "run", label: "Queue refresh (~$0.09)" });
      options.push({ value: "run-full", label: "Queue full research…" });
    }
    options.push({ value: "delete", label: "Delete race" });
    return options;
  }

  function isValidRowAction(row: RaceRecord, action: string | undefined) {
    return (
      !!action &&
      rowActionOptions(row).some((option) => option.value === action)
    );
  }

  /**
   * A refresh can change a row's state (e.g. queued → draft) under a choice
   * made earlier; drop choices the row no longer offers so "Go" can never run
   * a stale action.
   */
  function pruneRowActionChoices(current: RaceRecord[]) {
    const byId = new Map(current.map((row) => [row.race_id, row]));
    let changed = false;
    const next: Record<string, string> = {};
    for (const [raceId, action] of Object.entries(rowActionChoice)) {
      const row = byId.get(raceId);
      if (action && row && isValidRowAction(row, action)) next[raceId] = action;
      else if (action) changed = true;
    }
    if (changed) rowActionChoice = next;
  }

  $: pruneRowActionChoices(rows);

  function isDiscoveryOnly(row: RaceRecord): boolean {
    const opts = (row.last_run_options ?? row.queue_options) as
      { enabled_steps?: string[] } | undefined;
    if (!opts) return false;
    const steps = opts.enabled_steps;
    return (
      Array.isArray(steps) && steps.length === 1 && steps[0] === "discovery"
    );
  }

  function draftTimestamp(row: RaceRecord): string {
    return hasDraft(row) ? (row.draft_updated_at ?? "") : "";
  }

  function qualityValue(row: RaceRecord): number {
    const grades: Record<string, number> = {
      A: 95,
      B: 85,
      C: 75,
      D: 65,
      F: 55,
    };
    return row.quality_grade ? grades[row.quality_grade] : -1;
  }

  function normalize(value: unknown): string {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  const textFilter: FilterFn<RaceRecord> = (row, columnId, value) => {
    const needle = normalize(value);
    if (!needle) return true;
    return normalize(row.getValue(columnId)).includes(needle);
  };

  const statusExactFilter: FilterFn<RaceRecord> = (row, columnId, value) => {
    const filter = normalize(value);
    return (
      !filter ||
      filter === "all" ||
      normalize(row.getValue(columnId)) === filter
    );
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
      header: "Select",
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

  function computeFilteredRows() {
    filteredRows = rows.filter((row) => {
      // 1. Unpublished changes filter
      if (onlyUnpublishedFilter && !hasPendingDraft(row)) {
        return false;
      }
      // 2. Quality filter
      if (qualityFilter !== "all") {
        if (qualityFilter === "-") {
          if (row.quality_grade) return false;
        } else {
          if (row.quality_grade !== qualityFilter) return false;
        }
      }
      // 3. Jurisdiction filter
      if (jurisdictionFilter) {
        if (
          !row.jurisdiction ||
          !row.jurisdiction
            .toLowerCase()
            .includes(jurisdictionFilter.toLowerCase())
        ) {
          return false;
        }
      }
      return true;
    });
  }

  const options = writable<TableOptions<RaceRecord>>({
    data: filteredRows,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
    },
    filterFns: {
      text: textFilter,
      statusExact: statusExactFilter,
      globalRace: globalRaceFilter,
    },
    globalFilterFn: globalRaceFilter,
    getRowId: (row) => row.race_id,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const table = createSvelteTable(options);

  $: visibleRows = $table.getFilteredRowModel().rows;
  $: filteredCount = visibleRows.length;
  $: visibleRaceIds = new Set(visibleRows.map((row) => row.id));
  // Batch actions act only on rows the operator can see: drop selections that
  // a filter (or a refresh) has hidden.
  $: pruneHiddenSelection(visibleRaceIds);
  $: selectedRaceIds = Object.entries(rowSelection)
    .filter(([raceId, selected]) => selected && visibleRaceIds.has(raceId))
    .map(([raceId]) => raceId);
  $: selectedCount = selectedRaceIds.length;
  $: footerCounts = countStatuses(rows);

  function pruneHiddenSelection(visible: Set<string>) {
    const selection = rowSelection as Record<string, boolean>;
    const kept = Object.fromEntries(
      Object.entries(selection).filter(
        ([raceId, selected]) => selected && visible.has(raceId),
      ),
    );
    if (Object.keys(kept).length !== Object.keys(selection).length) {
      rowSelection = kept;
      updateTableState();
    }
  }

  function countStatuses(list: RaceRecord[]) {
    const counts = { published: 0, draft: 0, active: 0, discoveryOnly: 0 };
    for (const r of list) {
      if (r.status === "published") counts.published++;
      else if (r.status === "draft") counts.draft++;
      else if (r.status === "queued" || r.status === "running") counts.active++;
      if (isDiscoveryOnly(r)) counts.discoveryOnly++;
    }
    return counts;
  }

  function updateTableState() {
    options.update((old) => ({
      ...old,
      data: filteredRows,
      state: {
        ...old.state,
        sorting,
        columnFilters,
        globalFilter,
        rowSelection,
      },
    }));
  }

  $: {
    // React to filter bindings changing from the UI controls
    (onlyUnpublishedFilter, qualityFilter, jurisdictionFilter);
    computeFilteredRows();
    updateTableState();
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
    statusFilter =
      (columnFilters.find((filter) => filter.id === "status")?.value as
        RaceStatusType | undefined) ?? "all";
    updateTableState();
  }

  function setGlobalFilter(updater: Updater<string>) {
    globalFilter = resolveUpdater(updater, globalFilter);
    updateTableState();
  }

  function setRowSelection(updater: Updater<Record<string, boolean>>) {
    rowSelection = resolveUpdater(updater, rowSelection);
    updateTableState();
  }

  async function loadData() {
    const seq = ++loadSeq;
    try {
      const next = await apiService.listRaces();
      // An older request finishing after a newer one must not win.
      if (seq !== loadSeq) return;
      rows = next;
      error = "";
      staleError = "";
      computeFilteredRows();
      updateTableState();
    } catch (e) {
      if (seq !== loadSeq) return;
      // Keep the last good table on a failed background poll; only show the
      // full error card when there is nothing to show.
      if (rows.length) staleError = String(e);
      else error = String(e);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function previewUrl(row: RaceRecord): string | null {
    if (hasDraft(row)) return `/races/${row.race_id}?draft=true`;
    if (hasPublished(row)) return `/races/${row.race_id}`;
    return null;
  }

  function handlePreview(row: RaceRecord) {
    const url = previewUrl(row);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function setActionNotice(type: "success" | "error", message: string) {
    actionNotice = { type, message };
  }

  function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function formatActionErrors(
    errors: Array<{ race_id: string; error: string }>,
  ) {
    return errors.map((e) => `${e.race_id}: ${e.error}`).join("; ");
  }

  function clearSelection() {
    rowSelection = {};
    updateTableState();
  }

  function handleGlobalFilterInput(event: Event) {
    $table.setGlobalFilter((event.currentTarget as HTMLInputElement).value);
  }

  function handleStatusFilter(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as
      RaceStatusType | "all";
    statusFilter = value;
    $table.getColumn("status")?.setFilterValue(value === "all" ? "" : value);
  }

  // Row Action Handlers
  async function handlePublish(raceId: string) {
    if (!confirm(`Publish draft for race ${raceId}?`)) return;
    actionNotice = null;
    rowActionLoading = { ...rowActionLoading, [raceId]: "publishing" };
    try {
      await apiService.publishRace(raceId);
      setActionNotice("success", `${raceId} was published.`);
      await refresh(false);
    } catch (e) {
      setActionNotice(
        "error",
        `Publish failed for ${raceId}: ${errorMessage(e)}`,
      );
    } finally {
      const copy = { ...rowActionLoading };
      delete copy[raceId];
      rowActionLoading = copy;
    }
  }

  async function handleUnpublish(raceId: string) {
    if (
      !confirm(
        `Unpublish race ${raceId}? This will remove the published page but keep the draft.`,
      )
    )
      return;
    actionNotice = null;
    rowActionLoading = { ...rowActionLoading, [raceId]: "unpublishing" };
    try {
      await apiService.unpublishRaceRecord(raceId);
      setActionNotice("success", `${raceId} was unpublished.`);
      await refresh(false);
    } catch (e) {
      setActionNotice(
        "error",
        `Unpublish failed for ${raceId}: ${errorMessage(e)}`,
      );
    } finally {
      const copy = { ...rowActionLoading };
      delete copy[raceId];
      rowActionLoading = copy;
    }
  }

  async function handleRun(row: RaceRecord, mode: "refresh" | "full") {
    const raceId = row.race_id;
    const steps = mode === "refresh" ? REFRESH_STEPS : FULL_RESEARCH_STEPS;
    const estimate =
      mode === "refresh"
        ? refreshCostEstimate(1)
        : fullResearchCostEstimate(row.candidate_count);
    const prompt =
      mode === "refresh"
        ? `Queue a lightweight refresh for ${raceId}?\n\nSteps: ${steps.join(", ")}\nModel profile: default\nEstimated cost: ${estimate}`
        : `Queue FULL issue research for ${raceId}?\n\nThis is roughly 5-10x the cost of a refresh. Verify the roster first.\n\nSteps: ${steps.join(", ")}\nModel profile: default · baseline: latest draft\nEstimated cost: ${estimate}`;
    if (!confirm(prompt)) return;
    actionNotice = null;
    rowActionLoading = { ...rowActionLoading, [raceId]: "running" };
    try {
      const res = await apiService.queueRaces(
        [raceId],
        mode === "refresh" ? refreshRunOptions() : fullResearchRunOptions(),
      );
      if (res.errors.length > 0 || res.added.length === 0) {
        const detail = res.errors.length
          ? formatActionErrors(res.errors)
          : "No queue item was created.";
        setActionNotice("error", `Queue failed for ${raceId}: ${detail}`);
        return;
      }
      setActionNotice(
        "success",
        `${raceId} was added to the pipeline queue (${
          mode === "refresh" ? "refresh" : "full research"
        }).`,
      );
      await refresh(false);
    } catch (e) {
      setActionNotice(
        "error",
        `Queue failed for ${raceId}: ${errorMessage(e)}`,
      );
    } finally {
      const copy = { ...rowActionLoading };
      delete copy[raceId];
      rowActionLoading = copy;
    }
  }

  async function handleDelete(raceId: string) {
    if (
      !confirm(
        `WARNING: Are you sure you want to permanently delete race ${raceId}? This will delete the firestore record and all GCS drafts/published files.`,
      )
    )
      return;
    actionNotice = null;
    rowActionLoading = { ...rowActionLoading, [raceId]: "deleting" };
    try {
      await apiService.deleteRaceRecord(raceId);
      setActionNotice("success", `${raceId} and its stored data were deleted.`);
      await refresh(false);
    } catch (e) {
      setActionNotice(
        "error",
        `Delete failed for ${raceId}: ${errorMessage(e)}`,
      );
    } finally {
      const copy = { ...rowActionLoading };
      delete copy[raceId];
      rowActionLoading = copy;
    }
  }

  async function handleCancel(raceId: string) {
    if (!confirm(`Cancel the active pipeline work for race ${raceId}?`)) return;
    actionNotice = null;
    rowActionLoading = { ...rowActionLoading, [raceId]: "cancelling" };
    try {
      await apiService.cancelRace(raceId);
      setActionNotice("success", `Pipeline work for ${raceId} was cancelled.`);
      await refresh(false);
    } catch (e) {
      setActionNotice(
        "error",
        `Cancel failed for ${raceId}: ${errorMessage(e)}`,
      );
    } finally {
      const copy = { ...rowActionLoading };
      delete copy[raceId];
      rowActionLoading = copy;
    }
  }

  async function handleRecheck(raceId: string) {
    actionNotice = null;
    rowActionLoading = { ...rowActionLoading, [raceId]: "rechecking" };
    try {
      await apiService.recheckRace(raceId);
      setActionNotice(
        "success",
        `${raceId} was rechecked against stored run data.`,
      );
      await refresh(false);
    } catch (e) {
      setActionNotice(
        "error",
        `Recheck failed for ${raceId}: ${errorMessage(e)}`,
      );
    } finally {
      const copy = { ...rowActionLoading };
      delete copy[raceId];
      rowActionLoading = copy;
    }
  }

  /**
   * Row actions run only from the explicit "Go" button — never on <select>
   * change, which fires on arrow-key navigation in some browsers.
   */
  function handleRowAction(row: RaceRecord) {
    const action = rowActionChoice[row.race_id] ?? "";
    rowActionChoice = { ...rowActionChoice, [row.race_id]: "" };
    if (!isValidRowAction(row, action)) return;

    if (action === "publish") void handlePublish(row.race_id);
    if (action === "unpublish") void handleUnpublish(row.race_id);
    if (action === "run") void handleRun(row, "refresh");
    if (action === "run-full") void handleRun(row, "full");
    if (action === "cancel") void handleCancel(row.race_id);
    if (action === "recheck") void handleRecheck(row.race_id);
    if (action === "delete") void handleDelete(row.race_id);
  }

  function listIds(ids: string[]): string {
    const shown = ids.slice(0, 25);
    const more = ids.length - shown.length;
    return shown.join("\n") + (more > 0 ? `\n…and ${more} more` : "");
  }

  // Batch Action Handlers
  async function handleBatchPublish() {
    const selectedIds = selectedRaceIds;
    if (selectedIds.length === 0) return;
    if (
      !confirm(
        `Publish the ${selectedIds.length} selected race(s)?\n\n${listIds(selectedIds)}`,
      )
    )
      return;
    batchActionLoading = true;
    actionNotice = null;
    try {
      const res = await apiService.batchPublishRaces(selectedIds);
      if (res.errors && res.errors.length > 0) {
        setActionNotice(
          "error",
          `Published ${res.published.length} of ${
            selectedIds.length
          } selected race(s). Failures: ${formatActionErrors(res.errors)}`,
        );
      } else {
        setActionNotice(
          "success",
          `Published all ${selectedIds.length} selected race(s).`,
        );
      }
      clearSelection();
      await refresh(false);
    } catch (e) {
      setActionNotice("error", `Batch publish failed: ${errorMessage(e)}`);
    } finally {
      batchActionLoading = false;
    }
  }

  async function handleBatchRun() {
    const selectedIds = selectedRaceIds;
    if (selectedIds.length === 0) return;
    if (selectedIds.length > MAX_BATCH_QUEUE) {
      setActionNotice(
        "error",
        `Batch refresh is capped at ${MAX_BATCH_QUEUE} races per action (${selectedIds.length} selected). Queue a small batch, verify the results, then continue.`,
      );
      return;
    }
    if (
      !confirm(
        `Queue a lightweight refresh for ${selectedIds.length} race(s)?\n\n` +
          `Steps: ${REFRESH_STEPS.join(", ")}\nModel profile: default\n` +
          `Estimated cost: ${refreshCostEstimate(selectedIds.length)}\n\n` +
          listIds(selectedIds),
      )
    )
      return;
    batchActionLoading = true;
    actionNotice = null;
    try {
      const res = await apiService.queueRaces(selectedIds, refreshRunOptions());
      if (res.errors.length > 0) {
        setActionNotice(
          "error",
          `Queued ${res.added.length} of ${
            selectedIds.length
          } selected race(s). Failures: ${formatActionErrors(res.errors)}`,
        );
      } else {
        setActionNotice(
          "success",
          `Queued all ${selectedIds.length} selected race(s).`,
        );
      }
      if (res.added.length > 0) {
        clearSelection();
        await refresh(false);
      }
    } catch (e) {
      setActionNotice("error", `Batch queue failed: ${errorMessage(e)}`);
    } finally {
      batchActionLoading = false;
    }
  }

  async function handleBatchDelete() {
    const selectedIds = selectedRaceIds;
    if (selectedIds.length === 0) return;
    if (
      !confirm(
        `WARNING: Permanently delete the ${selectedIds.length} selected race(s)? This deletes Firestore records and GCS drafts/published files.\n\n${listIds(selectedIds)}`,
      )
    )
      return;
    batchActionLoading = true;
    actionNotice = null;
    try {
      let successCount = 0;
      let errors: string[] = [];
      for (const raceId of selectedIds) {
        try {
          await apiService.deleteRaceRecord(raceId);
          successCount++;
        } catch (err) {
          errors.push(`${raceId}: ${errorMessage(err)}`);
        }
      }
      if (errors.length > 0) {
        setActionNotice(
          "error",
          `Deleted ${successCount} of ${
            selectedIds.length
          } selected race(s). Failures: ${errors.join("; ")}`,
        );
      } else {
        setActionNotice(
          "success",
          `Deleted all ${selectedIds.length} selected race(s).`,
        );
      }
      if (successCount > 0) clearSelection();
      await refresh(false);
    } catch (e) {
      setActionNotice("error", `Batch delete failed: ${errorMessage(e)}`);
    } finally {
      batchActionLoading = false;
    }
  }

  function statusBadgeClass(s: RaceStatusType) {
    switch (s) {
      case "published":
        return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200";
      case "draft":
        return "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200";
      case "queued":
        return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200";
      case "running":
        return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200";
      case "failed":
        return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200";
      case "cancelled":
        return "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200";
      case "idle":
        return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200";
      default:
        return "bg-surface-alt text-content-muted";
    }
  }

  function gradeBadgeClass(g: string) {
    switch (g) {
      case "A":
        return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-200";
      case "B":
        return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-200";
      case "C":
        return "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-200";
      case "D":
        return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200";
      case "F":
        return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200";
      default:
        return "bg-surface-alt text-content-muted border-stroke";
    }
  }

  function formatDate(s?: string) {
    if (!s) return "-";
    return new Date(s).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const STATUS_OPTIONS: { value: RaceStatusType | "all"; label: string }[] = [
    { value: "all", label: "All Statuses" },
    { value: "published", label: "Published" },
    { value: "draft", label: "Draft" },
    { value: "queued", label: "Queued" },
    { value: "running", label: "Running" },
    { value: "failed", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "idle", label: "Idle" },
    { value: "empty", label: "Empty" },
  ];

  onMount(loadData);
</script>

<div class="space-y-4">
  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <input
        type="search"
        aria-label="Search visible races"
        value={globalFilter}
        on:input={handleGlobalFilterInput}
        placeholder="Search visible races..."
        class="flex-1 max-w-md px-3 py-2 text-sm border border-stroke rounded-lg bg-surface text-content focus:outline-none focus:border-blue-500"
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
      <button
        type="button"
        class="px-4 py-2 text-sm border border-stroke rounded-lg hover:bg-surface-alt text-content transition-colors font-medium"
        on:click={() => loadData()}
      >
        Refresh
      </button>
    </div>
  </div>

  <!-- Advanced Filters -->
  <div
    class="flex items-center gap-4 flex-wrap bg-surface-alt p-3 rounded-lg border border-stroke text-sm"
  >
    <div class="flex items-center gap-2">
      <span class="text-content-muted font-medium">Filters:</span>
    </div>

    <!-- Jurisdiction/State Search -->
    <div class="flex items-center gap-1.5">
      <label for="jurisdiction-filter" class="text-content-muted text-xs"
        >Jurisdiction:</label
      >
      <input
        id="jurisdiction-filter"
        type="text"
        bind:value={jurisdictionFilter}
        placeholder="e.g. Georgia, CA..."
        class="px-2.5 py-1 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500 w-36"
      />
    </div>

    <!-- Quality Grade Filter -->
    <div class="flex items-center gap-1.5">
      <label for="quality-filter" class="text-content-muted text-xs"
        >Quality:</label
      >
      <select
        id="quality-filter"
        bind:value={qualityFilter}
        class="px-2 py-1 text-xs border border-stroke rounded bg-surface text-content focus:outline-none focus:border-blue-500"
      >
        <option value="all">All Grades</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
        <option value="D">D</option>
        <option value="F">F</option>
        <option value="-">No Grade (-)</option>
      </select>
    </div>

    <!-- Show Only Unpublished Changes Toggle -->
    <label
      class="flex items-center gap-2 cursor-pointer select-none text-content text-xs"
    >
      <input
        type="checkbox"
        bind:checked={onlyUnpublishedFilter}
        class="rounded border-stroke bg-surface text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
      />
      <span>Show only with unpublished changes</span>
    </label>
  </div>

  {#if actionNotice}
    <div
      class="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm {actionNotice.type ===
      'success'
        ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200'
        : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'}"
      role={actionNotice.type === "error" ? "alert" : "status"}
    >
      <span>{actionNotice.message}</span>
      <button
        type="button"
        class="shrink-0 font-semibold opacity-70 hover:opacity-100"
        aria-label="Dismiss message"
        on:click={() => (actionNotice = null)}
      >
        Close
      </button>
    </div>
  {/if}

  {#if staleError && !error}
    <div
      class="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      role="status"
    >
      <span>Showing the last loaded data; refresh failed: {staleError}</span>
      <button
        type="button"
        class="shrink-0 font-semibold underline"
        on:click={() => loadData()}>Retry</button
      >
    </div>
  {/if}

  {#if error}
    <div
      class="card p-6 flex flex-col items-center justify-center text-center space-y-3"
    >
      <p class="text-sm text-red-600">{error}</p>
      <button
        type="button"
        class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium shadow-sm"
        on:click={() => refresh()}
      >
        Retry
      </button>
    </div>
  {:else if loading}
    <!-- CSS Pulse Skeleton Loader -->
    <div class="card overflow-hidden">
      <div class="animate-pulse space-y-4 p-4 bg-surface">
        <div class="h-8 bg-surface-alt rounded w-1/4"></div>
        <div class="space-y-3">
          <div class="h-4 bg-surface-alt rounded"></div>
          <div class="h-4 bg-surface-alt rounded w-5/6"></div>
          <div class="h-4 bg-surface-alt rounded w-2/3"></div>
          <div class="h-4 bg-surface-alt rounded"></div>
          <div class="h-4 bg-surface-alt rounded w-3/4"></div>
        </div>
      </div>
    </div>
  {:else if filteredCount === 0}
    <div class="card p-8 text-center text-content-faint text-sm">
      No races found
    </div>
  {:else}
    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-surface-alt border-b border-stroke">
            <tr>
              {#each $table.getHeaderGroups()[0].headers as header}
                <th
                  scope="col"
                  class="px-4 py-3 text-left font-semibold text-content-muted align-middle whitespace-nowrap"
                >
                  {#if !header.isPlaceholder}
                    {#if header.column.id === "select"}
                      <input
                        type="checkbox"
                        checked={$table.getIsAllPageRowsSelected()}
                        indeterminate={$table.getIsSomePageRowsSelected() &&
                          !$table.getIsAllPageRowsSelected()}
                        on:change={$table.getToggleAllPageRowsSelectedHandler()}
                        class="rounded border-stroke bg-surface text-blue-600 focus:ring-blue-500"
                        aria-label="Select all visible rows"
                      />
                    {:else}
                      <button
                        type="button"
                        class="group inline-flex items-center gap-1 text-left hover:text-content disabled:cursor-default disabled:hover:text-content-muted"
                        disabled={!header.column.getCanSort()}
                        on:click={header.column.getToggleSortingHandler()}
                      >
                        <span>{header.column.columnDef.header}</span>
                        {#if header.column.getCanSort()}
                          <span
                            class="inline-flex h-4 w-4 items-center justify-center text-content-faint group-hover:text-content-muted"
                            aria-hidden="true"
                          >
                            {#if header.column.getIsSorted() === "asc"}
                              <svg
                                viewBox="0 0 16 16"
                                class="h-3 w-3"
                                fill="currentColor"
                                ><path d="M8 3 3.5 9h9L8 3z" /></svg
                              >
                            {:else if header.column.getIsSorted() === "desc"}
                              <svg
                                viewBox="0 0 16 16"
                                class="h-3 w-3"
                                fill="currentColor"
                                ><path d="M8 13 3.5 7h9L8 13z" /></svg
                              >
                            {:else}
                              <svg
                                viewBox="0 0 16 16"
                                class="h-3 w-3 opacity-60"
                                fill="currentColor"
                                ><path
                                  d="M8 2.5 4.5 7h7L8 2.5zM8 13.5 4.5 9h7L8 13.5z"
                                /></svg
                              >
                            {/if}
                          </span>
                        {/if}
                      </button>
                    {/if}
                  {/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody class="divide-y divide-stroke bg-surface">
            {#each $table.getRowModel().rows as tableRow (tableRow.id)}
              {@const row = tableRow.original}
              <tr
                class="hover:bg-surface-alt transition-colors {hasPendingDraft(
                  row,
                )
                  ? 'bg-amber-50/20 dark:bg-amber-900/5'
                  : ''}"
              >
                {#each tableRow.getVisibleCells() as cell}
                  <td class="px-4 py-3 align-middle">
                    {#if cell.column.id === "select"}
                      <input
                        type="checkbox"
                        checked={tableRow.getIsSelected()}
                        disabled={!tableRow.getCanSelect()}
                        on:change={tableRow.getToggleSelectedHandler()}
                        class="rounded border-stroke bg-surface text-blue-600 focus:ring-blue-500"
                        aria-label="Select row {row.race_id}"
                      />
                    {:else if cell.column.id === "race_id"}
                      <div
                        class="font-mono text-xs text-content whitespace-nowrap flex items-center gap-1.5"
                      >
                        <span>{cell.getValue()}</span>
                        {#if row.status === "running"}
                          <span
                            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200"
                          >
                            <svg
                              class="animate-spin h-2.5 w-2.5"
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                class="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                stroke-width="4"
                              />
                              <path
                                class="opacity-75"
                                fill="currentColor"
                                d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            running
                          </span>
                        {:else if row.status === "queued"}
                          <span
                            class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200"
                          >
                            queued
                          </span>
                        {/if}
                      </div>
                    {:else if cell.column.id === "title"}
                      <div
                        class="text-content max-w-xs truncate"
                        title={String(cell.getValue() || "")}
                      >
                        {cell.getValue() ?? "-"}
                      </div>
                    {:else if cell.column.id === "jurisdiction"}
                      <div class="text-content-muted max-w-[150px] truncate">
                        {cell.getValue() ?? "-"}
                      </div>
                    {:else if cell.column.id === "candidate_count"}
                      <span class="text-content-muted font-mono"
                        >{cell.getValue() ?? "-"}</span
                      >
                    {:else if cell.column.id === "draft_updated_at"}
                      <span class="text-content-muted whitespace-nowrap"
                        >{hasDraft(row)
                          ? formatDate(String(cell.getValue() || ""))
                          : "-"}</span
                      >
                    {:else if cell.column.id === "status"}
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span
                          class="px-2 py-0.5 rounded-full text-xs font-medium {statusBadgeClass(
                            row.status,
                          )}"
                        >
                          {row.status}
                        </span>
                        {#if isDiscoveryOnly(row)}
                          <span
                            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700"
                            title="Last run was discovery-only - candidates found but issues/research/finance not yet populated"
                          >
                            <svg
                              class="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              stroke-width="2"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                              />
                            </svg>
                            discovery
                          </span>
                        {/if}
                        {#if hasPendingDraft(row)}
                          <span
                            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                            title="Draft has changes newer than the published page"
                          >
                            Unpublished Changes
                          </span>
                        {:else if hasDraft(row)}
                          <span
                            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                            title={hasPublished(row)
                              ? "Draft available"
                              : "Unpublished draft available"}
                          >
                            draft
                          </span>
                        {/if}
                      </div>
                    {:else if cell.column.id === "total_runs"}
                      <span class="text-content-muted font-mono"
                        >{cell.getValue() ?? 0}</span
                      >
                    {:else if cell.column.id === "quality"}
                      {#if row.quality_grade}
                        <span
                          class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border {gradeBadgeClass(
                            row.quality_grade,
                          )}"
                        >
                          {row.quality_grade}
                        </span>
                      {:else}
                        <span class="text-content-faint">-</span>
                      {/if}
                    {:else if cell.column.id === "actions"}
                      <div
                        class="flex min-w-[190px] items-center justify-end gap-2 whitespace-nowrap"
                      >
                        <button
                          type="button"
                          class="min-w-[72px] rounded border border-stroke bg-surface px-2.5 py-1.5 text-xs font-medium text-content transition-colors hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!previewUrl(row)}
                          title={hasDraft(row)
                            ? "Open draft preview"
                            : hasPublished(row)
                              ? "Open published page"
                              : "No page exists"}
                          on:click={() => handlePreview(row)}
                        >
                          {hasDraft(row) ? "View Draft" : "View Page"}
                        </button>
                        <select
                          bind:value={rowActionChoice[row.race_id]}
                          class="w-[150px] rounded border border-stroke bg-surface px-2 py-1.5 text-xs font-medium text-content transition-colors hover:bg-surface-alt disabled:cursor-wait disabled:opacity-50"
                          disabled={!!rowActionLoading[row.race_id]}
                          aria-label="Actions for {row.race_id}"
                        >
                          <option value="">
                            {rowActionLoading[row.race_id]
                              ? "Working..."
                              : "Actions..."}
                          </option>
                          {#each rowActionOptions(row) as option (option.value)}
                            <option value={option.value}>{option.label}</option>
                          {/each}
                        </select>
                        <button
                          type="button"
                          class="rounded border border-stroke bg-surface px-2.5 py-1.5 text-xs font-medium text-content transition-colors hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!!rowActionLoading[row.race_id] ||
                            !isValidRowAction(
                              row,
                              rowActionChoice[row.race_id],
                            )}
                          aria-label="Run selected action for {row.race_id}"
                          on:click={() => handleRowAction(row)}
                        >
                          Go
                        </button>
                      </div>
                    {:else}
                      {cell.getValue() ?? ""}
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div
        class="px-4 py-2 bg-surface-alt border-t border-stroke text-xs text-content-subtle flex items-center justify-between"
      >
        <span>
          {filteredCount} race{filteredCount !== 1 ? "s" : ""}
          {#if globalFilter}
            matching "{globalFilter}"{/if}
          {#if statusFilter !== "all"}
            · filtered by {statusFilter}{/if}
        </span>
        <span>
          {footerCounts.published} published ·
          {footerCounts.draft} draft ·
          {footerCounts.active} active
          {#if footerCounts.discoveryOnly > 0}
            · <span class="text-violet-600 dark:text-violet-400"
              >{footerCounts.discoveryOnly} discovery-only</span
            >
          {/if}
        </span>
      </div>
    </div>
  {/if}
</div>

<!-- Floating Batch Toolbar -->
{#if selectedCount > 0}
  <div
    role="region"
    aria-label="Batch actions"
    class="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border border-stroke bg-surface px-4 py-3 shadow-2xl"
  >
    <span class="text-sm font-medium text-content">
      {selectedCount} race{selectedCount === 1 ? "" : "s"} selected
    </span>
    <div class="hidden h-4 w-px bg-stroke sm:block"></div>
    <div class="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        class="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-full font-medium transition-colors disabled:opacity-50"
        disabled={batchActionLoading}
        on:click={handleBatchPublish}
      >
        Batch Publish
      </button>
      <button
        type="button"
        class="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-full font-medium transition-colors disabled:opacity-50"
        disabled={batchActionLoading}
        title="Queue a lightweight refresh ({REFRESH_STEPS.join(
          ', ',
        )}) for up to {MAX_BATCH_QUEUE} races"
        on:click={handleBatchRun}
      >
        Batch Refresh
      </button>
      <button
        type="button"
        class="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-full font-medium transition-colors disabled:opacity-50"
        disabled={batchActionLoading}
        on:click={handleBatchDelete}
      >
        Batch Delete
      </button>
      <button
        type="button"
        class="px-3 py-1.5 text-xs border border-stroke hover:bg-surface-alt text-content rounded-full font-medium transition-colors disabled:opacity-50"
        disabled={batchActionLoading}
        on:click={clearSelection}
      >
        Clear Selection
      </button>
    </div>
  </div>
{/if}
