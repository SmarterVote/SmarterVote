<script lang="ts">
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import type { Candidate, PublicResultCandidate } from "$lib/types";
  import { partyAbbr, partyBadgeClass, partyBarClass } from "$lib/utils/party";
  import { sortResultRows } from "$lib/utils/results";

  export let rows: PublicResultCandidate[] = [];
  /** Roster fallback for headshots; the public results file carries its own. */
  export let roster: Pick<Candidate, "name" | "image_url">[] = [];
  /** Only a called race has one. A vote lead never gets this emphasis. */
  export let winnerName: string | null | undefined = undefined;
  export let limit: number | undefined = undefined;
  export let compact = false;

  $: sorted = sortResultRows(rows);
  $: shown = limit ? sorted.slice(0, limit) : sorted;
  $: hiddenCount = sorted.length - shown.length;
  $: avatarSize = compact ? 28 : 40;

  function imageFor(row: PublicResultCandidate) {
    return (
      row.image_url ??
      roster.find((candidate) => candidate.name === row.name)?.image_url
    );
  }

  /** Bars scale to the full vote, so a 49-48 race looks as close as it is. */
  function barWidth(pct: number | null | undefined): string {
    return `${Math.min(100, Math.max(0, pct ?? 0))}%`;
  }
</script>

<ul class="result-bars" class:compact>
  {#each shown as row (row.name)}
    {@const isWinner = !!winnerName && row.name === winnerName}
    <li class="result-row">
      <CandidateAvatar
        name={row.name}
        imageUrl={imageFor(row)}
        size={avatarSize}
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-3">
          <p class="flex min-w-0 items-center gap-1.5">
            <span
              class="truncate text-sm text-content"
              class:font-bold={isWinner}
              class:font-medium={!isWinner}
              title={row.name}>{row.name}</span
            >
            {#if row.party}
              <span
                class="shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-bold leading-none {partyBadgeClass(
                  row.party,
                )}"
                title={row.party}>{partyAbbr(row.party)}</span
              >
            {/if}
            {#if isWinner}
              <svg
                class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                viewBox="0 0 20 20"
                fill="currentColor"
                role="img"
                aria-label="Winner"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
                  clip-rule="evenodd"
                />
              </svg>
            {/if}
          </p>
          <p class="shrink-0 tabular-nums">
            {#if !compact && row.votes != null}
              <span class="mr-2 text-xs text-content-subtle"
                >{row.votes.toLocaleString("en-US")}</span
              >
            {/if}
            <span class="text-sm font-bold text-content"
              >{row.pct != null ? `${row.pct.toFixed(1)}%` : "n/a"}</span
            >
          </p>
        </div>
        <div class="result-track" aria-hidden="true">
          <div
            class="result-fill {partyBarClass(row.party)}"
            style="width: {barWidth(row.pct)}"
          ></div>
        </div>
      </div>
    </li>
  {/each}
</ul>
{#if hiddenCount > 0}
  <p class="mt-2 text-xs text-content-subtle">
    +{hiddenCount} more candidate{hiddenCount === 1 ? "" : "s"}
  </p>
{/if}

<style lang="postcss">
  @reference "../../../app.css";

  .result-bars {
    @apply space-y-3.5;
  }
  .result-bars.compact {
    @apply space-y-2.5;
  }
  .result-row {
    @apply flex items-center gap-3;
  }
  .result-track {
    @apply mt-1.5 h-2 overflow-hidden rounded-full bg-surface-alt;
  }
  .result-fill {
    @apply h-full rounded-full transition-all duration-500;
  }
</style>
