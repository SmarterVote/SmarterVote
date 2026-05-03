/**
 * Run-progress polling store — drop-in replacement for websocketStore.
 *
 * Instead of keeping a persistent WebSocket connection (which pins the Cloud
 * Run instance), this store polls the races-api REST endpoint every 2 s while
 * a run is active and every 3 s for new log entries.
 *
 * The exported interface (`websocketStore`, `websocketActions`) is identical to
 * the old WebSocket store so no call-site changes are needed except for
 * optionally calling `websocketActions.watchRun(runId)` after a run starts.
 */

import { writable } from "svelte/store";

// ---------------------------------------------------------------------------
// Types (kept compatible with old WebSocket event shapes)
// ---------------------------------------------------------------------------

type PipelineEvent =
  | { type: "log"; level: string; message: string; timestamp?: string; run_id?: string }
  | { type: "run_started"; run_id: string; step: string }
  | { type: "run_progress"; progress?: number; message?: string }
  | { type: "run_completed"; result?: unknown; artifact_id?: string; duration_ms?: number }
  | { type: "run_failed"; error?: string }
  | { type: "run_status"; data: { run_id: string; status: string; [key: string]: unknown } }
  | { type: "buffered_logs"; data: { level: string; message: string; timestamp?: string; run_id?: string }[] };

interface PollingState {
  /** Kept for template compatibility — always null in polling mode. */
  ws: null;
  /** True when polling is active (a run is being watched). */
  connected: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialState: PollingState = {
  ws: null,
  connected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 20,
};

export const websocketStore = writable<PollingState>(initialState);

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _apiBase = "";
let _token = "";
let _runPollTimer: ReturnType<typeof setInterval> | null = null;
let _logPollTimer: ReturnType<typeof setInterval> | null = null;
let _logsSeen = 0;

let _onMessage: ((event: PipelineEvent) => void) | null = null;
let _onLog: ((level: string, msg: string, ts?: string, run_id?: string) => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _authHeaders(): HeadersInit {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}

async function _pollRunStatus(runId: string): Promise<void> {
  if (!_apiBase) return;
  try {
    const res = await fetch(`${_apiBase}/runs/${runId}`, {
      headers: _authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const run = await res.json();

    const status: string = run.status ?? "";
    const progress: number = run.progress ?? 0;
    const currentStep: string | undefined = run.current_step ?? undefined;

    _onMessage?.({
      type: "run_progress",
      progress,
      message: currentStep ? `Running: ${currentStep}` : undefined,
    });

    _onMessage?.({
      type: "run_status",
      data: { run_id: runId, status, progress, current_step: currentStep ?? null, ...run },
    });

    if (status === "completed") {
      _stopPolling();
      _onMessage?.({ type: "run_completed", result: run });
      websocketStore.update((s) => ({ ...s, connected: false }));
    } else if (status === "failed") {
      _stopPolling();
      _onMessage?.({ type: "run_failed", error: run.error ?? "Run failed" });
      websocketStore.update((s) => ({ ...s, connected: false }));
    } else if (status === "cancelled" || status === "continued") {
      _stopPolling();
      websocketStore.update((s) => ({ ...s, connected: false }));
    }
  } catch {
    // Silently ignore transient poll failures
  }
}

async function _pollLogs(runId: string): Promise<void> {
  if (!_apiBase) return;
  try {
    const url = `${_apiBase}/runs/${runId}/logs?since=${_logsSeen}`;
    const res = await fetch(url, {
      headers: _authHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const entries: { level?: string; message?: string; timestamp?: string; run_id?: string }[] =
      data.logs ?? [];
    if (entries.length === 0) return;

    _logsSeen += entries.length;

    for (const entry of entries) {
      const level = entry.level ?? "info";
      const message = entry.message ?? "";
      const ts = entry.timestamp;
      const rid = entry.run_id ?? runId;
      _onLog?.(level, message, ts, rid);
    }
  } catch {
    // Silently ignore
  }
}

function _stopPolling(): void {
  if (_runPollTimer) {
    clearInterval(_runPollTimer);
    _runPollTimer = null;
  }
  if (_logPollTimer) {
    clearInterval(_logPollTimer);
    _logPollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Public actions (same interface as the old websocketActions)
// ---------------------------------------------------------------------------

export const websocketActions = {
  setHandlers(handlers: {
    onMessage?: (event: PipelineEvent) => void;
    onLog?: (level: string, msg: string, ts?: string, run_id?: string) => void;
  }) {
    _onMessage = handlers.onMessage ?? null;
    _onLog = handlers.onLog ?? null;
  },

  connect(apiBase: string, token: string) {
    _apiBase = apiBase;
    _token = token;
    websocketStore.update((s) => ({ ...s, connected: true, reconnectAttempts: 0 }));
    _onLog?.("info", "Live updates active (polling mode)");
  },

  disconnect() {
    _stopPolling();
    _logsSeen = 0;
    websocketStore.update((s) => ({ ...s, connected: false }));
  },

  /** No-op: kept for call-site compatibility. */
  send(_message: Record<string, unknown>) {},

  watchRun(runId: string) {
    _stopPolling();
    _logsSeen = 0;
    websocketStore.update((s) => ({ ...s, connected: true }));
    _pollRunStatus(runId);
    _pollLogs(runId);
    _runPollTimer = setInterval(() => _pollRunStatus(runId), 2000);
    _logPollTimer = setInterval(() => _pollLogs(runId), 3000);
  },

  stopWatching() {
    _stopPolling();
    websocketStore.update((s) => ({ ...s, connected: false }));
  },

  updateToken(token: string) {
    _token = token;
  },
};
