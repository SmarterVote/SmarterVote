<script lang="ts">
  import ConfidenceIndicator from "$lib/components/ConfidenceIndicator.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import ReviewScoreInfo from "$lib/components/compare/ReviewScoreInfo.svelte";
  import SourceLink from "$lib/components/SourceLink.svelte";
  import type { Candidate, CanonicalIssue, Race } from "$lib/types";
  import { CANONICAL_ISSUES, getIssueDisplayName } from "$lib/types";
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import {
    hasPublicPosition,
    hasStance,
    neutralCandidateOrder,
    uniqueCandidatesByName,
  } from "$lib/utils/candidates";
  import { formatRating } from "$lib/utils/forecast";
  import { candidateSlug } from "$lib/utils/format";
  import { partyAbbr } from "$lib/utils/party";
  import { collapsedPreview } from "$lib/utils/stance";
  import {
    candidateForecastProbability,
    cleanDisplayText,
    comparePreview,
    formatWinProbability,
    isNoPositionStance,
    isUncontestedRace,
  } from "$lib/utils/racePage";

  export let race: Race;
  export let candidates: Candidate[];
  export let compact = false;
  export let collapseText = false;
  export let isDraftPreview = false;
  export let showQuality = false;

  /** The issue being compared; bindable so a page can keep it in the URL. */
  export let selectedIssue: CanonicalIssue = "Healthcare";
  let expandedStances: Record<string, boolean> = {};
  let expandedSources: Record<string, boolean> = {};

  // Issues where at least one compared candidate states a position; issues
  // where everyone only has a "no public position found" marker are listed
  // once below the picker instead of being choosable.
  $: issueKeys = CANONICAL_ISSUES.filter((key) =>
    candidates.some((candidate) => hasPublicPosition(candidate.issues?.[key])),
  );
  $: noPositionIssues = CANONICAL_ISSUES.filter(
    (key) =>
      !issueKeys.includes(key) &&
      candidates.some((candidate) => hasStance(candidate.issues?.[key])),
  ).map(getIssueDisplayName);
  $: if (!issueKeys.includes(selectedIssue))
    selectedIssue = issueKeys[0] ?? "Healthcare";
  $: activeCandidates = neutralCandidateOrder(
    uniqueCandidatesByName(race.candidates).filter(
      (candidate) => !candidate.withdrawn,
    ),
  );
  // No forecast for an uncontested race (the race page has none to link to).
  $: uncontested = isUncontestedRace(race, activeCandidates.length);
  // Same per-candidate probabilities as the desktop forecast row.
  $: forecastRows = race.forecast
    ? candidates
        .map((candidate) => ({
          name: candidate.name,
          probability: candidateForecastProbability(
            candidate,
            race.forecast,
            activeCandidates,
          ),
        }))
        .filter(
          (row): row is { name: string; probability: number } =>
            row.probability != null,
        )
    : [];
  $: issueSelectId = `mobile-compare-issue-${race.id}`;

  function stanceKey(candidate: Candidate): string {
    return `${selectedIssue}:${candidate.name}`;
  }

  function toggleStance(candidate: Candidate) {
    const key = stanceKey(candidate);
    expandedStances = { ...expandedStances, [key]: !expandedStances[key] };
  }

  function sourcesKey(candidate: Candidate): string {
    return `${selectedIssue}:${candidate.name}:sources`;
  }

  function toggleSources(candidate: Candidate) {
    const key = sourcesKey(candidate);
    expandedSources = { ...expandedSources, [key]: !expandedSources[key] };
  }

  /** Same collapsed text as the desktop comparison cells. */
  function positionPreview(stance: string): string {
    return collapseText ? collapsedPreview(stance) : comparePreview(stance);
  }
</script>

<div
  class="relative overflow-hidden rounded-xl border border-stroke bg-surface shadow-sm lg:hidden"
