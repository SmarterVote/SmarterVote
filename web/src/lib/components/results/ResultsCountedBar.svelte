<script lang="ts">
  /** A thin "share of the vote counted" meter with its figure beside it. */
  import { formatPctReporting } from "$lib/utils/results";

  export let pct: number | null | undefined = null;

  $: label = formatPctReporting(pct);
  $: width = Math.min(100, Math.max(0, pct ?? 0));
</script>

<div class="flex items-center gap-2">
  <div
    class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-alt"
    aria-hidden="true"
  >
    {#if label}
      <div
        class="h-full rounded-full bg-emerald-600 transition-[width] duration-500 dark:bg-emerald-500"
        style="width: {width}%"
      ></div>
    {/if}
  </div>
  <span
    class="shrink-0 text-[11px] font-semibold leading-4 tabular-nums text-content-subtle"
    >{label ? `${label} counted` : "Share counted unknown"}</span
  >
</div>
