/**
 * Pipeline API service for handling server communication
 */
import { fetchWithAuth } from "$lib/stores/apiStore";
import {
  API_TIMEOUT_SHORT,
  API_TIMEOUT_DEFAULT,
  API_TIMEOUT_ARTIFACT,
} from "$lib/config/constants";
import { PIPELINE_STEPS } from "$lib/types";
import type {
  RunInfo,
  RunOptions,
  RunHistoryItem,
  RaceRecord,
  RunStep,
  ChamberForecasts,
  ResearchCheckpoint,
  ResearchCheckpointInput,
  ResearchProgramStatus,
  LogEntry,
} from "$lib/types";
import type {
  ChamberForecastGenerateResponse,
  PublishedRaceSummary,
  PublishedRacesResponse,
  QueueAddResponse,
  QueueResponse,
  RaceListResponse,
  RaceQueueResponse,
  RaceRunsResponse,
  RaceVersion,
  RunsResponse,
} from "$lib/services/pipelineApiTypes";

/** Server-side cap on `GET /runs?limit=` (services/races-api/routers/runs.py). */
export const RUN_HISTORY_MAX_LIMIT = 500;
/** Page size for `GET /runs/{id}/logs` (server caps at 5000). */
export const RUN_LOG_PAGE_SIZE = 1000;

export type RunLogsPage = {
  logs: LogEntry[];
  total: number;
  next_cursor?: string | null;
  has_more?: boolean;
};

export type {
  ChamberForecastGenerateResponse,
  PublishedRaceSummary,
  QueueItem,
  RaceVersion,
} from "$lib/services/pipelineApiTypes";

export class PipelineApiService {
  constructor(private apiBase: string) {}

