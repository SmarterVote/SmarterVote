<script lang="ts">
  import USMap from "$lib/components/USMap.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { ForecastTab } from "$lib/utils/forecast";
  import type { StateTooltip } from "$lib/utils/forecastPresentation";

  export let activeTab: ForecastTab;
  export let activeStates: Set<string>;
  export let selectedState: string | null;
  export let stateRaceCounts: Record<string, number>;
  export let stateColors: Record<string, string>;
  export let stateTooltips: Record<string, StateTooltip>;
  export let onStateClick: (state: string) => void;
  export let onClearFilter: () => void;
  /** Scroll to and focus the race list (filtered to the selected state). */
  export let onViewResults: (() => void) | undefined = undefined;

  let mobileMapOpen = true;
  $: mapPanelId = `forecast-map-${activeTab}`;

  // Same CSS variables the map paints with (USMap.svelte), so a swatch can
  // never drift from the fill it explains.
  const ratingRamp = [
    { id: "safe-d", label: "Safe D" },
    { id: "likely-d", label: "Likely D" },
    { id: "lean-d", label: "Lean D" },
    { id: "tilt-d", label: "Tilt D" },
    { id: "tossup", label: "Toss-up" },
    { id: "tilt-r", label: "Tilt R" },
    { id: "lean-r", label: "Lean R" },
    { id: "likely-r", label: "Likely R" },
    { id: "safe-r", label: "Safe R" },
  ];

  $: mapTitle =
    activeTab === "house" ? "House races by state" : "Electoral map";
  $: mapDescription =
    activeTab === "house"
      ? "House control is decided district by district, so this is not a state result map. Each state takes the color of its most competitive House race; select a state to see every district below."
      : activeTab === "senate"
        ? "States are shaded by the projected rating of this cycle's Senate race, or by the party holding seats not up this cycle."
        : "States are shaded by the projected rating of this cycle's governor race, or by the party holding governorships not up this cycle.";

  $: stateOptions = [...activeStates].sort((a, b) => a.localeCompare(b));

  function handleStateClick(event: CustomEvent<string>) {
    onStateClick(event.detail);
  }

  function handleStateSelect(event: Event) {
    const state = (event.currentTarget as HTMLSelectElement).value;
    if (state) {
      onStateClick(state);
    } else {
      onClearFilter();
    }
  }
</script>

