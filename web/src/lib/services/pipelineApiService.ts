/**
 * Pipeline API service for handling server communication
 */
import { fetchWithAuth } from "$lib/stores/apiStore";
import {
  API_TIMEOUT_SHORT,
  API_TIMEOUT_DEFAULT,
  API_TIMEOUT_ARTIFACT,
} from "$lib/config/constants";
import type { RunInfo, RunOptions, RunHistoryItem, RaceRecord } from "$lib/types";

export interface AdminChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AdminChatAction {
  type: string; // "queue_run"
  race_ids?: string[];
  options?: Record<string, unknown>;
  description?: string;
}

/** Lightweight race metadata returned alongside a chat action */
export interface AdminChatRaceRecord {
  race_id: string;
  title?: string;
  status: string;
  quality_grade?: string;
  quality_score?: number;
  freshness?: string;
  candidate_count: number;
  last_run_at?: string;
  last_run_status?: string;
  requests_24h: number;
  published_at?: string;
  draft_updated_at?: string;
  discovery_only?: boolean;
}

export interface AdminChatResponse {
  reply: string;
  action: AdminChatAction | null;
  race_records?: AdminChatRaceRecord[];
  question?: string | null;
  thinking_steps?: string[];
}

interface RunsResponse {
  runs: RunInfo[];
}

export interface PublishedRaceSummary {
  id: string;
  title?: string;
  office?: string;
  jurisdiction?: string;
  state?: string;
  election_date: string;
  updated_utc: string;
  candidates: { name: string; party?: string; incumbent?: boolean; image_url?: string }[];
  agent_metrics?: { estimated_usd?: number; model?: string; total_tokens?: number } | null;
}

interface PublishedRacesResponse {
  races: PublishedRaceSummary[];
}

export interface QueueItem {
  id: string;
  race_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  options: Record<string, unknown>;
  run_id?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

interface QueueResponse {
  items: QueueItem[];
  running: boolean;
  pending: number;
}

interface QueueAddResponse {
  added: QueueItem[];
  errors: Array<{ race_id: string; error: string }>;
}

interface RaceListResponse {
  races: RaceRecord[];
}

interface RaceQueueResponse {
  added: RaceRecord[];
  errors: Array<{ race_id: string; error: string }>;
}

interface RaceRunsResponse {
  runs: RunInfo[];
  count: number;
}

export interface RaceVersion {
  filename: string;
  source: "draft" | "published" | string;
  archived_at: string | null;
  size_bytes: number;
}

export class PipelineApiService {
  constructor(private apiBase: string) {}

  /**
   * Load run history from Firestore (via /runs endpoint).
   * Firestore run docs have: run_id, race_id, status, progress, current_step,
   * started_at, completed_at, duration_ms, error, options — but NOT steps[] or logs[].
   */
  async loadRunHistory(): Promise<RunHistoryItem[]> {
    const res = await fetchWithAuth(`${this.apiBase}/runs`, {}, API_TIMEOUT_SHORT);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: RunsResponse = await res.json();
    const runs = data.runs || [];

    return runs.map((r: RunInfo, idx: number) => ({
      ...(r as any),
      run_id: (r as any).run_id || (r as any).id,
      display_id: runs.length - idx,
      updated_at: (r as any).completed_at || (r as any).started_at,
      // Firestore runs expose current_step instead of a steps array.
      last_step: (r as any).current_step ?? undefined,
      // Fields not present in Firestore run docs — supply safe defaults.
      steps: [],
      payload: { race_id: (r as any).race_id },
      artifact_id: undefined,
    } as RunHistoryItem));
  }

