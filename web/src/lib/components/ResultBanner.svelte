<script lang="ts">
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import ResultStatusPill from "$lib/components/results/ResultStatusPill.svelte";
  import ResultBars from "$lib/components/results/ResultBars.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { Candidate, PublicRaceResult, RaceResult } from "$lib/types";
  import { formatElectionDate } from "$lib/utils/electionDate";
  import { getHostname } from "$lib/utils/forecastPresentation";
  import { partyBadgeClass } from "$lib/utils/party";
  import {
    compareHref,
    formatPctReporting,
    namesWinner,
  } from "$lib/utils/results";
  import { isExternalUrl } from "$lib/utils/url";

  export let raceId: string;
  export let result: RaceResult | PublicRaceResult;
  export let candidates: Pick<Candidate, "name" | "image_url">[] = [];
  /** Hide the link on the compare page itself. */
  export let showCompareLink = true;

  function formatTime(value: string | null | undefined): string {
    if (!value) return "";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ""
      : parsed.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });
  }

  $: asOf = formatTime(result.as_of);
  $: calledAt = formatTime(result.called_at);
  $: hasWinner = namesWinner(result.status) && !!result.winner_name;
  $: winnerRow = result.candidates?.find(
    (row) => row.name === result.winner_name,
  );
  $: winnerImage =
    (winnerRow as { image_url?: string | null } | undefined)?.image_url ??
    candidates.find((candidate) => candidate.name === result.winner_name)
      ?.image_url;
  $: reporting = formatPctReporting(result.pct_reporting);
  $: sourceLinks = (result.sources ?? []).filter((source) =>
    isExternalUrl(String(source.url)),
  );
</script>

{#if result.status !== "not_yet_reported"}
  <section class="card overflow-hidden" aria-labelledby="result-heading">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-stroke bg-surface-alt/50 px-5 py-3 sm:px-6"
    >
      <h2 id="result-heading" class="eyebrow">2026 general election results</h2>
      <ResultStatusPill status={result.status} candidates={result.candidates} />
    </div>

    <div class="p-5 sm:p-6">
      {#if hasWinner}
        <div class="mb-6 flex items-center gap-4">
          <CandidateAvatar
            name={result.winner_name ?? ""}
            imageUrl={winnerImage}
            size={72}
          />
          <div class="min-w-0">
            <p
              class="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-content"
            >
              {result.winner_name}
              {#if result.winner_party}
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-normal {partyBadgeClass(
                    result.winner_party,
                  )}">{result.winner_party}</span
                >
              {/if}
            </p>
            {#if result.status === "called" && result.called_by}
              <p class="mt-1 text-sm text-content-muted">
                Called by {result.called_by}{calledAt ? ` · ${calledAt}` : ""}
              </p>
            {/if}
          </div>
        </div>
      {:else if result.status === "runoff_required"}
        <div class="alert-info mb-6">
          <p class="font-semibold text-content">No candidate won outright.</p>
          {#if result.runoff_date}
            <p class="mt-0.5">
              Runoff on {formatElectionDate(result.runoff_date)}
            </p>
          {/if}
        </div>
      {:else if result.status === "rcv_pending"}
        <div class="alert-info mb-6">
          <p class="font-semibold text-content">
            Ranked-choice tabulation is still to come.
          </p>
          <p class="mt-0.5">These are first-choice votes, not a final count.</p>
        </div>
      {:else if result.status === "too_close"}
        <div class="alert-info mb-6">
          <p class="font-semibold text-content">No winner has been called.</p>
          <p class="mt-0.5">
            The margin is too narrow for a call, and it may go to a recount.
          </p>
        </div>
      {:else}
        <p class="mb-5 text-sm text-content-muted">
          Votes are still being counted, and no winner has been projected yet.
        </p>
      {/if}

      {#if result.candidates?.length}
        <ResultBars
          rows={result.candidates}
          roster={candidates}
          winnerName={hasWinner ? result.winner_name : null}
        />
      {/if}

      {#if reporting}
        <div class="mt-5">
          <p class="text-xs font-semibold text-content-subtle">
            About {reporting} of votes counted
          </p>
          <div
            class="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-alt"
            aria-hidden="true"
          >
            <div
              class="h-full rounded-full bg-content-subtle/60"
              style="width: {Math.min(100, result.pct_reporting ?? 0)}%"
            ></div>
          </div>
        </div>
      {/if}

      <div
        class="mt-5 flex flex-col gap-4 border-t border-stroke pt-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div
          class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-content-subtle"
        >
          {#if asOf}<span>As of {asOf}</span>{/if}
          {#each sourceLinks as source (source.url)}
            <a
              href={String(source.url)}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex max-w-[180px] items-center gap-1 truncate rounded-md border border-stroke bg-surface px-2 py-0.5 text-primary-700 hover:underline dark:text-primary-300"
            >
              {getHostname(String(source.url))}
              <UiIcon name="external" size="sm" />
            </a>
          {/each}
        </div>
        {#if showCompareLink}
          <a href={compareHref(raceId)} class="btn-primary shrink-0">
            Compare the candidates' positions
            <UiIcon name="arrow-right" size="sm" />
          </a>
        {/if}
      </div>
    </div>
  </section>
{/if}
