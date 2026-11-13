<script lang="ts">
  import type { PublicRaceResult } from "$lib/types";
  import { resultGroup, resultStatusClass } from "$lib/utils/results";

  /** The race's live result; nothing renders until it names a winner. */
  export let result: PublicRaceResult | null | undefined = null;

  $: label =
    result && resultGroup(result.status) === "called"
      ? result.status === "certified"
        ? "Certified"
        : "Called"
      : "";
</script>

{#if label && result}
  <span
    class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold leading-none {resultStatusClass(
      result.status,
    )}"
    data-testid="forecast-result-badge"
  >
    <svg
      aria-hidden="true"
      class="h-3 w-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2.25"
      stroke-linecap="round"
      stroke-linejoin="round"><path d="M3 8.5l3.25 3.25L13 5" /></svg
    >
    {label}
  </span>
{/if}