  /**
   * Delete a run from history (or cancel if still active)
   */
  async deleteRun(runId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
      API_TIMEOUT_SHORT
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
    const res = await fetchWithAuth(`${this.apiBase}/run/${runId}`, {}, API_TIMEOUT_DEFAULT);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Load run logs from Firestore subcollection via /runs/{runId}/logs.
   * Pass `since` to only fetch entries after that index (incremental polling).
   */
  async getRunLogs(
    runId: string,
    since = 0
  ): Promise<{ logs: import("$lib/types").LogEntry[]; total: number }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/runs/${encodeURIComponent(runId)}/logs?since=${since}`,
      {},
      API_TIMEOUT_SHORT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Load published race summaries
   */
  async loadPublishedRaces(): Promise<PublishedRaceSummary[]> {
    const res = await fetchWithAuth(`${this.apiBase}/races/summaries`, {}, API_TIMEOUT_SHORT);
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
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Delete a published race
   */
  async deletePublishedRace(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/races/${encodeURIComponent(raceId)}/admin`,
      { method: "DELETE" },
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  // -- Drafts API ---------------------------------------------------------

  /**
   * Load draft race summaries
   */
  async loadDraftRaces(): Promise<PublishedRaceSummary[]> {
    const res = await fetchWithAuth(`${this.apiBase}/drafts`, {}, API_TIMEOUT_SHORT);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: PublishedRacesResponse = await res.json();
    return data.races || [];
  }

  /**
   * Get full draft race data (for preview)
   */
  async getDraftRace(raceId: string): Promise<Record<string, unknown>> {
    const res = await fetchWithAuth(
      `${this.apiBase}/drafts/${encodeURIComponent(raceId)}`,
      {},
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Publish a draft race (copy from drafts/ to races/)
   */
  async publishDraft(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/drafts/${encodeURIComponent(raceId)}/publish`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  /**
   * Unpublish a race (remove from published, keep draft)
   */
  async unpublishRace(raceId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/unpublish`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT
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
      `${this.apiBase}/drafts/${encodeURIComponent(raceId)}`,
      { method: "DELETE" },
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      // Idempotent behavior: treat missing draft as already deleted.
      if (res.status === 404 && errorText.toLowerCase().includes("draft not found")) {
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
    const res = await fetchWithAuth(`${this.apiBase}/queue`, {}, API_TIMEOUT_SHORT);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Add races to the processing queue
   */
  async addToQueue(
    raceIds: string[],
    options: RunOptions = {}
  ): Promise<QueueAddResponse> {
    const res = await fetchWithAuth(`${this.apiBase}/queue`, {
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
    const url = `${this.apiBase}/queue/${encodeURIComponent(itemId)}${force ? "?force=true" : ""}`;
    const res = await fetchWithAuth(url, { method: "DELETE" }, API_TIMEOUT_SHORT);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  /**
   * Clear completed/failed items from queue
   */
  async clearFinishedQueue(): Promise<{ removed: number }> {
    const res = await fetchWithAuth(`${this.apiBase}/queue/finished`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Clear all pending (not yet started) items from queue
   */
  async clearPendingQueue(): Promise<{ removed: number }> {
    const res = await fetchWithAuth(`${this.apiBase}/queue/pending`, {
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
    const res = await fetchWithAuth(`${this.apiBase}/api/races`, {}, API_TIMEOUT_DEFAULT);
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
      API_TIMEOUT_SHORT
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
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  /**
   * Queue races for pipeline processing (unified)
   */
  async queueRaces(
    raceIds: string[],
    options: RunOptions = {}
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
      API_TIMEOUT_SHORT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  /**
   * Recheck race status from storage (recover stuck 'running' races)
   */
  async recheckRace(raceId: string): Promise<{ race: import("$lib/types").RaceRecord }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/recheck`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Run pipeline for a single race (direct, not queued)
   */
  async runRace(
    raceId: string,
    options: RunOptions = {}
  ): Promise<{ run_id: string; status: string; race_id: string }> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      }
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
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
  }

  /**
   * Batch publish multiple races at once
   */
  async batchPublishRaces(raceIds: string[]): Promise<{ published: string[]; errors: Array<{ race_id: string; error: string }> }> {
    const res = await fetchWithAuth(`${this.apiBase}/api/races/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ race_ids: raceIds }),
    }, API_TIMEOUT_ARTIFACT);
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
      API_TIMEOUT_DEFAULT
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
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/runs?limit=${limit}`,
      {},
      API_TIMEOUT_SHORT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: RaceRunsResponse = await res.json();
    return data.runs || [];
  }

  /**
   * Get run details for a specific race
   */
  async getRaceRun(raceId: string, runId: string): Promise<RunInfo> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/runs/${encodeURIComponent(runId)}`,
      {},
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Delete or cancel a run for a specific race
   */
  async deleteRaceRun(raceId: string, runId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
      API_TIMEOUT_SHORT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  /**
   * Get full race JSON data (published or draft)
   */
  async getRaceData(raceId: string, draft: boolean = false): Promise<Record<string, unknown>> {
    const params = draft ? "?draft=true" : "";
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/data${params}`,
      {},
      API_TIMEOUT_DEFAULT
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
      API_TIMEOUT_SHORT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data: { versions: RaceVersion[]; count: number } = await res.json();
    return data.versions || [];
  }

  /**
   * Get JSON content of a specific retired version
   */
  async getRaceVersionData(raceId: string, filename: string): Promise<Record<string, unknown>> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/versions/${encodeURIComponent(filename)}`,
      {},
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Restore a retired version as the active draft
   */
  async restoreVersionAsDraft(raceId: string, filename: string): Promise<void> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/races/${encodeURIComponent(raceId)}/versions/${encodeURIComponent(filename)}/restore`,
      { method: "POST" },
      API_TIMEOUT_DEFAULT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // -- Admin chat ---------------------------------------------------------

  /**
   * Send a chat message to the admin AI assistant.
   * Returns the assistant reply and an optional action to confirm.
   */
  async adminChat(
    messages: AdminChatMessage[]
  ): Promise<AdminChatResponse> {
    const res = await fetchWithAuth(
      `${this.apiBase}/api/admin-chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      },
      60_000 // allow up to 60 s for LLM response
    );
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${errorText}`);
    }
    return await res.json();
  }

}
