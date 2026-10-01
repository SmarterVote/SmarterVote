<script lang="ts" context="module">
  /** id of the single tabpanel the admin page renders the active tab into. */
  export const ADMIN_TABPANEL_ID = "admin-tabpanel";

  export function tabId(id: string): string {
    return `admin-tab-${id}`;
  }
</script>

<script lang="ts">
  import { browser } from "$app/environment";

  export let activeTab:
    | "dashboard"
    | "research"
    | "races"
    | "runs"
    | "forecasts"
    | "costs" = "dashboard";

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "research", label: "2026 Research" },
    { id: "races", label: "Races" },
    { id: "runs", label: "Runs" },
    { id: "forecasts", label: "Forecasts" },
    { id: "costs", label: "Costs" },
  ] as const;

  type TabId = (typeof tabs)[number]["id"];

  let tabButtons: HTMLButtonElement[] = [];

  function handleKeydown(event: KeyboardEvent, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(tabs[next].id);
    tabButtons[next]?.focus();
  }
  const VALID_TABS = new Set<string>(tabs.map((t) => t.id));

  function selectTab(id: TabId) {
    activeTab = id;
    if (browser) {
      const url = new URL(window.location.href);
      if (id === "dashboard") {
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("tab", id);
      }
      history.replaceState(history.state, "", url);
    }
  }

  // Read tab from URL on init
  if (browser) {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param && VALID_TABS.has(param)) {
      activeTab = param as TabId;
    }
  }
</script>

<div class="border-b border-stroke mb-6">
  <div
    class="-mb-px flex space-x-1 overflow-x-auto"
    role="tablist"
    aria-label="Admin sections"
  >
    {#each tabs as tab, index}
      <button
        type="button"
        id={tabId(tab.id)}
        bind:this={tabButtons[index]}
        class="relative px-5 py-3 text-sm font-medium transition-colors rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-400
          {activeTab === tab.id
          ? 'border-b-2 border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20'
          : 'text-content-subtle hover:text-content-muted hover:bg-surface-alt'}"
        on:click={() => selectTab(tab.id)}
        on:keydown={(event) => handleKeydown(event, index)}
        role="tab"
        aria-selected={activeTab === tab.id}
        aria-controls={ADMIN_TABPANEL_ID}
        tabindex={activeTab === tab.id ? 0 : -1}
      >
        {tab.label}
      </button>
    {/each}
  </div>
</div>
