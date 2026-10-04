<script lang="ts">
  import ConfidenceIndicator from "$lib/components/ConfidenceIndicator.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import MobileCandidateComparison from "$lib/components/compare/MobileCandidateComparison.svelte";
  import ReviewScoreInfo from "$lib/components/compare/ReviewScoreInfo.svelte";
  import SourceLink from "$lib/components/SourceLink.svelte";
  import type { Candidate, CanonicalIssue, Race } from "$lib/types";
  import { CANONICAL_ISSUES, getIssueDisplayName } from "$lib/types";
  import {
    hasPublicPosition,
    hasStance,
    neutralCandidateOrder,
    uniqueCandidatesByName,
  } from "$lib/utils/candidates";
  import { formatRating } from "$lib/utils/forecast";
  import { candidateSlug, careerYears } from "$lib/utils/format";
  import { partyAbbr } from "$lib/utils/party";
  import {
    candidateForecastProbability,
    cleanDisplayText,
    comparePreview,
    formatWinProbability,
    isNoPositionStance,
    isUncontestedRace,
  } from "$lib/utils/racePage";
  import { onMount } from "svelte";
  import { collapsedPreview } from "$lib/utils/stance";
  import { isExternalUrl } from "$lib/utils/url";

  export let race: Race;
  export let candidates: Candidate[];
  export let compact = false;
  export let collapseText = false;
  export let isDraftPreview = false;
  export let showQuality = false;
  /** Fewest candidates the toggles may leave selected; checked boxes lock at this floor. */
  export let minSelected = 1;
  export let onToggle: ((candidateName: string) => void) | undefined =
    undefined;
  /** Issue shown in the phone comparison; bindable so a page can keep it in the URL. */
  export let selectedIssue: CanonicalIssue = "Healthcare";

  let expandedSources: Record<string, boolean> = {};

  /**
   * Which layout to keep in the DOM. Server-rendered HTML carries both (CSS
   * shows the right one, so there is no shift); after mount the hidden one is
   * dropped, halving the nodes, and it comes back if the viewport crosses the
   * `lg` breakpoint.
   */
  let layout: "both" | "mobile" | "desktop" = "both";
  onMount(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => (layout = query.matches ? "desktop" : "mobile");
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  });

  /**
   * Collapsed text for a cell: a hard-capped preview in dense modules (the
   * homepage), whole sentences up to `limit` characters on full pages.
   */
  function textPreview(text: string, limit = 240): string {
    return collapseText ? collapsedPreview(text) : comparePreview(text, limit);
  }

  let expandedTexts: Record<string, boolean> = {};

  function toggleText(key: string) {
    expandedTexts = { ...expandedTexts, [key]: !expandedTexts[key] };
  }

  // The desktop header lives outside the horizontal scroller so it can stick
  // to the viewport; it mirrors the scroller's offset to stay aligned. Its
  // column strip is exactly as wide as the body's candidate columns from the
  // first paint: the body is max(container, minTableWidth) wide, so the strip
  // is max(100%, minTableWidth - label) — pure CSS, nothing to measure, no
  // layout shift.
  let scrollLeft = 0;
  $: labelWidth = compact ? 160 : 180;
  $: columnWidth = compact ? 220 : 240;
  $: minTableWidth = labelWidth + candidates.length * columnWidth;
  $: gridColumns = `${labelWidth}px repeat(${candidates.length}, minmax(0, 1fr))`;

  function sourcesKey(issue: string, candidate: Candidate): string {
    return `${issue}:${candidate.name}`;
  }

  function toggleSources(issue: string, candidate: Candidate) {
    const key = sourcesKey(issue, candidate);
    expandedSources = { ...expandedSources, [key]: !expandedSources[key] };
  }

  const backgroundRows: Array<{
    label: string;
    summary: "donor_summary" | "voting_summary";
    url: "donor_source_url" | "voting_source_url";
    link: string;
  }> = [
    {
      label: "Top Donors",
      summary: "donor_summary",
      url: "donor_source_url",
      link: "Donor details",
    },
    {
      label: "Voting Record",
      summary: "voting_summary",
      url: "voting_source_url",
      link: "Voting record source",
    },
  ];

  $: issueKeys = compact
    ? CANONICAL_ISSUES.filter((key) =>
        candidates.some((candidate) => {
          const stance = candidate.issues?.[key];
          return hasStance(stance) && (stance?.sources?.length ?? 0) > 0;
        }),
      ).slice(0, 1)
    : CANONICAL_ISSUES.filter(
        (key) =>
          // Rows where nobody compared states a position collapse into one line.
          candidates.some((candidate) =>
            hasPublicPosition(candidate.issues?.[key]),
          ) ||
          !candidates.some((candidate) => hasStance(candidate.issues?.[key])),
      );
  $: noPositionIssues = compact
    ? []
    : CANONICAL_ISSUES.filter((key) => !issueKeys.includes(key)).map(
        getIssueDisplayName,
      );
  $: everyIssueEmpty =
    !compact &&
    noPositionIssues.length > 0 &&
    !CANONICAL_ISSUES.some((key) =>
      candidates.some((candidate) =>
        hasPublicPosition(candidate.issues?.[key]),
      ),
    );

  $: activeCandidates = neutralCandidateOrder(
    uniqueCandidatesByName(race.candidates).filter(
      (candidate) => !candidate.withdrawn,
    ),
  );
  // No forecast for an uncontested race (the race page has none to link to).
  $: uncontested = isUncontestedRace(race, activeCandidates.length);

  function forecastProbability(candidate: Candidate): number | undefined {
    return candidateForecastProbability(
      candidate,
      race.forecast,
      activeCandidates,
    );
  }
