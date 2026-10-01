<script lang="ts">
  import type { ForecastTab } from "$lib/utils/forecast";
  import ForecastSummaryStats from "./ForecastSummaryStats.svelte";
  import ForecastControlBar from "./ForecastControlBar.svelte";
  import ForecastSeatsBar from "./ForecastSeatsBar.svelte";
  import ForecastOverviewFooter from "./ForecastOverviewFooter.svelte";

  export let activeTab: ForecastTab;
  export let controlParty: "Democratic" | "Republican" | "Other";
  export let controlProbability: number | undefined;
  export let vpTiebreakParty: string | undefined;
  export let mostLikelyOutcome: { key: string; probability: number };
  export let tossupCount: number;
  export let competitiveRaceCount: number;
  export let outcomeProbabilities: Record<string, number> | undefined;
  export let projectedSeats: Record<string, number>;
  export let totalSeats: number;
  export let threshold: number;
  export let narrative: string;
  export let updatedAt: string | undefined;
  export let cycleYear: string | null = null;
</script>

<!-- Forecast Above-The-Fold Layout: Election Summary -->
<div class="card p-4 sm:p-6 animate-fade-in">
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
    <!-- Left Column: Summary -->
    <ForecastSummaryStats
      {activeTab}
      {controlParty}
      {controlProbability}
      {vpTiebreakParty}
      {mostLikelyOutcome}
      {tossupCount}
      {competitiveRaceCount}
      {cycleYear}
    />

    <!-- Right Column: Charts / Stats -->
    <div
      class="lg:col-span-6 flex flex-col space-y-6 lg:rounded-xl lg:border lg:border-stroke lg:bg-surface-alt/25 lg:p-6"
    >
      <ForecastControlBar {activeTab} {outcomeProbabilities} {projectedSeats} />
      <ForecastSeatsBar {activeTab} {projectedSeats} {totalSeats} {threshold} />
    </div>

    <!-- Full-Width Bottom Row: Forecast Overview -->
    <ForecastOverviewFooter {narrative} {updatedAt} />
  </div>
</div>
