<script lang="ts">
  import type { LiveChamberProjection } from "$lib/types";
  import {
    getMostLikelySeatOutcome,
    type ForecastTab,
  } from "$lib/utils/forecast";
  import { controlProbability as formatPreElectionProbability } from "$lib/utils/forecastPresentation";
  import ForecastSeatsBar from "./ForecastSeatsBar.svelte";
  import { formatLiveControlProbability } from "$lib/utils/liveForecast";

  export let projection: LiveChamberProjection;
  /** Fallback when no called race carries its own as-of time. */
  export let resultsUpdatedAt: string | null = null;
  export let activeTab: ForecastTab = "senate";
  /** The pre-election control chance, shown beside the live one for comparison. */
  export let preElectionProbability: number | undefined = undefined;
  export let preElectionParty: "Democratic" | "Republican" | "Other" | null =
    null;

  function formatTime(value: string | null | undefined): string {
    if (!value) return "";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ""
      : parsed.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });
  }

  $: party = projection.control_party;
  $: outcome = getMostLikelySeatOutcome(projection.seat_distribution);
  $: asOf = formatTime(projection.as_of ?? resultsUpdatedAt);
</script>

<section
  class="card p-4 sm:p-6 border-primary-500/30"
  aria-labelledby="forecast-live-heading"
  data-testid="forecast-live-projection"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 id="forecast-live-heading" class="h-section">Live projection</h2>
    <span class="text-xs font-semibold text-content-subtle">
      {projection.called_count} of {projection.total_count} races called
    </span>
  </div>

  <div class="mt-4 grid grid-cols-2 gap-3">
    <div
      class="rounded-xl border border-stroke bg-surface-alt/40 p-3 text-center"
    >
      <div class="mb-1 text-xs font-semibold text-content-subtle">
        Control chance
      </div>
      <div
        class={`text-xl font-bold tabular-nums ${
          party === "Democratic"
            ? "text-blue-600 dark:text-blue-400"
            : party === "Republican"
              ? "text-red-600 dark:text-red-400"
              : "text-content"
        }`}
      >
        {formatLiveControlProbability(projection.control_probability)}
      </div>
      <div class="mt-0.5 text-xs text-content-muted">{party}</div>
      {#if preElectionParty && typeof preElectionProbability === "number"}
        <div
          class="mt-1 text-xs text-content-subtle"
          data-testid="forecast-live-pre-election"
        >
          Pre-election: {formatPreElectionProbability(preElectionProbability)}
          {preElectionParty}
        </div>
      {/if}
    </div>

    <div
      class="rounded-xl border border-stroke bg-surface-alt/40 p-3 text-center"
    >
      <div class="mb-1 text-xs font-semibold text-content-subtle">
        Most likely exact split
      </div>
      <div class="text-xl font-bold text-content tabular-nums">
        {outcome.key || "—"}
      </div>
    </div>
  </div>

  {#if projection.projected_seats && projection.total_seats > 0}
    <div class="mt-5 pb-5">
      <ForecastSeatsBar
        {activeTab}
        projectedSeats={projection.projected_seats}
        totalSeats={projection.total_seats}
        threshold={projection.threshold}
        label="Live projected seats"
      />
    </div>
  {/if}

  <p class="mt-3 text-xs text-content-muted">
    Called races count as decided; all other races use the pre-election
    forecast.{asOf ? ` As of ${asOf}.` : ""}
  </p>
</section>
