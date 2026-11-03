<script lang="ts">
  import { onMount } from "svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import {
    calledRaceCount,
    fetchLiveResults,
    isResultsSeason,
  } from "$lib/utils/results";

  // Checked at prerender time so the box is in the static HTML on and after
  // Election Day, and checked again in the browser against the reader's clock.
  let visible = isResultsSeason();
  let called = 0;

  onMount(() => {
    visible = isResultsSeason();
    if (!visible) return;
    // One background read; any failure leaves the count out.
    void fetchLiveResults().then((results) => {
      called = calledRaceCount(results);
    });
  });
</script>

{#if visible}
  <section
    class="card mb-8 flex flex-col gap-4 border-primary-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 dark:border-primary-800/60"
    aria-labelledby="home-results-heading"
  >
    <div class="min-w-0">
      <h2 id="home-results-heading" class="h-card">Election results</h2>
      <p class="mt-1 text-sm leading-6 text-content-muted">
        Live results for tonight's races as they're counted and called.
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
  </section>
{/if}
