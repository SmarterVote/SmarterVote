<script lang="ts">
  import type { PublicRaceResult } from "$lib/types";
  import { forecastResultLine } from "$lib/utils/forecastResults";
  import { partyKey } from "$lib/utils/party";
  import UiIcon from "$lib/components/UiIcon.svelte";

  /** The race's live result; nothing renders before votes are reported. */
  export let result: PublicRaceResult | null | undefined = null;
  /** The race page, where the full count lives. */
  export let href: string;
  /** Screen-reader context, e.g. the race name, when the line sits in a list. */
  export let raceLabel = "";

  $: line = forecastResultLine(result);
  $: key = line?.party ? partyKey(line.party) : null;
  $: dotClass =
    key === "dem"
      ? "bg-blue-600 dark:bg-blue-400"
      : key === "rep"
        ? "bg-red-600 dark:bg-red-400"
        : key
          ? "bg-purple-600 dark:bg-purple-400"
          : "bg-amber-500 dark:bg-amber-400";
</script>

{#if line}
  <a
    {href}
    class="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold leading-snug transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 {line.group ===
    'called'
      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100/70 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/50'
      : 'border-amber-200 bg-amber-50/70 text-amber-950 hover:bg-amber-100/70 dark:border-amber-800/50 dark:bg-amber-950/25 dark:text-amber-100 dark:hover:bg-amber-950/40'}"
    data-testid="forecast-result-line"
    data-result-group={line.group}
  >
    <span class="h-2 w-2 shrink-0 rounded-full {dotClass}" aria-hidden="true"
    ></span>
    <span class="min-w-0 flex-1"
      >{#if line.group !== "called"}<span class="sr-only"
          >Live result:
        </span>{/if}{line.text}{#if raceLabel}<span class="sr-only">
          in {raceLabel}</span
        >{/if}</span
    >
    <span
      class="inline-flex shrink-0 items-center gap-1 font-bold text-primary-700 dark:text-primary-300"
      >Results <UiIcon name="arrow-right" size="sm" /></span
    >
  </a>
{/if}
