<script lang="ts">
  import { isArchivedElectionYear } from "$lib/utils/archive";

  /**
   * The election year of the page's race or forecast. The notice shows only
   * for the archived cycle, so 2028 pages never carry it.
   */
  export let year: number | string | null | undefined;
  let className = "";
  export { className as class };
</script>

{#if isArchivedElectionYear(year)}
  <!-- A note, not an alert: the archive is context, not news. It labels the
       research and forecast only; live results elsewhere on the page stay live. -->
  <div
    class="alert-info flex items-start gap-2.5 {className}"
    role="note"
    data-testid="archive-notice"
  >
    <svg
      class="mt-0.5 h-4 w-4 shrink-0 text-content-subtle"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      ><path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      /></svg
    >
    <p>
      2026 election archive: final pre-election research and forecasts, no
      longer updated.
    </p>
  </div>
{/if}