</script>

{#if onToggle}
  <div class="card mb-5 flex flex-col gap-3 p-4 sm:mb-6 sm:p-5">
    <div>
      <h2 class="text-sm font-semibold text-content">Choose candidates</h2>
      <p class="mt-0.5 text-xs leading-5 text-content-subtle">
        Select who you want to include in the comparison.
      </p>
    </div>
    <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:gap-2.5">
      {#each activeCandidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
        {@const checked = candidates.some(
          (selected) => selected.name === candidate.name,
        )}
        <label
          class="inline-flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-lg border px-3.5 py-2 text-sm font-semibold text-content transition-colors hover:bg-surface-alt {checked
            ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-950/40'
            : 'border-stroke bg-surface'}"
        >
          <input
            type="checkbox"
            {checked}
            disabled={checked && candidates.length <= minSelected}
            title={checked && candidates.length <= minSelected
              ? `At least ${minSelected} candidate${minSelected === 1 ? "" : "s"} must stay in the comparison`
              : undefined}
            on:change={() => onToggle?.(candidate.name)}
            class="h-5 w-5 cursor-pointer rounded-sm border-stroke bg-surface text-primary-600 focus:ring-primary-500"
          />
          {candidate.name}
          {#if candidate.party}<span
              class="ml-auto rounded-md bg-surface-alt px-1.5 py-0.5 text-xs font-bold text-content-subtle sm:ml-0"
              >{partyAbbr(candidate.party)}</span
            >{/if}
        </label>
      {/each}
    </div>
  </div>
{/if}

{#if layout !== "desktop"}
  <MobileCandidateComparison
    {race}
    {candidates}
    {compact}
    {collapseText}
    {isDraftPreview}
    {showQuality}
    bind:selectedIssue
  />
{/if}

{#if layout !== "mobile"}
  <!-- overflow-clip (not hidden) keeps the rounded corners without turning this
     box into a scroll container, so the header can stick to the viewport. -->
  <div
    data-desktop-candidate-comparison
    class="relative isolate hidden overflow-clip rounded-xl border border-stroke bg-surface shadow-xs lg:block"
  >
    {#if showQuality && race.validation_grade}
      <div
        class="flex items-start gap-3 border-b border-stroke bg-emerald-50 px-5 py-3.5 dark:bg-emerald-950/30"
      >
        <span
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-lg font-extrabold text-emerald-800 shadow-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >{race.validation_grade.grade}</span
        >
        <div class="min-w-0 text-sm leading-6 text-content-muted">
          <span
            class="mr-1.5 text-xs font-bold uppercase tracking-wider text-content-subtle"
            >Automated research score</span
          >
          <strong class="text-content">{race.validation_grade.score}/100</strong
          ><ReviewScoreInfo panelId={`desktop-review-score-info-${race.id}`} />
        </div>
      </div>
    {/if}

    <div
      role="table"
      aria-label="Candidate comparison"
      aria-colcount={candidates.length + 1}
    >
      <!-- Sticky candidate header: stays under the site header while the long
         comparison scrolls, so every column stays identifiable. -->
      <div
        role="rowgroup"
        class:sticky={!compact}
        class:compare-sticky-header={!compact}
        class="z-30 border-b border-stroke bg-surface shadow-xs"
      >
        <div role="row" class="flex">
          <div
            role="columnheader"
            class="z-10 flex shrink-0 items-center self-stretch border-r border-stroke bg-surface px-5 text-xs font-bold uppercase tracking-wider text-content-subtle"
            style="width: {labelWidth}px"
          >
            {compact ? "Compare" : "Candidates"}
          </div>
          <div class="relative min-w-0 flex-1 overflow-hidden">
            <div
              class="grid"
              style="width: max(100%, {minTableWidth -
                labelWidth}px); grid-template-columns: repeat({candidates.length}, minmax(0, 1fr)); transform: translateX(-{scrollLeft}px)"
            >
              {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
                <div
                  role="columnheader"
                  class="flex min-w-0 items-center gap-3 border-r border-stroke px-4 py-3 last:border-none"
                >
                  <CandidateAvatar
                    name={candidate.name}
                    imageUrl={candidate.image_url}
                    size={40}
                    loading="eager"
                  />
                  <div class="min-w-0">
                    <a
                      href="/races/{race.id}/{candidateSlug(
                        candidate.name,
                      )}/{isDraftPreview ? '?draft=true' : ''}"
                      class="line-clamp-2 text-sm font-bold leading-snug text-content hover:text-primary hover:underline"
                      title={candidate.name}>{candidate.name}</a
                    >
                    <div class="mt-1 flex items-center gap-1.5">
                      {#if candidate.party}<span
                          class="rounded-sm border border-stroke bg-surface-alt px-1.5 py-0.5 text-xs font-bold leading-none text-content-muted"
                          title={candidate.party}
                          >{partyAbbr(candidate.party)}</span
                        >{/if}
                      {#if candidate.incumbent}<span
                          class="rounded-sm border border-green-200 bg-green-50 px-1.5 py-0.5 text-xs font-bold leading-none text-green-700 dark:border-green-800 dark:bg-green-950/20 dark:text-green-300"
                          >Incumbent</span
                        >{/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- `relative` makes this scroller the containing block of the sr-only
         (position:absolute) labels inside it; otherwise they resolve against
         the page, escape the clip, and widen the whole document. -->
      <div
        class="custom-scrollbar relative overflow-x-auto"
        on:scroll={(event) => (scrollLeft = event.currentTarget.scrollLeft)}
      >
        <div
          role="rowgroup"
          class="divide-y divide-stroke"
          style="min-width: {minTableWidth}px"
        >
          <div
            class="grid"
            role="row"
            style="grid-template-columns: {gridColumns}"
          >
            <div role="rowheader" class="row-label">Biography</div>
            {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
              {@const summaryText = cleanDisplayText(candidate.summary)}
              {@const summaryKey = `summary:${candidate.name}`}
              {@const isSummaryExpanded = expandedTexts[summaryKey] ?? false}
              {@const collapsedSummary = textPreview(summaryText, 280)}
              <div
                role="cell"
                class="border-r border-stroke {compact
                  ? 'p-4'
                  : 'p-5'} text-sm leading-relaxed text-content-muted last:border-none"
              >
                {isSummaryExpanded ? summaryText : collapsedSummary}
                {#if collapsedSummary !== summaryText.trim()}
                  <button
                    type="button"
                    aria-expanded={isSummaryExpanded}
                    on:click={() => toggleText(summaryKey)}
                    class="toggle-link ml-1"
                  >
                    {isSummaryExpanded ? "Show less" : "Show more"}
                    <span class="sr-only">
                      of {candidate.name}'s biography</span
                    >
                  </button>
                {/if}
                {#if !compact && isExternalUrl(candidate.website)}<div
                    class="mt-3"
                  >
                    <a
                      href={candidate.website.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex min-h-6 items-center gap-1.5 py-1 text-xs font-semibold text-primary hover:underline"
                      >Campaign website
                      <UiIcon name="external" size="sm" /></a
                    >
                  </div>{/if}
              </div>
            {/each}
          </div>

          <div
            class="grid"
            role="row"
            style="grid-template-columns: {gridColumns}"
          >
            <div
              role="columnheader"
              class="section-label"
              style="grid-column: 1 / -1"
            >
              Positions on Key Issues
            </div>
          </div>
          {#if noPositionIssues.length > 0}
            <div
              class="grid"
              role="row"
              style="grid-template-columns: {gridColumns}"
            >
              <div
                role="cell"
                class="no-position-row"
                style="grid-column: 1 / -1"
              >
                {#if everyIssueEmpty}
                  <span class="font-semibold text-content-muted"
                    >No public positions found yet on these issues:</span
                  >
                {:else}
                  <span class="font-semibold text-content-muted"
                    >No public position found from anyone compared:</span
                  >
                {/if}
                {noPositionIssues.join(", ")}
              </div>
            </div>
          {/if}
          {#each issueKeys as issueKey}
            <div
              class="grid issue-row"
              role="row"
              id="compare-issue-{candidateSlug(issueKey)}"
              style="grid-template-columns: {gridColumns}"
            >
              <div role="rowheader" class="row-label">
                {getIssueDisplayName(issueKey)}
              </div>
              {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
                {@const rawStance = candidate.issues?.[issueKey]}
                {@const stance = hasStance(rawStance) ? rawStance : undefined}
                {@const stanceText = stance
                  ? cleanDisplayText(stance.stance)
                  : ""}
                {@const noPosition = !!stance && isNoPositionStance(stanceText)}
                {@const preview = stance ? textPreview(stanceText) : ""}
                {@const stanceKey = `stance:${issueKey}:${candidate.name}`}
                {@const isStanceExpanded = expandedTexts[stanceKey] ?? false}
                <div
                  role="cell"
                  class="flex flex-col gap-3 border-r border-stroke {compact
                    ? 'p-4'
                    : 'p-5'} last:border-none"
                >
                  {#if stance && noPosition}
                    <span class="text-sm italic text-content-subtle"
                      >No public position found</span
                    >
                  {:else if stance}
                    <div>
                      <p
                        class="whitespace-normal text-sm leading-relaxed text-content-muted"
                      >
                        {isStanceExpanded ? stanceText : preview}
                      </p>
                      {#if preview !== stanceText.trim()}
                        <button
                          type="button"
                          aria-expanded={isStanceExpanded}
                          on:click={() => toggleText(stanceKey)}
                          class="toggle-link min-h-8 pt-1"
                        >
                          {isStanceExpanded ? "Show less" : "Show more"}
                          <span class="sr-only">
                            of {candidate.name} on {getIssueDisplayName(
                              issueKey,
                            )}</span
                          >
                        </button>
                      {/if}
                    </div>
                    <div class="flex items-center gap-2">
                      <span
                        class="text-xs font-medium uppercase tracking-wide text-content-subtle"
                        >Confidence</span
                      ><ConfidenceIndicator confidence={stance.confidence} />
                    </div>
                    {#if stance.sources?.length}
                      {@const areSourcesExpanded =
                        expandedSources[sourcesKey(issueKey, candidate)] ??
                        false}
                      <div class="border-t border-stroke/60 pt-2">
                        <div class="flex flex-col items-start gap-1">
                          {#each areSourcesExpanded ? stance.sources : stance.sources.slice(0, 1) as source}
                            <SourceLink {source} />
                          {/each}
                        </div>
                        {#if stance.sources.length > 1}
                          <button
                            type="button"
                            aria-expanded={areSourcesExpanded}
                            on:click={() => toggleSources(issueKey, candidate)}
                            class="toggle-link min-h-10 text-xs"
                          >
                            {areSourcesExpanded
                              ? "Show fewer sources"
                              : `Show ${stance.sources.length - 1} more ${stance.sources.length === 2 ? "source" : "sources"}`}
                            <span class="sr-only">
                              for {candidate.name} on {getIssueDisplayName(
                                issueKey,
                              )}</span
                            >
                          </button>
                        {/if}
                      </div>
                    {/if}
                  {:else}<span
                      class="select-none text-xs italic text-content-faint"
                      >No stance researched yet.</span
                    >{/if}
                </div>
              {/each}
            </div>
          {/each}

          {#if !compact}
            <div
              class="grid"
              role="row"
              style="grid-template-columns: {gridColumns}"
            >
              <div
                role="columnheader"
                class="section-label"
                style="grid-column: 1 / -1"
              >
                Background & Credentials
              </div>
            </div>
            <div
              class="grid"
              role="row"
              style="grid-template-columns: {gridColumns}"
            >
              <div role="rowheader" class="row-label">Career</div>
              {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}<div
                  role="cell"
                  class="border-r border-stroke p-5 text-sm text-content-muted last:border-none"
                >
                  {#if candidate.career_history?.length}<div class="space-y-3">
                      {#each candidate.career_history as entry}<div
                          class="border-l-2 border-stroke py-0.5 pl-3"
                        >
                          <div
                            class="flex flex-wrap items-baseline justify-between gap-x-2"
                          >
                            <span class="text-xs font-semibold text-content"
                              >{entry.title}</span
                            >{#if careerYears(entry)}<span
                                class="text-xs text-content-subtle"
                                >{careerYears(entry)}</span
                              >{/if}
                          </div>
                          {#if entry.organization}<span
                              class="block text-xs text-content-subtle"
                              >{entry.organization}</span
                            >{/if}
                        </div>{/each}
                    </div>{:else}<span class="text-xs italic text-content-faint"
                      >No career records.</span
                    >{/if}
                </div>{/each}
            </div>
            <div
              class="grid"
              role="row"
              style="grid-template-columns: {gridColumns}"
            >
              <div role="rowheader" class="row-label">Education</div>
              {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}<div
                  role="cell"
                  class="border-r border-stroke p-5 text-sm text-content-muted last:border-none"
                >
                  {#if candidate.education?.length}<div class="space-y-3">
                      {#each candidate.education as edu}<div>
                          <span class="block text-xs font-semibold text-content"
                            >{edu.institution}</span
                          >{#if edu.degree || edu.field}<span
                              class="text-xs text-content-subtle"
                              >{[edu.degree, edu.field]
                                .filter(Boolean)
                                .join(" in ")}{#if edu.year}
                                ({edu.year}){/if}</span
                            >{/if}
                        </div>{/each}
                    </div>{:else}<span class="text-xs italic text-content-faint"
                      >No education records.</span
                    >{/if}
                </div>{/each}
            </div>
            {#each backgroundRows as row}
              <div
                class="grid"
                role="row"
                style="grid-template-columns: {gridColumns}"
              >
                <div role="rowheader" class="row-label">{row.label}</div>
                {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
                  {@const summary = cleanDisplayText(candidate[row.summary])}
                  {@const sourceUrl = candidate[row.url]}
                  {@const rowKey = `${row.summary}:${candidate.name}`}
                  {@const rowExpanded = expandedTexts[rowKey] ?? false}
                  {@const rowPreview = textPreview(summary, 220)}
                  <div
                    role="cell"
                    class="border-r border-stroke p-5 text-sm text-content-muted last:border-none"
                  >
                    {#if summary}<p class="text-xs leading-relaxed">
                        {rowExpanded ? summary : rowPreview}
                        {#if rowPreview !== summary.trim()}
                          <button
                            type="button"
                            aria-expanded={rowExpanded}
                            on:click={() => toggleText(rowKey)}
                            class="toggle-link ml-1 text-xs"
                          >
                            {rowExpanded ? "Show less" : "Show more"}
                            <span class="sr-only">
                              of {candidate.name}'s {row.label.toLowerCase()}</span
                            >
                          </button>
                        {/if}
                      </p>
                      {#if sourceUrl && isExternalUrl(sourceUrl)}<a
                          href={sourceUrl.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="mt-2 inline-flex min-h-6 items-center gap-1.5 py-1 text-xs font-semibold text-primary hover:underline"
                          >{row.link} <UiIcon name="external" size="sm" /></a
                        >{/if}{:else}<span
                        class="text-xs italic text-content-faint"
                        >No records available.</span
                      >{/if}
                  </div>{/each}
              </div>
            {/each}
          {/if}

          {#if race.forecast && !uncontested}
            <div
              class="grid"
              role="row"
              style="grid-template-columns: {gridColumns}"
            >
              <div role="rowheader" class="row-label">
                Forecast
                <span
                  class="mt-1 block text-xs font-medium uppercase tracking-wider text-content-subtle"
                  >Model estimate</span
                >
              </div>
              {#each candidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
                {@const probability = forecastProbability(candidate)}
                <div
                  role="cell"
                  class="border-r border-stroke p-5 last:border-none"
                >
                  {#if probability != null}
                    <div class="text-2xl font-extrabold text-content">
                      {formatWinProbability(probability)}
                    </div>
                    <p class="mt-1 text-xs text-content-muted">
                      estimated win probability
                    </p>
                  {:else}
                    <p class="text-sm font-semibold text-content">
                      {formatRating(race.forecast.rating) ??
                        race.forecast.rating.replaceAll("_", " ")}
                    </p>
                    <p class="mt-1 text-xs text-content-muted">
                      race-level rating
                    </p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style lang="postcss">
  @reference "../../../app.css";

  .compare-sticky-header {
    top: var(--site-header-height, 0px);
  }

  .row-label {
    @apply sticky left-0 z-10 border-r border-stroke bg-surface-alt px-5 py-5 text-sm font-semibold text-content;
  }

  .section-label {
    @apply sticky left-0 z-10 w-full bg-surface-alt/40 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-content-subtle;
  }

  .issue-row {
    scroll-margin-top: calc(var(--site-header-height, 0px) + 6rem);
  }

  .no-position-row {
    @apply px-5 py-3 text-sm leading-6 text-content-subtle;
  }

  /* On short (zoomed or landscape) viewports the pinned header would cover
     most of the screen. */
  @media (max-height: 500px) {
    .compare-sticky-header {
      position: static;
    }
  }

  .toggle-link {
    @apply inline-flex items-start text-sm font-semibold leading-5 text-primary hover:underline;
  }
</style>
