<script lang="ts">
  import { tick } from "svelte";
  import TabButton from "$lib/components/TabButton.svelte";
  import type { ForecastTab } from "$lib/utils/forecast";

  export let tabs: { id: ForecastTab; label: string }[];
  export let activeTab: ForecastTab;
  export let onSelect: (tab: ForecastTab) => void;
  /** Id of the tabpanel the tabs control (rendered by the page). */
  export let panelId = "forecast-tabpanel";

  function tabId(tab: ForecastTab): string {
    return `forecast-tab-${tab}`;
  }

  /** Arrow keys, Home and End move between tabs (automatic activation). */
  async function handleKeydown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next].id;
    onSelect(target);
    await tick();
    document.getElementById(tabId(target))?.focus();
  }
</script>

<div
  class="border-b border-stroke flex gap-1 overflow-x-auto"
  role="tablist"
  aria-label="Forecast chamber"
>
  {#each tabs as tab (tab.id)}
    <TabButton
      tab
      id={tabId(tab.id)}
      controls={panelId}
      active={activeTab === tab.id}
      onClick={() => onSelect(tab.id)}
      onKeydown={handleKeydown}
    >
      {tab.label}
    </TabButton>
  {/each}
</div>
