<script lang="ts">
  import type { ForecastTab } from "$lib/utils/forecast";

  export let activeTab: ForecastTab;
  export let projectedSeats: Record<string, number>;
  export let totalSeats: number;
  export let threshold: number;

  $: seatsLabel = [
    `Projected seats: Democratic ${projectedSeats.Democratic ?? 0}`,
    `Republican ${projectedSeats.Republican ?? 0}`,
    ...(projectedSeats.Other ? [`Other ${projectedSeats.Other}`] : []),
    `of ${totalSeats}`,
    `${threshold} needed for a majority${
      activeTab === "senate" ? "; a 50-50 split is marked" : ""
    }`,
  ].join(", ");
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between">
    <span class="eyebrow text-content-subtle">Projected seats</span>
  </div>

  <div class="space-y-2">
    <!-- One image with every count in its name; the segments and markers
         inside are visual only. -->
    <div class="relative pt-4" role="img" aria-label={seatsLabel}>
      <div
        class="h-8 rounded-xl overflow-hidden bg-surface-alt flex border border-stroke/60 shadow-inner"
      >
        <!-- Dem segment -->
        <div
          class="bg-blue-600 dark:bg-blue-700 transition-all duration-500 flex items-center justify-center text-xs font-black text-white"
          style="width: {((projectedSeats.Democratic ?? 0) / totalSeats) *
            100}%"
          title="Democratic projected seats: {projectedSeats.Democratic ?? 0}"
        >
          {#if (projectedSeats.Democratic ?? 0) > totalSeats * 0.12}
            D {projectedSeats.Democratic}
          {/if}
        </div>
        <!-- Other segment -->
        {#if projectedSeats.Other}
          <div
            class="bg-slate-500 dark:bg-slate-600 transition-all duration-500 flex items-center justify-center text-xs font-black text-white"
            style="width: {((projectedSeats.Other ?? 0) / totalSeats) * 100}%"
            title="Other (independents and third parties) projected seats: {projectedSeats.Other}"
          >
            {#if (projectedSeats.Other ?? 0) > totalSeats * 0.05}
              {projectedSeats.Other}
            {/if}
          </div>
        {/if}
        <!-- Rep segment -->
        <div
          class="bg-red-600 dark:bg-red-700 transition-all duration-500 flex items-center justify-center text-xs font-black text-white ml-auto"
          style="width: {((projectedSeats.Republican ?? 0) / totalSeats) *
            100}%"
          title="Republican projected seats: {projectedSeats.Republican ?? 0}"
        >
          {#if (projectedSeats.Republican ?? 0) > totalSeats * 0.12}
            R {projectedSeats.Republican}
          {/if}
        </div>
      </div>

      <!-- Threshold Marker Line -->
      <div
        class="absolute top-0 bottom-0 w-0.5 bg-yellow-500 dark:bg-yellow-400 z-10"
        style="left: {(threshold / totalSeats) * 100}%"
      >
        <span
          class="absolute bottom-full left-0 ml-0.5 bg-yellow-500 dark:bg-yellow-400 text-xs font-black text-slate-950 dark:text-slate-950 px-1 py-0.5 rounded shadow-sm whitespace-nowrap animate-fade-in"
        >
          Majority ({threshold})
        </span>
      </div>

      <!-- Senate 50-50 Line -->
      {#if activeTab === "senate"}
        <div
          class="absolute top-0 bottom-0 border-l border-dashed border-slate-400/80 dark:border-slate-500/80 z-10"
          style="left: 50%"
        >
          <span
            class="absolute top-full right-0 mr-0.5 bg-slate-500 text-xs font-black text-white px-1 py-0.5 rounded shadow-sm whitespace-nowrap animate-fade-in"
          >
            50-50 Split
          </span>
        </div>
      {/if}
    </div>
  </div>
</div>
