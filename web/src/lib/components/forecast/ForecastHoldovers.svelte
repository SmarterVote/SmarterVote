<script lang="ts">
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { ForecastTab } from "$lib/utils/forecast";

  export let activeTab: ForecastTab;
  export let holdovers: {
    state: string;
    party: "Democratic" | "Republican" | "Other";
    count: number;
  }[];
  /** Election year these holdovers sit out; null when the races do not say. */
  export let cycleYear: string | null = null;

  $: cycleLabel = cycleYear ?? "this cycle";

  let showHoldovers = false;
</script>

{#if activeTab !== "house"}
  <section class="card overflow-hidden">
    <!-- Toggle header -->
    <button
      type="button"
      on:click={() => (showHoldovers = !showHoldovers)}
      aria-expanded={showHoldovers}
      class="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-surface-alt/40 transition-colors"
      class:border-b={showHoldovers}
      class:border-stroke={showHoldovers}
    >
      <div class="flex items-center gap-3">
        <h2 class="h-card">
          {activeTab === "governors"
            ? `Governor Seats Not Up in ${cycleLabel}`
            : `Senate Seats Not Up in ${cycleLabel}`}
        </h2>
        <span
          class="bg-surface-alt text-content-muted font-bold text-xs px-2.5 py-0.5 rounded-full border border-stroke/60"
        >
          {holdovers.length}
          {activeTab === "governors" ? "states" : "seats"}
        </span>
      </div>
      <span
        class="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary-700 dark:text-primary-300"
      >
        {showHoldovers ? "Hide list" : "Show list"}
        <span
          class="inline-flex transition-transform duration-200"
          class:rotate-180={showHoldovers}
        >
          <UiIcon name="chevron-down" size="sm" />
        </span>
      </span>
    </button>

    {#if showHoldovers}
      <div class="p-5 bg-surface-alt/30">
        <p class="text-xs text-content-subtle mb-4">
          These seats are not up for election in {cycleLabel} and are factored into
          our control calculations based on current incumbent party representation.
        </p>
        <div
          class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        >
          {#each holdovers as h}
            <div
              class="bg-surface border border-stroke rounded-xl px-3 py-2 flex items-center justify-between"
            >
              <span class="text-xs font-bold text-content truncate pr-1"
                >{h.state}</span
              >
              <span
                class={`text-xs font-bold px-1.5 py-0.5 rounded-md border ${
                  h.party === "Democratic"
                    ? "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400"
                    : "bg-red-500/10 text-red-600 border-red-500/20 dark:bg-red-500/20 dark:text-red-400"
                }`}
              >
                {h.party === "Democratic" ? "D" : "R"}{h.count > 1
                  ? ` ×${h.count}`
                  : ""}
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </section>
{/if}
