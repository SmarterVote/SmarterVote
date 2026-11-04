<script lang="ts">
  import type { RaceResultStatus } from "$lib/types";
  import {
    isStillCounting,
    isUnofficial,
    resultLeadLabel,
    resultStatusClass,
    resultStatusLabel,
  } from "$lib/utils/results";

  export let status: RaceResultStatus | null = null;
  /** The race's candidates, so a count in progress names who leads. */
  export let candidates:
    { name: string; pct?: number | null; votes?: number | null }[] | null =
    null;

  $: lead = status ? resultLeadLabel({ status, candidates }) : null;
</script>

<span class="inline-flex flex-wrap items-center gap-1.5">
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none {resultStatusClass(
      status,
    )}"
  >
    {#if status && isStillCounting(status)}
      <span
        class="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
        aria-hidden="true"
      ></span>
    {/if}
    {lead ?? (status ? resultStatusLabel(status) : "Awaiting results")}
  </span>
  {#if status && isUnofficial(status)}
    <span
      class="rounded-full border border-stroke bg-surface px-2.5 py-1 text-xs font-semibold leading-none text-content-subtle"
      >Unofficial</span
    >
  {/if}
</span>
