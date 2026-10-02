<script lang="ts">
  import type { ForecastRating } from "$lib/types";
  import { formatRating } from "$lib/utils/forecast";
  import { ratingClass } from "$lib/utils/forecastPresentation";

  export let ratingOrder: ForecastRating[];
  export let ratingCounts: Partial<Record<ForecastRating, number>>;

  /** Phone labels, so all nine tiles fit one row without scrolling. */
  const SHORT_LABELS: Record<ForecastRating, string> = {
    safe_d: "SD",
    likely_d: "LD",
    lean_d: "LnD",
    tilt_d: "TD",
    tossup: "TU",
    tilt_r: "TR",
    lean_r: "LnR",
    likely_r: "LR",
    safe_r: "SR",
    other: "Oth",
  };
</script>

<!-- Ratings Counts Grid Card -->
<section aria-label="Forecast ratings breakdown" class="card p-4 sm:p-6">
  <p class="eyebrow mb-4 text-content-subtle">Forecast Ratings Breakdown</p>
  <!-- One row from Safe D to Safe R, in order, so the scale always reads left
       to right and both parties are always on screen. Phones get compact
       tiles with abbreviated labels (full names stay in the accessible text
       and in the key below); wider screens show the full labels. -->
  <ul
    class="grid gap-1 sm:gap-2"
    style="grid-template-columns: repeat({ratingOrder.length}, minmax(0, 1fr));"
    aria-label="Forecast ratings, Safe D to Safe R"
  >
    {#each ratingOrder as rating}
      <li
        class={`min-w-0 border rounded-lg sm:rounded-xl px-0.5 py-1.5 sm:px-2 text-center transition-all ${ratingClass(
          rating,
        )}`}
      >
        <span
          class="block text-xs font-bold leading-tight sm:hidden"
          aria-hidden="true">{SHORT_LABELS[rating]}</span
        >
        <span
          class="sr-only sm:not-sr-only sm:block sm:whitespace-nowrap sm:text-xs sm:font-bold sm:leading-tight"
          >{formatRating(rating)}</span
        >
        <span class="mt-1 block text-base font-bold tabular-nums sm:text-lg"
          ><span class="sr-only">: </span>{ratingCounts[rating] ?? 0}</span
        >
      </li>
    {/each}
  </ul>
  <p class="mt-3 text-xs leading-5 text-content-subtle sm:hidden">
    S = Safe, L = Likely, Ln = Lean, T = Tilt, TU = Toss-up{ratingOrder.includes(
      "other",
    )
      ? ", Oth = Other"
      : ""}; D = Democratic, R = Republican.
  </p>
</section>
