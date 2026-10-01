<script lang="ts">
  import type { ForecastRating } from "$lib/types";
  import { formatRating } from "$lib/utils/forecast";
  import { ratingClass } from "$lib/utils/forecastPresentation";

  export let ratingOrder: ForecastRating[];
  export let ratingCounts: Partial<Record<ForecastRating, number>>;
</script>

<!-- Ratings Counts Grid Card -->
<section aria-label="Forecast ratings breakdown" class="card p-4 sm:p-6">
  <p class="eyebrow mb-4 text-content-subtle">Forecast Ratings Breakdown</p>
  <!-- One row from Safe D to Safe R, in order, so the scale always reads left
       to right; it scrolls sideways on phones instead of wrapping into rows
       that mix Democratic, toss-up and Republican tiles. -->
  <div class="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
    <div
      class="grid min-w-[44rem] gap-2 lg:min-w-0"
      style="grid-template-columns: repeat({ratingOrder.length}, minmax(0, 1fr));"
    >
      {#each ratingOrder as rating}
        <div
          class={`border rounded-xl px-2 py-1.5 text-center transition-all ${ratingClass(
            rating,
          )}`}
        >
          <div class="whitespace-nowrap text-xs font-bold leading-tight">
            {formatRating(rating)}
          </div>
          <div class="text-lg font-bold mt-1 tabular-nums">
            {ratingCounts[rating] ?? 0}
          </div>
        </div>
      {/each}
    </div>
  </div>
</section>