<!-- Map Canvas Card -->
<div class="card flex h-full flex-col p-4 sm:p-6">
  <div
    class="mb-4 flex flex-col items-start justify-between gap-3 border-b border-stroke pb-4 sm:flex-row sm:items-start"
  >
    <div>
      <h2 class="h-card">{mapTitle}</h2>
      <p class="mt-1 max-w-prose text-sm leading-6 text-content-subtle">
        {mapDescription}
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if selectedState}
        <button
          on:click={onClearFilter}
          type="button"
          class="btn-secondary min-h-11 px-3 text-xs"
        >
          Clear map filter: {selectedState}
          <UiIcon name="close" size="sm" />
        </button>
      {/if}
      <button
        type="button"
        on:click={() => (mobileMapOpen = !mobileMapOpen)}
        aria-expanded={mobileMapOpen}
        aria-controls={mapPanelId}
        class="btn-secondary px-3 text-xs lg:hidden"
      >
        {mobileMapOpen ? "Hide interactive map" : "Show interactive map"}
      </button>
    </div>
  </div>

  <div
    id={mapPanelId}
    class="{mobileMapOpen ? 'flex' : 'hidden'} flex-col lg:flex"
  >
    {#if stateOptions.length > 0}
      <div class="mb-3 lg:hidden">
        <label
          for="forecast-state-select"
          class="mb-1.5 block text-xs font-semibold text-content-muted"
        >
          Select a state
        </label>
        <select
          id="forecast-state-select"
          value={selectedState ?? ""}
          on:change={handleStateSelect}
          class="w-full rounded-lg border border-stroke bg-surface px-3 py-2 text-sm text-content focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All active states</option>
          {#each stateOptions as state}
            <option value={state}
              >{state} ({stateRaceCounts[state] ?? 0})</option
            >
          {/each}
        </select>
      </div>
    {/if}

    <!-- A tap on the map changes the race list far below it, so say what
         happened right here and offer a jump to the results. -->
    <div aria-live="polite" class="mb-3 empty:hidden">
      {#if selectedState}
        {@const count = stateRaceCounts[selectedState] ?? 0}
        <div
          class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-content dark:border-primary-800 dark:bg-primary-950/40"
          data-testid="map-selection-summary"
        >
          <span
            ><strong>{count} {count === 1 ? "race" : "races"}</strong> in {selectedState}</span
          >
          {#if onViewResults && count > 0}
            <button
              type="button"
              class="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary-700 hover:underline dark:text-primary-300"
              on:click={onViewResults}
            >
              View {count === 1 ? "race" : "races"}
              <UiIcon name="chevron-down" size="sm" />
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="relative w-full">
      <USMap
        {activeStates}
        {selectedState}
        raceCounts={stateRaceCounts}
        {stateColors}
        {stateTooltips}
        on:stateClick={handleStateClick}
      />
    </div>

    <!-- Map Colors Legend -->
    <div class="mt-4 space-y-3 border-t border-stroke pt-4">
      <span class="block text-xs font-semibold text-content-muted"
        >Map legend</span
      >
      <ul class="grid grid-cols-9 gap-0.5" aria-label="Forecast rating colors">
        {#each ratingRamp as step (step.id)}
          {@const anchor =
            step.id === "safe-d" ||
            step.id === "tossup" ||
            step.id === "safe-r"}
          <li
            class="min-w-0 {step.id === 'safe-d'
              ? 'text-left sm:text-center'
              : step.id === 'safe-r'
                ? 'text-right sm:text-center'
                : 'text-center'}"
          >
            <span
              class="block h-3 w-full"
              class:rounded-l={step.id === "safe-d"}
              class:rounded-r={step.id === "safe-r"}
              style="background: var(--color-{step.id});"
              title={step.label}
            ></span>
            <!-- Phones label only the two ends and the middle; every step keeps
                 its label for screen readers and wider screens. -->
            <span
              class="mt-1 block whitespace-nowrap text-xs leading-4 text-content-muted {anchor
                ? ''
                : 'sr-only sm:not-sr-only'}">{step.label}</span
            >
          </li>
        {/each}
      </ul>
      <div class="flex flex-wrap gap-x-4 gap-y-2">
        <div class="flex items-center gap-1.5 text-xs text-content-muted">
          <span
            class="block h-3.5 w-3.5 rounded border border-stroke"
            style="background: repeating-linear-gradient(45deg, var(--color-no-forecast-bg) 0 2px, var(--color-no-forecast-line) 2px 4px);"
          ></span> No forecast yet
        </div>
        {#if activeTab === "senate"}
          <div class="flex items-center gap-1.5 text-xs text-content-muted">
            <span
              class="block h-3.5 w-3.5 rounded border border-stroke"
              style="background: repeating-linear-gradient(45deg, var(--color-holdover-d-solid) 0 3px, var(--color-holdover-r-solid) 3px 6px);"
            ></span> Split holdover
          </div>
        {/if}
        {#if activeTab !== "house"}
          <div class="flex items-center gap-1.5 text-xs text-content-muted">
            <span
              class="block h-3.5 w-3.5 rounded border border-dashed border-stroke"
              style="background-color: var(--color-holdover-d);"
            ></span> Democratic holdover
          </div>
          <div class="flex items-center gap-1.5 text-xs text-content-muted">
            <span
              class="block h-3.5 w-3.5 rounded border border-dashed border-stroke"
              style="background-color: var(--color-holdover-r);"
            ></span> Republican holdover
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
