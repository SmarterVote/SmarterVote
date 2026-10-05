<script lang="ts">
  import ConfidenceIndicator from "./ConfidenceIndicator.svelte";
  import SourceLink from "./SourceLink.svelte";
  import NoDataFallback from "./NoDataFallback.svelte";
  import type { IssueKey, IssueStance } from "$lib/types";
  import { RENAMED_ISSUE_NOTES, getIssueDisplayName } from "$lib/types";
  import { hasPublicPosition, hasStance } from "$lib/utils/candidates";
  import { candidateSlug } from "$lib/utils/format";
  import { cleanDisplayText } from "$lib/utils/racePage";

  export let issues: Partial<Record<IssueKey, IssueStance>>;
  export let raceId: string = "";
  export let candidateName: string = "";
  /**
   * Pin the phone issue picker under the site header. A page that already
   * pins its own section strip turns this off so only one secondary bar sticks.
   */
  export let stickyPicker = true;

  const INITIAL_SOURCE_LIMIT = 3;

  $: allEntries = (
    Object.entries(issues ?? {}) as [IssueKey, IssueStance][]
  ).filter(([, stance]) => hasStance(stance));
  // "No public position found" markers are listed once, by issue name, rather
  // than as a row each; a candidate with nothing but markers gets one line.
  $: issueEntries = allEntries.filter(([, stance]) =>
    hasPublicPosition(stance),
  );
  $: noPositionIssues = allEntries
    .filter(([, stance]) => !hasPublicPosition(stance))
    .map(([issue]) => getIssueDisplayName(issue));
  $: subject = candidateName || "this candidate";

  function moreSourcesLabel(issue: string, hidden: number): string {
    return `Show ${hidden} more source${hidden === 1 ? "" : "s"} for ${subject} on ${getIssueDisplayName(issue)}`;
  }

  function moreSourcesText(hidden: number): string {
    return `Show ${hidden} more source${hidden === 1 ? "" : "s"}`;
  }
  // Several IssueTables can share a page (one per candidate card), so every id
  // is namespaced by race and candidate.
  $: idBase = `issues-${candidateSlug(raceId || "race")}-${candidateSlug(
    candidateName || "candidate",
  )}`;
  $: issueSelectId = `${idBase}-select`;

  function noteId(key: string): string {
    return `${idBase}-${candidateSlug(key)}-note`;
  }
  $: hasIssues = issueEntries.length > 0;
  let selectedIssue: IssueKey | "" = "";
  $: if (
    issueEntries.length > 0 &&
    !issueEntries.some(([issue]) => issue === selectedIssue)
  ) {
    selectedIssue = issueEntries[0][0];
  }

  let expandedSources: Set<string> = new Set();
  let visibleTooltip: string | null = null;

  function toggleSources(issue: string) {
    const next = new Set(expandedSources);
    if (next.has(issue)) {
      next.delete(issue);
    } else {
      next.add(issue);
    }
    expandedSources = next;
  }

  function toggleTooltip(issue: string) {
    visibleTooltip = visibleTooltip === issue ? null : issue;
  }

  function visibleSources(stance: IssueStance, expanded: boolean) {
    const sources = stance.sources ?? [];
    return expanded ? sources : sources.slice(0, INITIAL_SOURCE_LIMIT);
  }
</script>

