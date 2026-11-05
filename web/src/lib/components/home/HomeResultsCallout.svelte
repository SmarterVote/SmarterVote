<script lang="ts">
  import { onMount } from "svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { PublicRaceResult } from "$lib/types";
  import {
    calledRaceCount,
    fetchLiveResults,
    isResultsSeason,
  } from "$lib/utils/results";

  /**
   * Live results the page already loaded (the home page shares one fetch with
   * the featured comparison). Left undefined, the callout reads the file itself.
   */
  export let results: Map<string, PublicRaceResult> | null | undefined =
    undefined;

  // Checked at prerender time so the box is in the static HTML on and after
  // Election Day, and checked again in the browser against the reader's clock.
  let visible = isResultsSeason();
  let fetched: Map<string, PublicRaceResult> | null = null;

  $: called = calledRaceCount(results === undefined ? fetched : results);

  onMount(() => {
    visible = isResultsSeason();
    if (!visible || results !== undefined) return;
    // One background read; any failure leaves the count out.
    void fetchLiveResults().then((loaded) => {
      fetched = loaded;
    });
  });
</script>

{#if visible}
  <!-- An aside with a styled label, not an h2: it sits above the page's h1,
       and a heading here would put the outline out of order. -->
  <aside
    class="card mb-8 flex flex-col gap-4 border-primary-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 dark:border-primary-800/60"
    aria-labelledby="home-results-heading"
  >
    <div class="min-w-0">
      <p id="home-results-heading" class="h-card">Election results</p>
      <p class="mt-1 text-sm leading-6 text-content-muted">
        Live results as races are counted and called.
      </p>
      {#if called > 0}
        <p class="mt-1 text-xs font-semibold text-content-subtle">
          {called}
          {called === 1 ? "race" : "races"} called
        </p>
      {/if}
    </div>
    <a href="/results/" class="btn-primary shrink-0 self-start sm:self-center">
      See results <UiIcon name="arrow-right" size="sm" />
    </a>
  </aside>
{/if}
