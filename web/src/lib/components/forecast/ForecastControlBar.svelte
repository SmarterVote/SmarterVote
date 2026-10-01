<script lang="ts">
  import type { ForecastTab } from "$lib/utils/forecast";
  import { controlProbability } from "$lib/utils/forecastPresentation";

  export let activeTab: ForecastTab;
  export let outcomeProbabilities: Record<string, number> | undefined;
  export let projectedSeats: Record<string, number>;
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between">
    <span class="eyebrow text-content-subtle"
      >{activeTab === "governors"
        ? "Control Probabilities"
        : "Chamber Control Probabilities"}</span
    >
    {#if activeTab === "senate" && outcomeProbabilities?.tie_50_50}
      <span
        class="text-xs font-semibold text-content-subtle bg-surface-alt px-2 py-0.5 rounded-md border border-stroke/60"
      >
        50-50 tie: {controlProbability(outcomeProbabilities.tie_50_50)}
      </span>
    {/if}
  </div>

  {#if outcomeProbabilities}
    {@const demProb = outcomeProbabilities.Democratic ?? 0}
    {@const gopProb = outcomeProbabilities.Republican ?? 0}
    {@const tieProb = outcomeProbabilities.tie_50_50 ?? 0}
    {@const otherProb = outcomeProbabilities.Other ?? 0}
    {@const segments = [
      {
        key: "dem",
        label: "Democratic",
        value: demProb,
        bar: "bg-blue-600 dark:bg-blue-500",
        text: "text-blue-700 dark:text-blue-300",
      },
      ...(activeTab === "governors" && tieProb > 0
        ? [
            {
              key: "tie",
              label: "Split",
              value: tieProb,
              bar: "bg-slate-400 dark:bg-slate-500",
              text: "text-content-muted",
            },
          ]
        : []),
      ...(otherProb > 0
        ? [
            {
              key: "other",
              label: "Other",
              value: otherProb,
              bar: "bg-slate-400 dark:bg-slate-500",
              text: "text-content-muted",
            },
          ]
        : []),
      {
        key: "gop",
        label: "Republican",
        value: gopProb,
        bar: "bg-red-600 dark:bg-red-500",
        text: "text-red-700 dark:text-red-300",
      },
    ]}
    <div class="space-y-3">
      <!-- Values sit above the bar rather than inside it, so a small segment
           never has to fit a label it cannot hold on a phone. -->
      <div
        class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm font-bold tabular-nums"
      >
        {#each segments as segment (segment.key)}
          <span class={segment.text}>
            {segment.label}
            {controlProbability(segment.value)}
          </span>
        {/each}
      </div>
      <div
        class="h-3 rounded-full overflow-hidden bg-surface-alt flex"
        role="img"
        aria-label={segments
          .map(
            (segment) =>
              `${segment.label} ${controlProbability(segment.value)}`,
          )
          .join(", ")}
      >
        {#each segments as segment (segment.key)}
          {#if segment.value > 0}
            <div
              class="{segment.bar} transition-all duration-500"
              style="width: {segment.value * 100}%"
              title="{segment.label} control probability: {controlProbability(
                segment.value,
              )}"
            ></div>
          {/if}
        {/each}
      </div>

      <!-- Callout Note -->
      {#if activeTab === "senate" && outcomeProbabilities.tie_50_50 && !(projectedSeats.Democratic === 50 && projectedSeats.Republican === 50)}
        <div
          class="bg-surface-alt/40 border border-stroke/60 rounded-xl p-3 flex items-start gap-2.5"
        >
          <svg
            class="w-5 h-5 text-content-subtle shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p class="text-xs text-content-muted leading-relaxed font-medium">
            A {controlProbability(outcomeProbabilities.tie_50_50)} 50-50 tie probability
            is counted as Republican control via VP tie-break, contributing to the
            Republican control advantage shown above.
          </p>
        </div>
      {/if}
    </div>
  {/if}
</div>