{#if !hasIssues && noPositionIssues.length > 0}
  <div class="no-positions">
    <p class="no-positions-title">
      No public positions found yet on these issues
    </p>
    <details class="no-positions-details">
      <summary
        >Show the {noPositionIssues.length} issue{noPositionIssues.length === 1
          ? ""
          : "s"} we checked</summary
      >
      <p class="no-positions-list">{noPositionIssues.join(", ")}</p>
    </details>
  </div>
{:else if !hasIssues}
  <NoDataFallback dataType="issues" {raceId} {candidateName} />
{:else}
  <div class="relative hidden lg:block overflow-x-auto">
    <table class="w-full table-fixed border-collapse">
      <caption class="sr-only">Positions of {subject} on key issues</caption>
      <thead>
        <tr class="border-b border-stroke">
          <th
            scope="col"
            class="w-[18%] py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-content-subtle"
            >Issue</th
          >
          <th
            scope="col"
            class="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-content-subtle"
          >
            Stance
          </th>
          <th
            scope="col"
            class="w-28 py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-content-subtle"
            >Confidence</th
          >
          <th
            scope="col"
            class="w-[24%] py-3 pl-4 text-left text-xs font-semibold uppercase tracking-wider text-content-subtle"
            >Sources</th
          >
        </tr>
      </thead>
      <tbody>
        {#each issueEntries as [issue, stance]}
          <tr class="border-b border-stroke align-top last:border-b-0">
            <th
              scope="row"
              class="py-4 pr-4 text-left font-semibold text-content"
            >
              <span class="inline-flex items-center gap-1">
                {getIssueDisplayName(issue)}
                {#if RENAMED_ISSUE_NOTES[issue]}
                  <span class="relative inline-block">
                    <button
                      type="button"
                      class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-primary hover:text-primary-700 dark:hover:text-primary-300 leading-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      aria-label="About this issue name"
                      title="About this issue name"
                      aria-expanded={visibleTooltip === issue}
                      aria-controls={visibleTooltip === issue
                        ? noteId(issue)
                        : undefined}
                      aria-describedby={visibleTooltip === issue
                        ? noteId(issue)
                        : undefined}
                      on:click|stopPropagation={() => toggleTooltip(issue)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="w-4 h-4"
                        aria-hidden="true"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </button>
                    {#if visibleTooltip === issue}
                      <div
                        id={noteId(issue)}
                        class="absolute z-10 left-0 top-11 w-72 rounded-lg border border-stroke bg-surface p-3 shadow-lg text-sm text-content-muted"
                        role="tooltip"
                      >
                        <p>{RENAMED_ISSUE_NOTES[issue]}</p>
                        <button
                          type="button"
                          class="mt-2 inline-flex min-h-11 items-center text-xs text-content-subtle hover:text-content underline"
                          on:click|stopPropagation={() => {
                            visibleTooltip = null;
                          }}>Dismiss</button
                        >
                      </div>
                    {/if}
                  </span>
                {/if}
              </span>
            </th>
            <td
              class="whitespace-normal py-4 px-4 text-sm leading-relaxed text-content-muted"
            >
              {cleanDisplayText(stance.stance)}
            </td>
            <td class="py-4 px-4">
              <ConfidenceIndicator confidence={stance.confidence} />
            </td>
            <td class="py-4 pl-4">
              {#if stance.sources?.length > 0}
                <div class="space-y-0.5 wrap-break-word">
                  {#each visibleSources(stance, expandedSources.has(issue)) as source}
                    <div>
                      <SourceLink {source} />
                    </div>
                  {/each}
                </div>
                {#if stance.sources.length > INITIAL_SOURCE_LIMIT}
                  <button
                    type="button"
                    aria-expanded={expandedSources.has(issue)}
                    class="mt-2 inline-flex min-h-11 items-center text-primary hover:text-primary-700 dark:hover:text-primary-300 text-sm underline"
                    aria-label={expandedSources.has(issue)
                      ? `Show fewer sources for ${subject} on ${getIssueDisplayName(issue)}`
                      : moreSourcesLabel(
                          issue,
                          stance.sources.length - INITIAL_SOURCE_LIMIT,
                        )}
                    on:click={() => toggleSources(issue)}
                  >
                    {expandedSources.has(issue)
                      ? "Show fewer sources"
                      : moreSourcesText(
                          stance.sources.length - INITIAL_SOURCE_LIMIT,
                        )}
                  </button>
                {/if}
              {:else}
                <span class="text-content-faint text-sm"
                  >No supporting sources</span
                >
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Mobile-friendly view for smaller screens -->
  <div class="lg:hidden space-y-4">
    <!-- Sticks directly under the site header unless the page already pins
         its own section strip (stickyPicker=false): only one secondary bar
         may stick, and none on short (zoomed or landscape) viewports. -->
    <div
      class="issue-picker rounded-lg border border-stroke bg-surface p-3 shadow-xs"
      class:issue-picker--sticky={stickyPicker}
    >
      <label
        for={issueSelectId}
        class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-content-subtle"
      >
        Review an issue
      </label>
      <select
        id={issueSelectId}
        bind:value={selectedIssue}
        class="min-h-11 w-full rounded-lg border border-stroke bg-surface px-3 py-2 text-base font-semibold text-content focus:border-primary-500 focus:outline-hidden focus:ring-2 focus:ring-primary-500"
      >
        {#each issueEntries as [issue]}
          <option value={issue}>{getIssueDisplayName(issue)}</option>
        {/each}
      </select>
    </div>
    {#each issueEntries.filter(([issue]) => issue === selectedIssue) as [issue, stance]}
      <div class="bg-surface border border-stroke rounded-lg p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-content inline-flex items-center gap-1">
            {getIssueDisplayName(issue)}
            {#if RENAMED_ISSUE_NOTES[issue]}
              <span class="relative inline-block">
                <button
                  type="button"
                  class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-primary hover:text-primary-700 dark:hover:text-primary-300 leading-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  aria-label="About this issue name"
                  aria-expanded={visibleTooltip === issue + "-mobile"}
                  aria-controls={visibleTooltip === issue + "-mobile"
                    ? noteId(issue + "-mobile")
                    : undefined}
                  aria-describedby={visibleTooltip === issue + "-mobile"
                    ? noteId(issue + "-mobile")
                    : undefined}
                  on:click|stopPropagation={() =>
                    toggleTooltip(issue + "-mobile")}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="w-4 h-4"
                    aria-hidden="true"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
                {#if visibleTooltip === issue + "-mobile"}
                  <div
                    id={noteId(issue + "-mobile")}
                    class="absolute z-10 left-0 top-11 w-64 rounded-lg border border-stroke bg-surface p-3 shadow-lg text-sm text-content-muted"
                    role="tooltip"
                  >
                    <p>{RENAMED_ISSUE_NOTES[issue]}</p>

                    <button
                      type="button"
                      class="mt-2 inline-flex min-h-11 items-center text-xs text-content-subtle hover:text-content underline"
                      on:click|stopPropagation={() => {
                        visibleTooltip = null;
                      }}>Dismiss</button
                    >
                  </div>
                {/if}
              </span>
            {/if}
          </h3>
          <ConfidenceIndicator confidence={stance.confidence} />
        </div>
        <p class="mb-3 text-sm leading-relaxed text-content-muted">
          {cleanDisplayText(stance.stance)}
        </p>
        {#if stance.sources?.length > 0}
          <div class="text-sm">
            <span class="text-content-muted">Sources:</span>
            <div class="mt-1 space-y-1">
              {#each visibleSources(stance, expandedSources.has(issue + "-mobile")) as source}
                <div>
                  <SourceLink {source} />
                </div>
              {/each}
            </div>
            {#if stance.sources.length > INITIAL_SOURCE_LIMIT}
              <button
                type="button"
                aria-expanded={expandedSources.has(issue + "-mobile")}
                class="mt-2 inline-flex min-h-11 items-center text-primary hover:text-primary-700 dark:hover:text-primary-300 text-sm underline"
                aria-label={expandedSources.has(issue + "-mobile")
                  ? `Show fewer sources for ${subject} on ${getIssueDisplayName(issue)}`
                  : moreSourcesLabel(
                      issue,
                      stance.sources.length - INITIAL_SOURCE_LIMIT,
                    )}
                on:click={() => toggleSources(issue + "-mobile")}
              >
                {expandedSources.has(issue + "-mobile")
                  ? "Show fewer sources"
                  : moreSourcesText(
                      stance.sources.length - INITIAL_SOURCE_LIMIT,
                    )}
              </button>
            {/if}
          </div>
        {:else}
          <p class="text-content-faint text-sm">
            No supporting sources available
          </p>
        {/if}
      </div>
    {/each}
    {#if issueEntries.length > 1}
      <p class="text-sm text-content-subtle">
        Choose another issue above to review the remaining researched positions.
      </p>
    {/if}
  </div>
  {#if noPositionIssues.length > 0}
    <p class="no-position-line">
      <span class="font-semibold text-content-muted"
        >No public position found:</span
      >
      {noPositionIssues.join(", ")}
    </p>
  {/if}
{/if}

<style lang="postcss">
  @reference "../../app.css";

  .issue-picker--sticky {
    @apply sticky z-20;
    top: var(--site-header-height, 0px);
  }

  /* At 200% zoom or on a landscape phone, pinned bars would cover most of
     the screen. */
  @media (max-height: 500px) {
    .issue-picker--sticky {
      position: static;
    }
  }

  .no-positions {
    @apply rounded-lg border border-dashed border-stroke bg-surface-alt/40 p-4;
  }

  .no-positions-title {
    @apply text-sm font-semibold text-content-muted;
  }

  .no-positions-details {
    @apply mt-1 text-sm text-content-subtle;
  }

  .no-positions-details summary {
    @apply inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary hover:underline;
  }

  .no-positions-list,
  .no-position-line {
    @apply text-sm leading-6 text-content-subtle;
  }

  .no-position-line {
    @apply mt-4 border-t border-stroke pt-3;
  }
</style>
