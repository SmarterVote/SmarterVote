<script lang="ts">
  import IssueTable from "./IssueTable.svelte";
  import DonorTable from "./DonorTable.svelte";
  import VotingRecordTable from "./VotingRecordTable.svelte";
  import TabButton from "./TabButton.svelte";
  import Card from "./Card.svelte";
  import type { Candidate } from "$lib/types";
  import { candidateSlug, careerYears } from "$lib/utils/format";
  import { partyBadgeClass } from "$lib/utils/party";
  import { isExternalUrl } from "$lib/utils/url";
  import CandidateAvatar from "./CandidateAvatar.svelte";
  import { cleanDisplayText } from "$lib/utils/racePage";
  import { createEventDispatcher } from "svelte";

  export let candidate: Candidate;
  export let raceId: string = "";
  export let draft: boolean = false;
  export let selectable = false;
  export let selected = false;

  const dispatch = createEventDispatcher<{ toggleSelect: void }>();

  $: draftQuery = draft ? "?draft=true" : "";

  let expanded = false;
  let activeTab: "issues" | "background" | "donors" | "voting" = "issues";

  function toggleExpanded() {
    expanded = !expanded;
  }

  function setActiveTab(tab: "issues" | "background" | "donors" | "voting") {
    activeTab = tab;
  }

  $: hasCareer =
    candidate.career_history && candidate.career_history.length > 0;
  $: hasEducation = candidate.education && candidate.education.length > 0;
  $: hasBackground = hasCareer || hasEducation;
  $: hasVoting = !!candidate.voting_summary;
  $: hasDonors = !!candidate.donor_summary;
  $: candidateSummary = cleanDisplayText(
    typeof candidate.summary === "string" ? candidate.summary : "",
  );
  $: profileHref = `/races/${raceId}/${candidateSlug(candidate.name)}/${draftQuery}`;
</script>

<Card
  class="candidate-card{expanded ? ' candidate-card--expanded' : ''}"
  id={candidateSlug(candidate.name)}
