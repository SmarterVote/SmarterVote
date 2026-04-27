<script lang="ts">
  import { onMount, tick } from "svelte";
  import { PipelineApiService } from "$lib/services/pipelineApiService";
  import type {
    AdminChatMessage,
    AdminChatAction,
    AdminChatRaceRecord,
  } from "$lib/services/pipelineApiService";

  export let apiService: PipelineApiService;

  // ---- types ---------------------------------------------------------------
  interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    ts: number;
  }

  // ---- constants -----------------------------------------------------------
  const SESSION_KEY = "admin-chat-messages";

  // ---- state ---------------------------------------------------------------
  const SUGGESTIONS = [
    "Which races are stale or haven\u2019t been updated recently?",
    "Show me races with a low quality grade",
    "Run a thorough refresh on all draft races",
    "What candidates are in the GA governor race?",
  ];

  const INITIAL_MESSAGE: ChatMessage = {
    role: "assistant",
    content:
      "Hi! I\u2019m your SmarterVote admin assistant.\n\nI can help you:\n- Review race quality, freshness, and candidate details\n- Identify races that need updating\n- Kick off pipeline runs with custom settings\n\nWhat would you like to do?",
    ts: 0,
  };

  function loadMessages(): ChatMessage[] {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return [{ ...INITIAL_MESSAGE, ts: Date.now() }];
  }

  let messages: ChatMessage[] = loadMessages();
  let copiedTs: number | null = null;

  let input = "";
  let sending = false;

  // Pending action waiting for user confirmation
  let pendingAction: AdminChatAction | null = null;
  let pendingActionDescription = "";
  let pendingRaceRecords: AdminChatRaceRecord[] = [];
  let confirmingAction = false;
  let actionResult = "";

  let scrollEl: HTMLElement;
  let userScrolledUp = false;

  // ---- scroll management ---------------------------------------------------
  function onScroll() {
    if (!scrollEl) return;
    const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 60;
    userScrolledUp = !atBottom;
  }

  async function scrollToBottom(force = false) {
    await tick();
    if (scrollEl && (force || !userScrolledUp)) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  // ---- helpers -------------------------------------------------------------
  function formatOptions(opts: Record<string, unknown> | undefined): string {
    if (!opts || !Object.keys(opts).length) return "default options";
    const parts: string[] = [];
    if (opts.force_fresh) parts.push("force fresh");
    if (opts.cheap_mode === false) parts.push("high-quality mode");
    if (Array.isArray(opts.enabled_steps) && opts.enabled_steps.length) {
      parts.push(`steps: ${(opts.enabled_steps as string[]).join(", ")}`);
    }
    if (opts.research_model) parts.push(`model: ${opts.research_model}`);
    if (opts.max_candidates) parts.push(`max candidates: ${opts.max_candidates}`);
    if (opts.note) parts.push(`note: \u201c${opts.note}\u201d`);
    return parts.length ? parts.join(" \u00b7 ") : "default options";
  }

  function gradeColor(grade?: string): string {
    if (!grade) return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    if (grade === "A") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    if (grade === "B") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    if (grade === "C") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
    if (grade === "D") return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  }

  function freshnessColor(f?: string): string {
    if (!f) return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    if (f === "fresh") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    if (f === "recent") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    if (f === "aging") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  }

  function statusColor(s: string): string {
    if (s === "published") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    if (s === "draft") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    if (s === "queued") return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
    if (s === "running") return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300";
    if (s === "failed") return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }

  // ---- copy to clipboard ---------------------------------------------------
  async function copyMessage(content: string, ts: number) {
    try {
      await navigator.clipboard.writeText(content);
      copiedTs = ts;
      setTimeout(() => { copiedTs = null; }, 1500);
    } catch { /* ignore */ }
  }

  function formatTs(ts: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ---- markdown renderer ---------------------------------------------------
  function renderContent(text: string): string {
    let s = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Fenced code blocks
    s = s.replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.slice(3, -3).replace(/^[^\n]+\n/, ""); // strip language tag
      return `<pre class="my-2 p-2 rounded bg-surface-alt text-xs overflow-x-auto border border-stroke">${inner}</pre>`;
    });

    // Inline code
    s = s.replace(/`([^`\n]+)`/g, '<code class="bg-surface-alt border border-stroke px-1 py-0.5 rounded text-xs font-mono">$1</code>');

    // Bold + italic
    s = s.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Lines: process each line
    const lines = s.split("\n");
    const out: string[] = [];
    let inList = false;
    let listTag = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ATX headers
      const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (hMatch) {
        if (inList) { out.push(`</${listTag}>`); inList = false; }
        const lvl = hMatch[1].length;
        const cls = lvl === 1 ? "text-base font-bold mt-3 mb-1" : lvl === 2 ? "text-sm font-bold mt-2 mb-0.5" : "text-sm font-semibold mt-1";
        out.push(`<p class="${cls}">${hMatch[2]}</p>`);
        continue;
      }

      // Unordered list items
      const ulMatch = line.match(/^[-*]\s+(.*)/);
      if (ulMatch) {
        if (!inList || listTag !== "ul") {
          if (inList) out.push(`</${listTag}>`);
          out.push('<ul class="list-disc pl-4 space-y-0.5 my-1">');
          inList = true; listTag = "ul";
        }
        out.push(`<li>${ulMatch[1]}</li>`);
        continue;
      }

      // Ordered list items
      const olMatch = line.match(/^\d+\.\s+(.*)/);
      if (olMatch) {
        if (!inList || listTag !== "ol") {
          if (inList) out.push(`</${listTag}>`);
          out.push('<ol class="list-decimal pl-4 space-y-0.5 my-1">');
          inList = true; listTag = "ol";
        }
        out.push(`<li>${olMatch[1]}</li>`);
        continue;
      }

      // Close list on non-list line
      if (inList && line.trim() !== "") {
        out.push(`</${listTag}>`);
        inList = false;
      }

      // Empty line → paragraph break
      if (line.trim() === "") {
        if (!inList) out.push('<div class="h-2"></div>');
      } else {
        out.push(`<span>${line}</span><br>`);
      }
    }

    if (inList) out.push(`</${listTag}>`);
    return out.join("");
  }

  // ---- send message --------------------------------------------------------
  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    if (!text) input = "";

    messages = [...messages, { role: "user", content: msg, ts: Date.now() }];
    userScrolledUp = false;
    await scrollToBottom(true);

    sending = true;
    pendingAction = null;
    pendingRaceRecords = [];
    actionResult = "";

    try {
      const history: AdminChatMessage[] = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const res = await apiService.adminChat(history);

      messages = [...messages, { role: "assistant", content: res.reply, ts: Date.now() }];

      if (res.action?.type === "queue_run") {
        pendingAction = res.action;
        pendingActionDescription = res.action.description || "Queue a pipeline run";
        pendingRaceRecords = res.race_records ?? [];
      }
    } catch (e) {
      messages = [
        ...messages,
        { role: "system", content: `\u26a0\ufe0f Error: ${e}`, ts: Date.now() },
      ];
    } finally {
      sending = false;
      await scrollToBottom();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ---- action confirm/dismiss ----------------------------------------------
  async function confirmAction() {
    if (!pendingAction) return;
    confirmingAction = true;
    actionResult = "";
    try {
      await apiService.queueRaces(pendingAction.race_ids ?? [], pendingAction.options ?? {});
      actionResult = "\u2713 Queued";
      messages = [
        ...messages,
        {
          role: "system",
          content: `\u2713 Run queued for: ${(pendingAction.race_ids ?? []).join(", ")}`,
          ts: Date.now(),
        },
      ];
      await scrollToBottom(true);
      setTimeout(() => {
        pendingAction = null;
        actionResult = "";
        pendingRaceRecords = [];
      }, 2000);
    } catch (e) {
      actionResult = `Failed: ${e}`;
    } finally {
      confirmingAction = false;
    }
  }

  function dismissAction() {
    pendingAction = null;
    actionResult = "";
    pendingRaceRecords = [];
  }

  function clearConversation() {
    messages = [{ ...INITIAL_MESSAGE, ts: Date.now() }];
    pendingAction = null;
    actionResult = "";
    pendingRaceRecords = [];
    input = "";
    userScrolledUp = false;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    scrollToBottom(true);
  }

  $: showSuggestions = messages.length <= 1 && !sending;

  // Persist conversation to sessionStorage whenever messages change
  $: try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages)); } catch { /* ignore */ }

  onMount(() => scrollToBottom(true));
</script>

<div class="flex flex-col gap-3" style="height: calc(100vh - 230px); min-height: 400px;">
  <!-- Header bar -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <div class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center" aria-hidden="true">
        <svg class="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
        </svg>
      </div>
      <span class="text-sm font-medium text-content">Admin Agent</span>
      <span class="text-xs text-content-subtle">Powered by AI</span>
    </div>
    {#if messages.length > 1}
      <button
        type="button"
        class="text-xs text-content-subtle hover:text-content transition-colors px-2 py-1 rounded hover:bg-surface-alt"
        on:click={clearConversation}
      >
        Clear chat
      </button>
    {/if}
  </div>

  <!-- Message list -->
  <div
    bind:this={scrollEl}
    on:scroll={onScroll}
    class="flex-1 overflow-y-auto space-y-3 p-4 rounded-xl bg-surface-alt border border-stroke"
  >
    {#each messages as msg (msg.ts)}
      {#if msg.role === "user"}
        <div class="flex justify-end">
          <div
            class="max-w-[78%] bg-blue-600 text-white rounded-2xl rounded-br-none px-4 py-2.5 text-sm shadow-sm leading-relaxed"
            title={formatTs(msg.ts)}
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderContent(msg.content)}
          </div>
        </div>

      {:else if msg.role === "assistant"}
        <div class="flex justify-start items-start gap-2.5 group">
          <div class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm" aria-hidden="true">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3"/>
            </svg>
          </div>
          <div class="max-w-[78%] flex flex-col gap-1">
            <div
              class="bg-surface border border-stroke rounded-2xl rounded-bl-none px-4 py-2.5 text-sm text-content shadow-sm leading-relaxed"
              title={formatTs(msg.ts)}
            >
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderContent(msg.content)}
            </div>
            <button
              type="button"
              class="self-start opacity-0 group-hover:opacity-100 transition-opacity text-xs text-content-subtle hover:text-content flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-alt"
              on:click={() => copyMessage(msg.content, msg.ts)}
              aria-label="Copy message"
            >
              {#if copiedTs === msg.ts}
                <svg class="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
                <span class="text-green-500">Copied</span>
              {:else}
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                Copy
              {/if}
            </button>
          </div>
        </div>

      {:else}
        <!-- System / status pill -->
        <div class="flex justify-center">
          <span class="text-xs text-content-subtle bg-surface border border-stroke rounded-full px-3 py-1 flex items-center gap-1.5">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderContent(msg.content)}
          </span>
        </div>
      {/if}
    {/each}

    <!-- Typing indicator -->
    {#if sending}
      <div class="flex justify-start items-center gap-2.5">
        <div class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm" aria-hidden="true">
          <svg class="w-3.5 h-3.5 text-white animate-pulse" fill="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="4"/>
          </svg>
        </div>
        <div class="bg-surface border border-stroke rounded-2xl rounded-bl-none px-4 py-3">
          <span class="inline-flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-content-subtle animate-bounce" style="animation-delay:0ms"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-content-subtle animate-bounce" style="animation-delay:150ms"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-content-subtle animate-bounce" style="animation-delay:300ms"></span>
          </span>
        </div>
      </div>
    {/if}

    <!-- Suggestion chips (shown only before first user message) -->
    {#if showSuggestions}
      <div class="pt-2 flex flex-wrap gap-2">
        {#each SUGGESTIONS as s}
          <button
            type="button"
            class="text-xs px-3 py-1.5 rounded-full border border-stroke bg-surface hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/20 dark:hover:border-blue-700 text-content-muted hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            on:click={() => sendMessage(s)}
          >
            {s}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Pending action card -->
  {#if pendingAction}
    <div class="rounded-xl border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 p-4 space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-0.5">Suggested run</p>
          <p class="text-sm text-blue-700 dark:text-blue-300">{pendingActionDescription}</p>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          {#if actionResult}
            <span class="text-sm font-medium {actionResult.startsWith('\u2713') ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
              {actionResult}
            </span>
          {:else}
            <button
              type="button"
              class="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
              on:click={confirmAction}
              disabled={confirmingAction}
            >
              {confirmingAction ? "Queuing\u2026" : "Queue run"}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm font-medium rounded-lg border border-stroke hover:bg-surface-alt text-content transition-colors"
              on:click={dismissAction}
              disabled={confirmingAction}
            >
              Dismiss
            </button>
          {/if}
        </div>
      </div>

      <!-- Race metadata cards -->
      {#if pendingRaceRecords.length > 0}
        <div class="flex flex-wrap gap-2">
          {#each pendingRaceRecords as rec}
            <div class="flex-1 min-w-[180px] rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-blue-950/20 p-2.5 text-xs space-y-1.5">
              <div class="font-mono font-semibold text-blue-800 dark:text-blue-200 truncate">{rec.race_id}</div>
              {#if rec.title}
                <div class="text-content-muted truncate">{rec.title}</div>
              {/if}
              <div class="flex flex-wrap gap-1">
                {#if rec.quality_grade}
                  <span class="rounded px-1.5 py-0.5 font-semibold {gradeColor(rec.quality_grade)}">
                    Grade {rec.quality_grade}
                    {#if rec.quality_score != null}&nbsp;({rec.quality_score}){/if}
                  </span>
                {/if}
                {#if rec.freshness}
                  <span class="rounded px-1.5 py-0.5 {freshnessColor(rec.freshness)}">{rec.freshness}</span>
                {/if}
                <span class="rounded px-1.5 py-0.5 {statusColor(rec.status)}">{rec.status}</span>
              </div>
              {#if rec.candidate_count}
                <div class="text-content-subtle">{rec.candidate_count} candidate{rec.candidate_count !== 1 ? 's' : ''}</div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <!-- Fallback: just show race ID chips -->
        <div class="flex flex-wrap gap-1.5">
          {#each (pendingAction.race_ids ?? []) as raceId}
            <span class="text-xs font-mono bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 rounded px-1.5 py-0.5 border border-blue-200 dark:border-blue-800">
              {raceId}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Options summary -->
      {#if pendingAction.options && Object.keys(pendingAction.options).length}
        <p class="text-xs text-blue-600 dark:text-blue-400">
          {formatOptions(pendingAction.options)}
        </p>
      {/if}
    </div>
  {/if}

  <!-- Input area -->
  <div class="flex gap-2 items-end">
    <textarea
      bind:value={input}
      on:keydown={handleKeydown}
      rows="2"
      placeholder={sending ? "Thinking\u2026" : "Ask about races or request a run\u2026 (Enter to send, Shift+Enter for newline)"}
      class="flex-1 resize-none rounded-xl border border-stroke bg-surface px-3.5 py-2.5 text-sm text-content placeholder-content-subtle focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors disabled:opacity-50"
      disabled={sending}
    ></textarea>
    <button
      type="button"
      class="flex-shrink-0 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center gap-1.5 shadow-sm"
      on:click={() => sendMessage()}
      disabled={sending || !input.trim()}
    >
      {#if sending}
        <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      {:else}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
        </svg>
      {/if}
      Send
    </button>
  </div>
</div>
