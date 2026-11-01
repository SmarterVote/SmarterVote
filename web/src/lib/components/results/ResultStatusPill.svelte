<script lang="ts">
  import type { RaceResultStatus } from "$lib/types";
  import {
    isStillCounting,
    isUnofficial,
    resultStatusClass,
    resultStatusLabel,
  } from "$lib/utils/results";

  export let status: RaceResultStatus | null = null;
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
    {status ? resultStatusLabel(status) : "Awaiting results"}
  </span>
  {#if status && isUnofficial(status)}
    <span
      class="rounded-full border border-stroke bg-surface px-2.5 py-1 text-xs font-semibold leading-none text-content-subtle"
      >Unofficial</span
    >
  {/if}
</span>
