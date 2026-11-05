<script lang="ts">
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { PublicRaceResult } from "$lib/types";
  import {
    compareHref,
    formatPctReporting,
    implausibleCount,
    isRowStale,
    FIRST_POLL_CLOSE,
    namesWinner,
  } from "$lib/utils/results";
  import { formatAgo } from "$lib/utils/resultsPage";
  import ResultBars from "./ResultBars.svelte";
  import ResultStatusPill from "./ResultStatusPill.svelte";

  export let id: string;
  export let title: string;
  export let result: PublicRaceResult | null = null;
  /** The page's clock (ms), so "Updated N min ago" ticks; null hides it. */
  export let now: number | null = null;

  $: hasRows = !!result?.candidates?.length;
  $: winner =
    result && namesWinner(result.status) ? result.winner_name : undefined;
  $: reporting =
    result && result.status !== "not_yet_reported"
      ? formatPctReporting(result.pct_reporting)
      : "";
  $: asOf = result?.as_of
    ? new Date(result.as_of).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  $: ago = result?.as_of && now !== null ? formatAgo(result.as_of, now) : "";
  $: review = implausibleCount(result, id);
  // Only with the page's clock, so a prerendered card never claims it.
  $: stale = now !== null && isRowStale(result, now);
  $: afterPollsClose = now !== null && now >= Date.parse(FIRST_POLL_CLOSE);
</script>

<article
  class="result-card card flex flex-col gap-4 p-5 transition-colors hover:border-primary-400/60 dark:hover:border-primary-500/60"
>
  <div class="flex flex-col gap-2">
    <a
      href={`/races/${id}/`}
      class="text-base font-bold text-content transition-colors hover:text-primary-700 dark:hover:text-primary-300"
    >
      {title}
    </a>
    <ResultStatusPill
      status={result?.status ?? null}
      candidates={review ? null : (result?.candidates ?? null)}
    />
  </div>

  <div class="flex-1">
    {#if hasRows && result}
      <ResultBars
        rows={result.candidates}
        winnerName={winner}
        limit={3}
        compact
        {review}
      />
      {#if stale}
        <p
          class="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-200"
          data-testid="result-row-stale"
        >
          Count last updated {ago} and may be behind.
        </p>
      {/if}
      {#if winner && result.status === "called" && result.called_by}
        <p class="mt-2 text-xs text-content-muted">
          Called by {result.called_by}
        </p>
      {/if}
      {#if reporting}
        <div class="mt-3" data-testid="result-reporting">
          <p class="text-xs font-semibold text-content-subtle">
            Est. {reporting} of votes counted
          </p>
          <div
            class="mt-1 h-1 overflow-hidden rounded-full bg-surface-alt"
            aria-hidden="true"
          >
            <div
              class="h-full rounded-full bg-content-subtle/60"
              style="width: {Math.min(100, result.pct_reporting ?? 0)}%"
            ></div>
          </div>
        </div>
      {/if}
    {:else}
      <p
        class="rounded-xl border border-dashed border-stroke bg-surface-alt/40 px-4 py-5 text-center text-sm text-content-subtle"
      >
        {afterPollsClose
          ? "No results collected yet."
          : "Counts appear here after polls close and votes are reported."}
      </p>
    {/if}
  </div>

  <div
    class="flex items-center justify-between gap-3 border-t border-stroke pt-3"
  >
    <a
      href={compareHref(id)}
      class="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary-700 hover:underline dark:text-primary-300"
    >
      Compare positions <UiIcon name="arrow-right" size="sm" />
    </a>
    {#if asOf}
      <time
        class="text-xs text-content-subtle"
        datetime={result?.as_of ?? undefined}
        title={`As of ${asOf}`}>{ago ? `Updated ${ago}` : `As of ${asOf}`}</time
      >
    {/if}
  </div>
</article>

<style>
  /* Hundreds of cards: let the browser skip layout and paint off-screen. */
  .result-card {
    content-visibility: auto;
    contain-intrinsic-size: auto 240px;
  }
</style>