>
  {#if showQuality && race.validation_grade}
    <div
      class="flex items-start gap-3 border-b border-stroke bg-emerald-50/40 px-5 py-3 dark:bg-emerald-950/10"
    >
      <span
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white font-extrabold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >{race.validation_grade.grade}</span
      >
      <div class="text-xs leading-5 text-content-muted">
        <strong class="text-content">Automated research score:</strong>
        {race.validation_grade.score}/100<ReviewScoreInfo
          panelId={`mobile-review-score-info-${race.id}`}
        />
      </div>
    </div>
  {/if}

  <div
    class="hide-scrollbar relative flex snap-x snap-mandatory overflow-x-auto border-b border-stroke bg-surface-alt/30"
    aria-label="Candidates in this comparison"
  >
    {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
      <a
        href="/races/{race.id}/{candidateSlug(candidate.name)}/{isDraftPreview
          ? '?draft=true'
          : ''}"
        aria-label={candidate.name}
        class="flex w-1/2 min-w-[9.5rem] max-w-[13rem] shrink-0 snap-start flex-col items-center border-r border-stroke px-3 py-4 text-center last:border-0"
      >
        <CandidateAvatar
          name={candidate.name}
          imageUrl={candidate.image_url}
          size={56}
          loading="eager"
        />
        <span class="mt-2 text-sm font-extrabold text-content"
          >{candidate.name}</span
        >
        {#if candidate.party}
          <span class="mt-1 text-xs font-semibold text-content-muted"
            >{partyAbbr(candidate.party)}</span
          >
        {/if}
      </a>
    {/each}
  </div>
  {#if candidates.length > 2}
    <p
      class="border-b border-stroke bg-surface-alt/30 px-4 py-2 text-center text-xs font-semibold text-content-subtle"
    >
      Swipe to see all {candidates.length} candidates
    </p>
  {/if}

  <div class="p-4">
    {#if issueKeys.length === 0 && noPositionIssues.length > 0}
      <div
        class="rounded-lg border border-dashed border-stroke bg-surface-alt/40 p-4 text-sm"
      >
        <p class="font-semibold text-content-muted">
          No public positions found yet on these issues
        </p>
        <details class="mt-1 text-content-subtle">
          <summary
            class="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary hover:underline"
            >Show the {noPositionIssues.length} issues we checked</summary
          >
          <p class="leading-6">{noPositionIssues.join(", ")}</p>
        </details>
      </div>
    {:else}
      <label
        for={issueSelectId}
        class="text-xs font-extrabold uppercase tracking-wider text-content-subtle"
        >Compare an issue</label
      >
      <select
        id={issueSelectId}
        bind:value={selectedIssue}
        disabled={issueKeys.length === 0}
        class="mt-2 min-h-12 w-full rounded-lg border border-stroke bg-surface px-4 font-bold text-content focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if issueKeys.length === 0}
          <option>No researched issues available</option>
        {:else}
          {#each issueKeys as issue}
            <option value={issue}>{getIssueDisplayName(issue)}</option>
          {/each}
        {/if}
      </select>

      <div class="mt-4 space-y-3">
        {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
          {@const rawStance = candidate.issues?.[selectedIssue]}
          {@const stance = hasStance(rawStance) ? rawStance : undefined}
          {@const stanceText = stance ? cleanDisplayText(stance.stance) : ""}
          {@const noPosition = !!stance && isNoPositionStance(stanceText)}
          {@const preview = stance ? positionPreview(stanceText) : ""}
          {@const isExpanded = expandedStances[stanceKey(candidate)] ?? false}
          {@const isTruncated = stance ? preview !== stanceText.trim() : false}
          <article
            aria-label="{candidate.name} position on {getIssueDisplayName(
              selectedIssue,
            )}"
            class="rounded-lg border border-stroke bg-surface-alt/35 p-4"
          >
            <div class="flex items-center justify-between gap-3">
              <h3 class="font-extrabold text-content">{candidate.name}</h3>
              {#if stance && !noPosition}
                <ConfidenceIndicator confidence={stance.confidence} />
              {/if}
            </div>
            <p
              class="mt-3 text-sm leading-6 {stance && !noPosition
                ? 'text-content-muted'
                : 'italic text-content-subtle'}"
            >
              {noPosition
                ? "No public position found"
                : stance
                  ? isExpanded
                    ? stanceText
                    : preview
                  : "No sourced position available yet."}
            </p>
            {#if stance && isTruncated}
              <button
                type="button"
                aria-expanded={isExpanded}
                on:click={() => toggleStance(candidate)}
                class="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
              >
                {isExpanded ? "Show less" : "Show more"}
                <span class="sr-only">
                  of {candidate.name} on {getIssueDisplayName(
                    selectedIssue,
                  )}</span
                >
              </button>
            {/if}
            {#if !noPosition && stance?.sources?.length && (!collapseText || isExpanded || !isTruncated)}
              {@const areSourcesExpanded =
                expandedSources[sourcesKey(candidate)] ?? false}
              <div class="mt-3 border-t border-stroke pt-3">
                <div class="flex flex-col items-start gap-2">
                  {#each areSourcesExpanded ? stance.sources : stance.sources.slice(0, 1) as source}
                    <SourceLink {source} />
                  {/each}
                </div>
                {#if stance.sources.length > 1}
                  <button
                    type="button"
                    aria-expanded={areSourcesExpanded}
                    on:click={() => toggleSources(candidate)}
                    class="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
                  >
                    {areSourcesExpanded
                      ? "Show fewer sources"
                      : `Show ${stance.sources.length - 1} more ${stance.sources.length === 2 ? "source" : "sources"}`}
                    <span class="sr-only">
                      for {candidate.name} on {getIssueDisplayName(
                        selectedIssue,
                      )}</span
                    >
                  </button>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>
      {#if noPositionIssues.length > 0}
        <p class="mt-4 text-sm leading-6 text-content-subtle">
          <span class="font-semibold text-content-muted"
            >No public position found from anyone compared:</span
          >
          {noPositionIssues.join(", ")}
        </p>
      {/if}
      {#if compact}
        <p class="mt-4 text-center text-xs text-content-subtle">
          Choose another issue above to review more research fields.
        </p>
      {/if}
    {/if}
  </div>

  {#if race.forecast && !uncontested}
    <div class="border-t border-stroke bg-surface-alt/50 px-5 py-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="eyebrow">Forecast</p>
          <p class="mt-1 text-sm text-content">
            {formatRating(race.forecast.rating) ??
              race.forecast.rating.replaceAll("_", " ")}
          </p>
        </div>
        <a
          href="/races/{race.id}/{isDraftPreview ? '?draft=true' : ''}#forecast"
          class="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >View forecast <UiIcon name="arrow-right" size="sm" /></a
        >
      </div>
      {#if forecastRows.length > 0}
        <dl class="mt-3 grid grid-cols-2 gap-2">
          {#each forecastRows as row, index (`${index}-${row.name}`)}
            <div class="rounded-lg border border-stroke bg-surface px-3 py-2">
              <dt class="truncate text-xs text-content-muted" title={row.name}>
                {row.name}
              </dt>
              <dd class="text-lg font-extrabold text-content">
                {formatWinProbability(row.probability)}
              </dd>
            </div>
          {/each}
        </dl>
        <p class="mt-2 text-xs text-content-subtle">
          Estimated win probability (model)
        </p>
      {/if}
    </div>
  {/if}
</div>
