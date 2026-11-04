<script lang="ts">
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { LiveChamberProjection, LiveForecastFile } from "$lib/types";
  import {
    formatLiveControlProbability,
    liveChamberProjection,
  } from "$lib/utils/liveForecast";

  export let file: LiveForecastFile | null = null;

  const CHAMBERS: { id: "senate" | "house"; label: string }[] = [
    { id: "senate", label: "Senate" },
    { id: "house", label: "House" },
  ];

  $: rows = CHAMBERS.map((chamber) => ({
    ...chamber,
    projection: liveChamberProjection(file, chamber.id, 0),
  })).filter(
    (row): row is typeof row & { projection: LiveChamberProjection } =>
      !!row.projection,
  );

  function partyText(party: string): string {
    if (party === "Democratic") return "text-blue-600 dark:text-blue-400";
    if (party === "Republican") return "text-red-600 dark:text-red-400";
    return "text-content";
  }

  function seats(projection: LiveChamberProjection): string {
    const dem = projection.projected_seats?.Democratic;
    const rep = projection.projected_seats?.Republican;
    if (typeof dem !== "number" || typeof rep !== "number") return "";
    return `${Math.round(dem)} D · ${Math.round(rep)} R`;
  }
</script>

{#if rows.length}
  <section aria-labelledby="balance-heading" data-testid="results-balance">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="balance-heading" class="h-section">Who controls Congress</h2>
      <a
        href="/forecast/"
        class="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"
        >Full projection <UiIcon name="arrow-right" size="sm" /></a
      >
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      {#each rows as row (row.id)}
        {@const p = row.projection}
        <div class="card p-4">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-sm font-bold text-content">{row.label}</h3>
            <span class="text-xs font-semibold text-content-subtle"
              >{p.called_count} of {p.total_count} races called</span
            >
          </div>
          <p
            class="mt-2 text-2xl font-bold tabular-nums {partyText(
              p.control_party,
            )}"
          >
            {p.control_party}
            {formatLiveControlProbability(p.control_probability)}
          </p>
          <p class="mt-0.5 text-xs text-content-muted">
            Chance of control{seats(p) ? ` · projected ${seats(p)}` : ""} ·
            {p.threshold} for a majority
          </p>
        </div>
      {/each}
    </div>
    <p class="mt-2 text-xs text-content-muted">
      A projection, not a result: called races count as decided, and every other
      race uses the pre-election forecast.
    </p>
  </section>
{/if}
