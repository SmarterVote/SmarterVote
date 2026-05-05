/**
 * Run-progress polling store.
 *
 * Polls the races-api REST endpoints while a run is active instead of keeping
 * a persistent socket open.
 */

import { writable } from "svelte/store";

type PipelineEvent =
  | { type: "log"; level: string; message: string; timestamp?: string; run_id?: string }
  | { type: "run_started"; run_id: string; step: string }
  | { type: "run_progress"; progress?: number; message?: string }
  | { type: "run_completed"; result?: unknown; artifact_id?: string; duration_ms?: number }
  | { type: "run_failed"; error?: string }
  | { type: "run_status"; data: { run_id: string; status: string; [key: string]: unknown } }
  | { type: "buffered_logs"; data: { level: string; message: string; timestamp?: string; run_id?: string }[] };

interface PollingState {
  connected: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

const initialState: PollingState = {
  connected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 20,
};

export const runPollingStore = writable<PollingState>(initialState);

let apiBase = "";
let token = "";
let runPollTimer: ReturnType<typeof setInterval> | null = null;
let logPollTimer: ReturnType<typeof setInterval> | null = null;
let logsSeen = 0;

let onMessage: ((event: PipelineEvent) => void) | null = null;
let onLog: ((level: string, msg: string, ts?: string, run_id?: string) => void) | null = null;

function authHeaders(): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function pollRunStatus(runId: string): Promise<void> {
  if (!apiBase) return;
  try {
    const res = await fetch(`${apiBase}/runs/${runId}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const run = await res.json();

    const status: string = run.status ?? "";
    const progress: number = run.progress ?? 0;
    const currentStep: string | undefined = run.current_step ?? undefined;

    onMessage?.({
      type: "run_progress",
      progress,
      message: currentStep ? `Running: ${currentStep}` : undefined,
    });

    onMessage?.({
      type: "run_status",
      data: { run_id: runId, status, progress, current_step: currentStep ?? null, ...run },
    });

    if (status === "completed") {
      stopPolling();
      onMessage?.({ type: "run_completed", result: run });
      runPollingStore.update((s) => ({ ...s, connected: false }));
    } else if (status === "failed") {
      stopPolling();
      onMessage?.({ type: "run_failed", error: run.error ?? "Run failed" });
      runPollingStore.update((s) => ({ ...s, connected: false }));
    } else if (status === "cancelled" || status === "continued") {
      stopPolling();
      runPollingStore.update((s) => ({ ...s, connected: false }));
    }
  } catch {
    // Transient poll failures are expected during deploys and cold starts.
  }
}

async function pollLogs(runId: string): Promise<void> {
  if (!apiBase) return;
  try {
    const res = await fetch(`${apiBase}/runs/${runId}/logs?since=${logsSeen}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const entries: { level?: string; message?: string; timestamp?: string; run_id?: string }[] =
      data.logs ?? [];
    if (entries.length === 0) return;

    logsSeen += entries.length;

    for (const entry of entries) {
      onLog?.(entry.level ?? "info", entry.message ?? "", entry.timestamp, entry.run_id ?? runId);
    }
  } catch {
    // Transient poll failures are expected during deploys and cold starts.
  }
}

function stopPolling(): void {
  if (runPollTimer) {
    clearInterval(runPollTimer);
    runPollTimer = null;
  }
  if (logPollTimer) {
    clearInterval(logPollTimer);
    logPollTimer = null;
  }
}

export const runPollingActions = {
  setHandlers(handlers: {
    onMessage?: (event: PipelineEvent) => void;
    onLog?: (level: string, msg: string, ts?: string, run_id?: string) => void;
  }) {
    onMessage = handlers.onMessage ?? null;
    onLog = handlers.onLog ?? null;
  },

  connect(nextApiBase: string, nextToken: string) {
    apiBase = nextApiBase;
    token = nextToken;
    runPollingStore.update((s) => ({ ...s, connected: true, reconnectAttempts: 0 }));
    onLog?.("info", "Live updates active (polling mode)");
  },

  disconnect() {
    stopPolling();
    logsSeen = 0;
    runPollingStore.update((s) => ({ ...s, connected: false }));
  },

  send(_message: Record<string, unknown>) {},

  watchRun(runId: string) {
    stopPolling();
    logsSeen = 0;
    runPollingStore.update((s) => ({ ...s, connected: true }));
    void pollRunStatus(runId);
    void pollLogs(runId);
    runPollTimer = setInterval(() => void pollRunStatus(runId), 2000);
    logPollTimer = setInterval(() => void pollLogs(runId), 3000);
  },

  stopWatching() {
    stopPolling();
    runPollingStore.update((s) => ({ ...s, connected: false }));
  },

  updateToken(nextToken: string) {
    token = nextToken;
  },
};