  async getResearchProgramStatus(): Promise<ResearchProgramStatus> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/research/status`,
      {},
      API_TIMEOUT_ARTIFACT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  async recordResearchCheckpoint(
    raceId: string,
    checkpoint: ResearchCheckpointInput,
  ): Promise<ResearchCheckpoint> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/research/checkpoints/${encodeURIComponent(raceId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkpoint),
      },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    return await res.json();
  }

  private normalizeRun(raw: RunInfo | Record<string, unknown>): RunInfo {
    const r = raw as RunInfo & Record<string, unknown>;
    const runId = String(r.run_id || r.id || "");
    const payloadRaceId = (r.payload as Record<string, unknown> | undefined)
      ?.race_id;
    const raceId =
      typeof r.race_id === "string"
        ? r.race_id
        : typeof payloadRaceId === "string"
          ? payloadRaceId
          : undefined;
    const options = r.options ?? {};
    const existingSteps = Array.isArray(r.steps) ? (r.steps as RunStep[]) : [];
    const enabledSteps =
      Array.isArray(options.enabled_steps) && options.enabled_steps.length
        ? options.enabled_steps
        : PIPELINE_STEPS.map((s) => s.id);
    const remainingSteps = Array.isArray(r.remaining_steps)
      ? r.remaining_steps.map(String)
      : undefined;
    const currentStep =
      typeof r.current_step === "string" ? r.current_step : undefined;
    const currentStepProgress =
      typeof r.current_step_progress === "number"
        ? r.current_step_progress
        : undefined;
    const status = (r.status || "pending") as RunInfo["status"];
    const steps = existingSteps.length
      ? existingSteps
      : PIPELINE_STEPS.map((step) => {
          const enabled = enabledSteps.includes(step.id);
          let stepStatus: RunStep["status"] = enabled ? "pending" : "skipped";
          if (
            enabled &&
            remainingSteps &&
            !remainingSteps.includes(step.id) &&
            step.id !== currentStep
          ) {
            stepStatus = "completed";
          }
          if (
            enabled &&
            step.id === currentStep &&
            (status === "running" || status === "pending")
          ) {
            stepStatus = "running";
          }
          if (status === "completed" && enabled) {
            stepStatus = "completed";
          }
          return {
            name: step.id,
            label: step.label,
            weight: step.weight,
            status: stepStatus,
            progress_pct:
              enabled && step.id === currentStep
                ? currentStepProgress
                : undefined,
          };
        });

    return {
      ...(r as RunInfo),
      run_id: runId,
      race_id: raceId,
      status,
      payload: r.payload ?? (raceId ? { race_id: raceId } : {}),
      options,
      progress: typeof r.progress === "number" ? r.progress : undefined,
      progress_message:
        typeof r.progress_message === "string" ? r.progress_message : undefined,
      current_step: currentStep ?? null,
      current_step_progress: currentStepProgress,
      remaining_steps: remainingSteps,
      steps,
    };
  }

  /**
   * Load run history from Firestore (via /runs endpoint).
   * Firestore run docs have: run_id, race_id, status, progress, current_step,
   * started_at, completed_at, duration_ms, error, options — but NOT steps[] or logs[].
   *
   * The server defaults to 50 runs and caps at RUN_HISTORY_MAX_LIMIT; we ask
   * for the cap and report `truncated` when the page came back full.
   */
  async loadRunHistoryPage(
    limit: number = RUN_HISTORY_MAX_LIMIT,
  ): Promise<{ runs: RunHistoryItem[]; truncated: boolean; limit: number }> {
    const effectiveLimit = Math.max(
      1,
      Math.min(Math.floor(limit), RUN_HISTORY_MAX_LIMIT),
    );
    const res = await fetchWithAuth(
      `${this.apiBase}/runs?limit=${effectiveLimit}`,
      {},
      API_TIMEOUT_ARTIFACT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: RunsResponse = await res.json();
    const runs = data.runs || [];

    const items = runs.map((r: RunInfo, idx: number) => {
      const normalized = this.normalizeRun(r);
      return {
        ...normalized,
        run_id: normalized.run_id,
        display_id: runs.length - idx,
        updated_at: normalized.completed_at || normalized.started_at,
        // Firestore runs expose current_step instead of a steps array.
        last_step: normalized.current_step ?? undefined,
        // Fields not present in Firestore run docs — supply safe defaults.
        steps: normalized.steps,
        payload: normalized.payload,
        progress: normalized.progress,
        progress_message: normalized.progress_message,
        current_step: normalized.current_step,
        current_step_progress: normalized.current_step_progress,
      } as RunHistoryItem;
    });
    return {
      runs: items,
      truncated: items.length >= effectiveLimit,
      limit: effectiveLimit,
    };
  }

  async loadRunHistory(
    limit: number = RUN_HISTORY_MAX_LIMIT,
  ): Promise<RunHistoryItem[]> {
    return (await this.loadRunHistoryPage(limit)).runs;
  }

  /**
   * Cancel an active run. Never deletes: the server answers 409 when the run
   * has already finished, so a stale Cancel button cannot erase history.
   */
  async cancelRun(runId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  /**
   * Permanently delete a finished run and its logs (cancels it if still
   * active). Callers must confirm this separately from Cancel.
   */
  async deleteRun(runId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  /**
   * Get run details
   */
  async getRunDetails(runId: string): Promise<RunInfo> {
    const res = await fetchWithAuth(
      `${this.apiBase}/runs/${encodeURIComponent(runId)}`,
      {},
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return this.normalizeRun(await res.json());
  }

  /**
   * Load only logs created after the prior opaque Firestore cursor.
   */
  async getRunLogs(
    runId: string,
    cursor: string | null = null,
    limit: number = RUN_LOG_PAGE_SIZE,
  ): Promise<RunLogsPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    const res = await fetchWithAuth(
      `${this.apiBase}/runs/${encodeURIComponent(runId)}/logs?${params.toString()}`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Page through a run's logs (oldest first) until the server reports no more,
   * keeping only the newest `keep` entries so the end of the run is visible.
   * Returns the cursor to resume live polling from.
   */
  async getRunLogsTail(
    runId: string,
    keep: number,
    options: { maxPages?: number; isCancelled?: () => boolean } = {},
  ): Promise<{
    logs: LogEntry[];
    next_cursor: string | null;
    truncated: boolean;
    complete: boolean;
  }> {
    const maxPages = options.maxPages ?? 50;
    let cursor: string | null = null;
    let logs: LogEntry[] = [];
    let truncated = false;
    let complete = false;
    for (let page = 0; page < maxPages; page++) {
      if (options.isCancelled?.()) break;
      const res = await this.getRunLogs(runId, cursor, RUN_LOG_PAGE_SIZE);
      const pageLogs = res.logs || [];
      logs = logs.concat(pageLogs);
      if (logs.length > keep) {
        truncated = true;
        logs = logs.slice(-keep);
      }
      const nextCursor: string | null = res.next_cursor ?? cursor;
      if (!res.has_more || !pageLogs.length || nextCursor === cursor) {
        cursor = nextCursor;
        complete = true;
        break;
      }
      cursor = nextCursor;
    }
    return { logs, next_cursor: cursor, truncated, complete };
  }

  /**
   * Export a sanitized, self-contained diagnostic bundle for offline review.
   */
  async getRunDiagnostics(runId: string): Promise<Record<string, unknown>> {
    const res = await fetchWithAuth(
      `${this.apiBase}/runs/${encodeURIComponent(runId)}/diagnostics`,
      {},
      API_TIMEOUT_ARTIFACT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Load published race summaries
   */
  async loadPublishedRaces(): Promise<PublishedRaceSummary[]> {
    const res = await fetchWithAuth(
      `${this.apiBase}/races/summaries`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Get full published race data (for export/download)
   */
  async getPublishedRace(raceId: string): Promise<Record<string, unknown>> {
    const res = await fetchWithAuth(
      `${this.apiBase}/races/${encodeURIComponent(raceId)}`,
      {},
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  // -- Drafts API ---------------------------------------------------------

  /**
   * Load draft race summaries
   */
  async loadDraftRaces(): Promise<PublishedRaceSummary[]> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/drafts`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: PublishedRacesResponse = await res.json();
    return data.races || [];
  }

  /**
   * Get full draft race data (for preview)
   */
  async getDraftRace(raceId: string): Promise<Record<string, unknown>> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/data?draft=true`,
      {},
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Publish a draft race (copy from drafts/ to races/)
   */
  async publishDraft(raceId: string): Promise<void> {
    return this.publishRace(raceId);
  }

  /**
   * Unpublish a race (remove from published, keep draft)
   */
  async unpublishRace(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/unpublish`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  /**
   * Delete a draft race
   */
  async deleteDraftRace(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/draft`,
      { method: "DELETE" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      // Idempotent behavior: treat missing draft as already deleted.
      if (
        res.status === 404 &&
        errorText.toLowerCase().includes("draft not found")
      ) {
        return;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  // -- Queue API ----------------------------------------------------------

  /**
   * Get current queue state
   */
  async loadQueue(): Promise<QueueResponse> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/queue`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Add races to the processing queue
   */
  async addToQueue(
    raceIds: string[],
    options: RunOptions = {},
  ): Promise<QueueAddResponse> {
    const res = await fetchWithAuth(`${this.apiBase}/api/races/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ race_ids: raceIds, options }),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
    return await res.json();
  }

  /**
   * Remove or cancel a queue item. If force=true, skip graceful cancel and force-remove.
   */
  async removeQueueItem(itemId: string, force = false): Promise<void> {
    const url = `${this.apiBase}/api/queue/${encodeURIComponent(itemId)}${
      force ? "?force=true" : ""
    }`;
    const res = await fetchWithAuth(
      url,
      { method: "DELETE" },
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status}: ${res.statusText}${errorText ? `. ${errorText}` : ""}`,
      );
    }
  }

  /**
   * Clear completed/failed items from queue
   */
  async clearFinishedQueue(): Promise<{ removed: number }> {
    const res = await fetchWithAuth(`${this.apiBase}/api/queue/finished`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Clear all pending (not yet started) items from queue
   */
  async clearPendingQueue(): Promise<{ removed: number }> {
    const res = await fetchWithAuth(`${this.apiBase}/api/queue/pending`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  // -- Unified Race API (Phase 3) -----------------------------------------

  /**
   * List all race records (unified view)
   */
  async listRaces(): Promise<RaceRecord[]> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races`,
      {},
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: RaceListResponse = await res.json();
    return data.races || [];
  }

  /**
   * Get a single race record
   */
  async getRaceRecord(raceId: string): Promise<RaceRecord> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Delete a race record and all associated data
   */
  async deleteRaceRecord(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}`,
      { method: "DELETE" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  /**
   * Queue races for pipeline processing (unified)
   */
  async queueRaces(
    raceIds: string[],
    options: RunOptions = {},
  ): Promise<RaceQueueResponse> {
    const res = await fetchWithAuth(`${this.apiBase}/api/races/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ race_ids: raceIds, options }),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
    return await res.json();
  }

  /**
   * Cancel a queued or running race
   */
  async cancelRace(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/cancel`,
      { method: "POST" },
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  /**
   * Recheck race status from storage (recover stuck 'running' races)
   */
  async recheckRace(
    raceId: string,
  ): Promise<{ race: import("$lib/types").RaceRecord }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/recheck`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Recheck all race statuses from storage and clear stale active runs
   */
  async recheckAllRaces(): Promise<{
    checked: number;
    updated: number;
    races: import("$lib/types").RaceRecord[];
  }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/recheck`,
      { method: "POST" },
      API_TIMEOUT_ARTIFACT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Run pipeline for a single race (direct, not queued)
   */
  async runRace(
    raceId: string,
    options: RunOptions = {},
  ): Promise<{ run_id: string; status: string; race_id: string }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      },
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
    return await res.json();
  }

  /**
   * Publish a race (draft -> published)
   */
  async publishRace(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/publish`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  /**
   * Batch publish multiple races at once
   */
  async batchPublishRaces(raceIds: string[]): Promise<{
    published: string[];
    errors: Array<{ race_id: string; error: string }>;
  }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ race_ids: raceIds }),
      },
      API_TIMEOUT_ARTIFACT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
    return await res.json();
  }

  /**
   * Unpublish a race
   */
  async unpublishRaceRecord(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/unpublish`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  /**
   * List runs for a specific race
   */
  async listRaceRuns(raceId: string, limit: number = 20): Promise<RunInfo[]> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(
        raceId,
      )}/runs?limit=${limit}`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: RaceRunsResponse = await res.json();
    return (data.runs || []).map((run) => this.normalizeRun(run));
  }

  /**
   * Get run details for a specific race
   */
  async getRaceRun(raceId: string, runId: string): Promise<RunInfo> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(
        raceId,
      )}/runs/${encodeURIComponent(runId)}`,
      {},
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return this.normalizeRun(await res.json());
  }

  /**
   * Delete or cancel a run for a specific race
   */
  async deleteRaceRun(raceId: string, runId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(
        raceId,
      )}/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  /**
   * Get full race JSON data (published or draft)
   */
  async getRaceData(
    raceId: string,
    draft: boolean = false,
  ): Promise<Record<string, unknown>> {
    const params = draft ? "?draft=true" : "";
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/data${params}`,
      {},
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * List retired (archived) versions for a race
   */
  async listRaceVersions(raceId: string): Promise<RaceVersion[]> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/versions`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: { versions: RaceVersion[]; count: number } = await res.json();
    return data.versions || [];
  }

  /**
   * Get JSON content of a specific retired version
   */
  async getRaceVersionData(
    raceId: string,
    filename: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(
        raceId,
      )}/versions/${encodeURIComponent(filename)}`,
      {},
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Restore a retired version as the active draft
   */
  async restoreVersionAsDraft(raceId: string, filename: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(
        raceId,
      )}/versions/${encodeURIComponent(filename)}/restore`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // -- Chamber forecasts --------------------------------------------------

  async getPublishedChamberForecasts(): Promise<ChamberForecasts> {
    const res = await fetchWithAuth(
      `${this.apiBase}/races/chamber_forecasts`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async getChamberForecastDraft(): Promise<ChamberForecasts> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/chamber_forecasts/draft`,
      {},
      API_TIMEOUT_SHORT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  /**
   * Generate a chamber forecast draft.
   *
   * Omit `model` to use the server's default. The browser deliberately does not
   * carry its own copy of that model ID: this file and ForecastsTab both used to
   * hardcode one, and both had drifted onto a model that was older and dearer on
   * output than the one the API actually intended. The default lives in
   * `shared/model_catalog.py` and nowhere else.
   */
  async generateChamberForecastDraft(
    model?: string,
  ): Promise<ChamberForecastGenerateResponse> {
    const trimmed = model?.trim();
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/chamber_forecasts/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed ? { model: trimmed } : {}),
      },
      120_000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async publishChamberForecastDraft(): Promise<{
    message: string;
    updated_at?: string;
  }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/chamber_forecasts/publish`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  }
}