>
  <!-- Candidate Header -->
  <div class="flex items-start gap-3 sm:gap-4">
    <span class="card-avatar">
      <CandidateAvatar
        name={candidate.name}
        imageUrl={candidate.image_url}
        size={64}
        alt={candidate.name}
      />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-start justify-between gap-2">
        <h3 class="candidate-name">
          <a href={profileHref} class="candidate-name-link">{candidate.name}</a>
        </h3>
        {#if selectable}
          <label class="compare-toggle" class:is-selected={selected}>
            <input
              type="checkbox"
              checked={selected}
              on:change={() => dispatch("toggleSelect")}
              class="compare-checkbox"
              aria-label="Select {candidate.name} to compare"
            />
            <span aria-hidden="true">Compare</span>
          </label>
        {/if}
      </div>
      <div class="mt-1 flex flex-wrap items-center gap-1.5">
        {#if candidate.party}
          <span
            class="badge {partyBadgeClass(candidate.party)}"
            title={candidate.party}>{candidate.party}</span
          >
        {/if}
        {#if candidate.incumbent}
          <span class="badge incumbent-badge">Incumbent</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Summary: clamped until expanded so a grid of cards stays scannable. -->
  {#if candidateSummary}
    <p class="summary" class:summary-clamped={!expanded}>
      {candidateSummary}
    </p>
  {/if}

  <div class="card-actions">
    <button
      type="button"
      class="expand-button"
      on:click={toggleExpanded}
      aria-expanded={expanded}
    >
      <span
        >{expanded ? "Show less" : "Show more"}<span class="sr-only">
          for {candidate.name}</span
        ></span
      >
      <svg
        class="expand-icon"
        class:expanded
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
    <span class="card-actions-links">
      {#if isExternalUrl(candidate.website)}
        <a
          href={candidate.website.trim()}
          target="_blank"
          rel="noopener noreferrer"
          class="card-link"
        >
          Website
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
          <span class="sr-only">(campaign website for {candidate.name})</span>
        </a>
      {/if}
      <a href={profileHref} class="card-link">
        Full profile<span class="sr-only"> of {candidate.name}</span>
        <span aria-hidden="true">&rarr;</span>
      </a>
    </span>
  </div>

  <!-- Expanded Content - Only show when expanded -->
  {#if expanded}
    <div class="expanded-content">
      <!-- Tab Navigation -->
      <div class="tab-navigation">
        <TabButton
          active={activeTab === "issues"}
          onClick={() => setActiveTab("issues")}
        >
          Key Issues
        </TabButton>
        <TabButton
          active={activeTab === "background"}
          onClick={() => setActiveTab("background")}
          disabled={!hasBackground}
        >
          Background
        </TabButton>
        <TabButton
          active={activeTab === "donors"}
          onClick={() => setActiveTab("donors")}
          disabled={!hasDonors}
        >
          Donors
        </TabButton>
        <TabButton
          active={activeTab === "voting"}
          onClick={() => setActiveTab("voting")}
          disabled={!hasVoting}
        >
          Voting Record
        </TabButton>
      </div>

      <!-- Tab Content -->
      <div class="tab-content">
        {#if activeTab === "issues"}
          <IssueTable
            issues={candidate.issues}
            {raceId}
            candidateName={candidate.name}
          />
        {:else if activeTab === "background"}
          <div class="background-section">
            {#if hasCareer}
              <div class="mb-6">
                <h4 class="section-title">Career History</h4>
                <div class="timeline">
                  {#each candidate.career_history as entry}
                    <div class="timeline-entry">
                      <div class="timeline-header">
                        <span class="timeline-title">{entry.title}</span>
                        {#if careerYears(entry)}
                          <span class="timeline-years">
                            {careerYears(entry)}
                          </span>
                        {/if}
                      </div>
                      {#if entry.organization}
                        <span class="timeline-org">{entry.organization}</span>
                      {/if}
                      {#if entry.description}
                        <p class="timeline-desc">{entry.description}</p>
                      {/if}
                      {#if entry.source && isExternalUrl(entry.source.url)}
                        <a
                          href={entry.source.url.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="entry-source-link"
                        >
                          <svg
                            class="w-3 h-3 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                          {entry.source.title ?? "Source"}
                        </a>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            {#if hasEducation}
              <div>
                <h4 class="section-title">Education</h4>
                <div class="education-list">
                  {#each candidate.education as edu}
                    <div class="education-entry">
                      <span class="edu-institution">{edu.institution}</span>
                      {#if edu.degree || edu.field}
                        <span class="edu-degree">
                          {[edu.degree, edu.field].filter(Boolean).join(" in ")}
                          {#if edu.year}
                            ({edu.year})
                          {/if}
                        </span>
                      {/if}
                      {#if edu.source && isExternalUrl(edu.source.url)}
                        <a
                          href={edu.source.url.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="entry-source-link"
                        >
                          <svg
                            class="w-3 h-3 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                          {edu.source.title ?? "Source"}
                        </a>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            {#if !hasBackground}
              <p class="text-content-subtle text-sm">
                No background information available yet.
              </p>
            {/if}
          </div>
        {:else if activeTab === "donors"}
          <DonorTable
            donorSummary={candidate.donor_summary || ""}
            donorSourceUrl={candidate.donor_source_url || ""}
            donorSources={candidate.donor_sources || []}
            {raceId}
            candidateName={candidate.name}
          />
        {:else if activeTab === "voting"}
          <VotingRecordTable
            votingSummary={candidate.voting_summary || ""}
            votingSourceUrl={candidate.voting_source_url || ""}
            votingSources={candidate.voting_sources || []}
            {raceId}
            candidateName={candidate.name}
          />
        {/if}
      </div>
    </div>
  {/if}
</Card>

<style lang="postcss">
  /* Scoped `dark:` variants inside <style> never match: Svelte scopes the
     `.dark` ancestor to this component. Dark overrides use :global(.dark). */
  :global(.candidate-card) {
    @apply flex h-full w-full flex-col p-4 sm:p-5;
  }

  .card-avatar {
    @apply flex shrink-0;
    --avatar-display-size: 3.5rem;
  }

  @media (min-width: 640px) {
    .card-avatar {
      --avatar-display-size: 4rem;
    }
  }

  .candidate-name {
    @apply min-w-0 text-lg font-bold leading-snug text-content sm:text-xl;
  }

  .candidate-name-link {
    @apply text-content no-underline transition-colors duration-200 hover:text-primary hover:underline;
  }

  /* Labelled toggle chip rather than a bare checkbox. */
  .compare-toggle {
    @apply inline-flex min-h-9 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full border border-stroke bg-surface px-2.5 py-1 text-xs font-semibold text-content-muted transition-colors hover:border-primary-300 hover:text-content;
  }

  .compare-toggle.is-selected {
    @apply border-primary-500 bg-primary-50 text-primary-800;
  }

  :global(.dark) .compare-toggle.is-selected {
    @apply border-primary-400 bg-primary-950/50 text-primary-200;
  }

  .compare-checkbox {
    @apply h-4 w-4 cursor-pointer rounded border-stroke bg-surface text-primary-600 focus:ring-2 focus:ring-primary-500 focus:ring-offset-0;
  }

  .badge {
    @apply rounded-full px-2.5 py-0.5 text-xs font-medium;
  }

  .incumbent-badge {
    @apply bg-green-100 text-green-800;
  }

  :global(.dark) .incumbent-badge {
    @apply bg-green-900/60 text-green-200;
  }

  .summary {
    @apply mt-4 text-sm leading-relaxed text-content-muted;
  }

  .summary-clamped {
    @apply line-clamp-4;
  }

  .card-actions {
    @apply mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-3;
  }

  .card-actions-links {
    @apply flex flex-wrap items-center gap-x-4;
  }

  .card-link {
    @apply inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:underline;
  }

  .expand-button {
    @apply inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary transition-colors duration-200 hover:underline;
  }

  .expand-icon {
    @apply h-4 w-4 transition-transform duration-200;
  }

  .expand-icon.expanded {
    @apply rotate-180;
  }

  .expanded-content {
    @apply mt-3 border-t border-stroke pt-4 sm:pt-5;
  }

  .tab-navigation {
    @apply mb-5 flex overflow-x-auto border-b border-stroke;
  }

  .tab-content {
    @apply min-h-32;
  }

  /* Background / Career / Education styles */
  .background-section {
    @apply space-y-4;
  }

  .section-title {
    @apply mb-3 text-base font-semibold text-content;
  }

  .timeline {
    @apply space-y-3;
  }

  .timeline-entry {
    @apply border-l-2 border-stroke py-1 pl-4;
  }

  .timeline-header {
    @apply flex flex-wrap items-baseline gap-2;
  }

  .timeline-title {
    @apply text-sm font-medium text-content;
  }

  .timeline-years {
    @apply text-xs text-content-subtle;
  }

  .timeline-org {
    @apply block text-sm text-content-muted;
  }

  .timeline-desc {
    @apply mt-1 text-xs text-content-subtle;
  }

  .entry-source-link {
    @apply mt-2 inline-flex min-h-6 items-center gap-1 py-1 text-xs text-primary hover:underline;
  }

  .education-list {
    @apply space-y-2;
  }

  .education-entry {
    @apply flex flex-col;
  }

  .edu-institution {
    @apply text-sm font-medium text-content;
  }

  .edu-degree {
    @apply text-xs text-content-muted;
  }
</style>
