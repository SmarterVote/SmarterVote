<script lang="ts">
  import type { ForecastTab } from "$lib/utils/forecast";
  import { controlProbability as formatControlProbability } from "$lib/utils/forecastPresentation";

  export let activeTab: ForecastTab;
  export let controlParty: "Democratic" | "Republican" | "Other";
  export let controlProbability: number | undefined;
  export let vpTiebreakParty: string | undefined;
  export let mostLikelyOutcome: { key: string; probability: number };
  export let tossupCount: number;
  export let competitiveRaceCount: number;
  /** Election year this summary describes; null when the races do not say. */
  export let cycleYear: string | null = null;
</script>

<div class="lg:col-span-6 flex flex-col space-y-6">
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h2 class="h-section">
        {[
          cycleYear,
          activeTab === "house"
            ? "House"
            : activeTab === "senate"
              ? "Senate"
              : "Governor",
          "Election Summary",
        ]
          .filter(Boolean)
          .join(" ")}
      </h2>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <!-- Control Status Badge -->
      <span
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-extrabold shadow-xs border
      {controlParty === 'Democratic'
          ? 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/40'
          : controlParty === 'Republican'
            ? 'bg-red-500/10 text-red-700 border-red-500/20 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/40'
            : 'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700/40'}"
      >
        <span
          class="w-2 h-2 rounded-full
        {controlParty === 'Democratic'
            ? 'bg-blue-600 dark:bg-blue-500 animate-pulse'
            : controlParty === 'Republican'
              ? 'bg-red-600 dark:bg-red-500 animate-pulse'
              : 'bg-slate-500 dark:bg-slate-400'}"
        ></span>
        {#if controlParty === "Other"}
          No clear control projected
        {:else}
          {controlParty} control projected
        {/if}
      </span>

      <!-- VP Tie-break Note -->
      {#if activeTab === "senate" && vpTiebreakParty}
        <span
          class="text-xs text-content-subtle font-semibold bg-surface-alt px-2.5 py-0.5 rounded-full border border-stroke/60 italic"
        >
          Includes 50-50 tie-break via VP
        </span>
      {/if}
    </div>
  </div>

  <!-- Probability Stat Cards -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <!-- Control Probability -->
    <div
      class="rounded-xl border border-stroke bg-surface-alt/40 p-3 text-center"
    >
      <div class="mb-1 text-xs font-semibold text-content-subtle">
        Control chance
      </div>
      <div
        class={`text-xl font-bold tabular-nums ${
          controlParty === "Democratic"
            ? "text-blue-600 dark:text-blue-400"
            : controlParty === "Republican"
              ? "text-red-600 dark:text-red-400"
              : "text-content"
        }`}
      >
        {formatControlProbability(controlProbability)}
      </div>
      <div class="mt-0.5 text-xs text-content-muted">
        {controlParty}
      </div>
    </div>

    <!-- Most Likely Outcome -->
    <div
      class="order-last col-span-2 rounded-xl border border-stroke bg-surface-alt/40 p-3 text-center sm:order-0 sm:col-span-1"
    >
      <div class="mb-1 text-xs font-semibold text-content-subtle">
        Most likely exact split
      </div>
      <div class="text-xl font-bold text-content tabular-nums">
        {mostLikelyOutcome.key || "—"}
      </div>
      <div class="mt-0.5 text-xs text-content-muted">
        {mostLikelyOutcome.probability
          ? `${(mostLikelyOutcome.probability * 100).toFixed(1)}% chance of this split`
          : ""}
      </div>
    </div>

    <!-- Competitive Races -->
    <div
      class="rounded-xl border border-stroke bg-surface-alt/40 p-3 text-center"
    >
      <div class="mb-1 text-xs font-semibold text-content-subtle">
        Battlegrounds
      </div>
      <div
        class="text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums"
      >
        {tossupCount}
      </div>
      <div class="mt-0.5 text-xs text-content-muted">
        toss-ups / {competitiveRaceCount} competitive
      </div>
    </div>
  </div>
  <p class="text-xs leading-5 text-content-subtle">
    The exact split is the single most likely outcome in the model's
    distribution. Projected seats summarize each party's model-wide seat
    estimate, so the two figures can differ.
  </p>
</div>
