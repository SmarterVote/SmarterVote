<script lang="ts">
  /**
   * A slim two-way bar: the top two candidates' shares of their combined
   * vote, with a tick at the halfway line. The shares are also written out
   * beneath it, so the bar is never the only way to read the race.
   */
  import { lastName, type ResultContender } from "$lib/utils/results";
  import { partyBarClass } from "$lib/utils/party";

  export let contenders: ResultContender[] = [];

  $: [first, second] = contenders;
  $: total = (first?.pct ?? 0) + (second?.pct ?? 0);
  $: firstShare = total > 0 ? ((first?.pct ?? 0) / total) * 100 : 50;

  const pct = (value: number) => `${value.toFixed(1)}%`;
</script>

{#if first && second}
  <div class="space-y-1">
    <div
      class="relative flex h-1.5 gap-px overflow-hidden rounded-full bg-surface"
      aria-hidden="true"
    >
      <div
        class="h-full transition-[width] duration-500 {partyBarClass(
          first.party,
        )}"
        style="width: {firstShare}%"
      ></div>
      <div class="h-full flex-1 {partyBarClass(second.party)}"></div>
      <div
        class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-surface"
      ></div>
    </div>
    <p
      class="flex justify-between gap-2 text-[11px] font-medium leading-4 tabular-nums text-content-muted"
    >
      <span class="truncate">{lastName(first.name)} {pct(first.pct)}</span>
      <span class="truncate text-right"
        >{lastName(second.name)} {pct(second.pct)}</span
      >
    </p>
  </div>
{/if}
