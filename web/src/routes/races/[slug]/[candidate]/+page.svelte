<script lang="ts">
  import { browser } from "$app/environment";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import { slide } from "svelte/transition";
  import Card from "$lib/components/Card.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import IssueTable from "$lib/components/IssueTable.svelte";
  import DonorTable from "$lib/components/DonorTable.svelte";
  import VotingRecordTable from "$lib/components/VotingRecordTable.svelte";
  import type { Race } from "$lib/types";
  import { getRace, getDraftRace } from "$lib/api";
  import { candidateSlug } from "$lib/utils/format";
  import { partyBadgeClass } from "$lib/utils/party";
  import { isExternalUrl } from "$lib/utils/url";
  import { motionDuration, scrollBehavior } from "$lib/utils/motion";
  import {
    cleanDisplayText,
    formatPollDate,
    isNotFoundError,
    resolveCandidate,
  } from "$lib/utils/racePage";
  import { headshotFallback } from "$lib/utils/racePageImage";
  import {
    candidateMetaDescription,
    raceDisplayTitle,
  } from "$lib/utils/raceTitle";

  export let data: { prerenderedRace?: Race | null };

  let race: Race | null = data.prerenderedRace ?? null;
  let loading = !race;
  let loadError: string | null = null;
  let raceNotFound = false;
  let othersExpanded = false;
  let isDraftPreview = false;
  let summarySourcesOpen = false;
  let summaryExpanded = false;
  let photoFailed = false;
  let hiddenOtherImages: Record<string, boolean> = {};
  const SUMMARY_SOURCE_LIMIT = 3;

  let slug: string;
  let candidateParam: string;
  $: slug = $page.params.slug as string;
  $: candidateParam = $page.params.candidate as string;

  // Candidate and the rest of the field are derived, so navigating between
  // candidates (or races) always shows the one in the URL.
  $: resolved = resolveCandidate(race, candidateParam);
  $: candidate = resolved.candidate;
  $: otherCandidates = resolved.others;
  $: canonicalSlug = resolved.canonicalSlug ?? candidateParam;
  $: candidateNotFound = !loading && !!race && !candidate;
  $: notFound = raceNotFound || candidateNotFound;
  $: error = loadError;

  let mounted = false;
  let loadedKey: string | null = null;
  let requestId = 0;
  let lastCandidateKey: string | null = null;

  $: draftParam =
    mounted && browser && $page.url.searchParams.get("draft") === "true";
  $: if (mounted && `${slug}|${draftParam}` !== loadedKey)
    loadRace(slug, draftParam);

  // Fresh UI state per candidate.
  $: if (`${slug}/${candidateParam}` !== lastCandidateKey) {
    lastCandidateKey = `${slug}/${candidateParam}`;
    othersExpanded = false;
    summarySourcesOpen = false;
    summaryExpanded = false;
    photoFailed = false;
    hiddenOtherImages = {};
  }

  // Legacy (pre-accent-folding) slugs still resolve, then move to the
  // canonical URL so there is one indexable address per candidate.
  $: if (mounted && candidate && resolved.isLegacySlug)
    redirectToCanonical(slug, canonicalSlug);

  onMount(() => {
    mounted = true;
  });

  async function redirectToCanonical(raceSlug: string, target: string) {
    const search = isDraftPreview ? "?draft=true" : "";
    await tick();
    try {
      await goto(`/races/${raceSlug}/${target}/${search}${location.hash}`, {
        replaceState: true,
        noScroll: true,
        keepFocus: true,
      });
    } catch {
      // Navigation was superseded; nothing to do.
    }
  }

  async function loadRace(target: string, draft: boolean) {
    const previousSlug = loadedKey?.split("|")[0];
    loadedKey = `${target}|${draft}`;
    const id = ++requestId;
    const prerendered =
      data.prerenderedRace && data.prerenderedRace.id === target
        ? data.prerenderedRace
        : null;

    if (previousSlug !== target) race = prerendered;
    isDraftPreview = draft;
    loadError = null;
    raceNotFound = false;
    loading = !race;

    try {
      let next: Race;
      if (draft) {
        try {
          next = await getDraftRace(target);
        } catch {
          next = await getRace(target, fetch, false);
          if (id !== requestId) return;
          isDraftPreview = false;
          loadedKey = `${target}|false`;
          try {
            replaceState(`/races/${target}/${candidateParam}/`, {});
          } catch {
            // Router not ready yet; the stale ?draft=true is harmless.
          }
        }
      } else {
        next = await getRace(target);
      }
      if (id !== requestId) return;
      race = next;
    } catch (err) {
      if (id !== requestId) return;
      if (race && race.id === target) {
        if (draft) isDraftPreview = false;
        return;
      }
      try {
        const fallback = await getRace(target, fetch, true);
        if (id !== requestId) return;
        race = fallback;
      } catch {
        if (id !== requestId) return;
        race = null;
        if (isNotFoundError(err)) raceNotFound = true;
        else
          loadError =
            err instanceof Error ? err.message : "Failed to load race data";
      }
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function jumpToSection(event: MouseEvent, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: scrollBehavior() });
    // Move focus so keyboard and screen-reader users land in the section.
    const heading = target.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  $: summaryText = cleanDisplayText(candidate?.summary);
  $: raceHref = `/races/${slug}/${isDraftPreview ? "?draft=true" : ""}`;
  $: sectionLinks = [
    ...(summaryText ? [{ id: "about", label: "About" }] : []),
    { id: "positions", label: "Positions" },
    ...(hasCareer || hasEducation
      ? [{ id: "background", label: "Background" }]
      : []),
    ...(hasDonors ? [{ id: "donors", label: "Top donors" }] : []),
    ...(hasVoting ? [{ id: "voting-record", label: "Voting record" }] : []),
  ];

  $: hasCareer =
    candidate &&
    candidate.career_history &&
    candidate.career_history.length > 0;
  $: hasEducation =
    candidate && candidate.education && candidate.education.length > 0;
  $: hasVoting = !!(candidate && candidate.voting_summary);
  $: hasDonors = !!(candidate && candidate.donor_summary);
  $: candidateDiscoveryOnly =
    candidate != null &&
    (!candidate.issues ||
      Object.keys(candidate.issues).length === 0 ||
      Object.values(candidate.issues).every((i) => !i?.stance?.trim()));
  $: socialLinks = Object.entries(candidate?.social_media ?? {}).filter(
    (entry): entry is [string, string] => isExternalUrl(entry[1]),
  );
  $: metaDescription = candidateMetaDescription(candidate, race);
  $: pageTitle = `${candidate?.name ?? "Candidate"} — ${
    race ? raceDisplayTitle(race) : "Election"
  } | Smarter.Vote`;
  $: canonicalUrl = `https://smarter.vote/races/${slug}/${canonicalSlug}/`;
  $: compareHref =
    candidate && otherCandidates.length > 0
      ? `/races/${slug}/compare/?candidates=${candidateSlug(
          candidate.name,
        )},${candidateSlug(otherCandidates[0].name)}${
          isDraftPreview ? "&draft=true" : ""
        }`
      : "";
</script>

<svelte:head>
  {#if notFound}
    <title>Candidate not found | Smarter.Vote</title>
    <meta name="robots" content="noindex" />
  {:else}
    <title>{pageTitle}</title>
    <meta name="description" content={metaDescription} />
    <link rel="canonical" href={canonicalUrl} />
    <meta property="og:type" content="profile" />
    <meta property="og:url" content={canonicalUrl} />
    <meta property="og:title" content={pageTitle} />
    <meta property="og:description" content={metaDescription} />
    <meta
      property="og:image"
      content={candidate?.image_url || "https://smarter.vote/og-image.png"}
    />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content={canonicalUrl} />
    <meta name="twitter:title" content={pageTitle} />
    <meta name="twitter:description" content={metaDescription} />
    <meta
      name="twitter:image"
      content={candidate?.image_url || "https://smarter.vote/og-image.png"}
    />
    {#if isDraftPreview}
      <meta name="robots" content="noindex" />
    {/if}
  {/if}
</svelte:head>

<div class="page-container py-6 sm:py-8">
  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div
        class="h-12 w-12 animate-spin rounded-full border-b-2 border-primary-600"
      ></div>
      <span class="ml-3 text-lg text-content-muted">Loading candidate...</span>
    </div>
  {:else if notFound}
    {#if raceNotFound}
      <EmptyState
        title="Race not found"
        body="We couldn't find a published race at this address. It may have been renamed, retired after the election, or never published."
      />
    {:else}
      <EmptyState
        title="Candidate not found"
        body="We couldn't find this candidate in the {race
          ? raceDisplayTitle(race)
          : 'race'}. They may have been removed from the field or the link may be out of date."
        primaryHref={raceHref}
        primaryLabel="See all candidates in this race"
        secondaryHref="/elections/"
        secondaryLabel="Browse elections"
      />
    {/if}
  {:else if error}
    <div class="alert-error mx-auto max-w-xl p-6 text-center" role="alert">
      <h1 class="text-xl font-semibold">We couldn't load this candidate</h1>
      <p class="mt-2">
        Something went wrong while loading the race data. Please check your
        connection and try again.
      </p>
      <a href={raceHref} class="btn-secondary mt-4">
        <UiIcon name="arrow-left" size="sm" /> Back to race overview
      </a>
    </div>
  {:else if candidate && race}
    {#if isDraftPreview}
      <div class="alert-warn mb-4 flex items-center gap-2">
        <svg
          class="h-5 w-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          /></svg
        >
        <span
          ><strong>Draft Preview</strong> — This data has not been published. Only
          admins can see this page.</span
        >
      </div>
    {/if}
    {#if candidate.withdrawn}
      <div class="alert-info mb-4 flex items-start gap-3">
        <svg
          class="mt-0.5 h-5 w-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          /></svg
        >
        <div>
          <p class="font-semibold text-content">Candidate Withdrawn</p>
          <p class="mt-1">
            {candidate.name} is no longer running in this race.{candidate.withdrawal_reason
              ? ` ${candidate.withdrawal_reason}.`
              : ""} This profile is preserved for reference.
          </p>
        </div>
      </div>
    {/if}
    {#if candidateDiscoveryOnly}
      <div class="alert-info mb-4 flex items-start gap-3">
        <svg
          class="mt-0.5 h-5 w-5 flex-shrink-0 text-primary"
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
        <div>
          <p class="font-semibold text-content">
            Limited Data — Discovery Only
          </p>
          <p class="mt-1">
            This candidate has basic biographical information but detailed issue
            positions have not been researched yet. Want detailed data? <a
              href="https://github.com/SmarterVote/SmarterVote/issues/new/choose"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-link">Request a research run</a
            >
            or
            <a href="/support/" class="inline-link">sponsor to help fund it</a>.
          </p>
        </div>
      </div>
    {/if}

    <!-- Navigation Bar -->
    <nav class="nav-bar" aria-label="Race navigation">
      <a href={raceHref} class="back-link">
        <UiIcon name="arrow-left" size="sm" />
        <span class="truncate sm:hidden">Race overview</span>
        <span class="hidden truncate sm:inline"
          >Back to {raceDisplayTitle(race)}</span
        >
      </a>
      {#if otherCandidates.length > 0}
        <a href={compareHref} class="btn-secondary shrink-0">
          <span class="sm:hidden">Compare</span>
          <span class="hidden sm:inline">Compare candidates</span>
        </a>
      {/if}
    </nav>

    <div class="candidate-layout">
      <!-- Profile: a sticky sidebar on desktop, the page header on phones. -->
      <aside class="candidate-aside" aria-label="Candidate profile">
        <Card class="profile-card">
          <div class="profile-top">
            {#if candidate.image_url && !photoFailed}
              <img
                src={candidate.image_url}
                alt={candidate.name}
                width="112"
                height="112"
                decoding="async"
                referrerpolicy="no-referrer"
                class="candidate-photo"
                use:headshotFallback={() => (photoFailed = true)}
              />
            {:else}
              <div
                class="candidate-photo-placeholder"
                role="img"
                aria-label={candidate.name}
              >
                <svg
                  class="h-12 w-12 text-content-faint"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                  />
                </svg>
              </div>
            {/if}
            <div class="min-w-0">
              <h1 class="candidate-detail-name">{candidate.name}</h1>
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                {#if candidate.party}
                  <span class="badge {partyBadgeClass(candidate.party)}"
                    >{candidate.party}</span
                  >
                {/if}
                {#if candidate.incumbent}
                  <span class="badge incumbent-badge">Incumbent</span>
                {/if}
              </div>
              <p class="mt-2 text-sm text-content-subtle">
                {raceDisplayTitle(race)}
              </p>
            </div>
          </div>

          {#if isExternalUrl(candidate.website) || socialLinks.length > 0}
            <div class="quick-links">
              {#if isExternalUrl(candidate.website)}
                <a
                  href={candidate.website.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="quick-link"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"
                    />
                  </svg>
                  Campaign website
                </a>
              {/if}
              {#each socialLinks as [platform, url]}
                <a
                  href={url.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="quick-link"
                >
                  <span class="capitalize">{platform}</span>
                </a>
              {/each}
            </div>
          {/if}
        </Card>

        {#if sectionLinks.length > 1}
          <nav class="detail-nav" aria-label="Candidate profile sections">
            <p class="detail-nav-label">On this page</p>
            <ul class="detail-nav-links">
              {#each sectionLinks as link (link.id)}
                <li>
                  <a
                    href="#{link.id}"
                    on:click={(event) => jumpToSection(event, link.id)}
                    >{link.label}</a
                  >
                </li>
              {/each}
            </ul>
          </nav>
        {/if}

        <!-- Other Candidates (Collapsible) -->
        {#if otherCandidates.length > 0}
          <div class="other-candidates-bar">
            <button
              type="button"
              class="toggle-others"
              on:click={() => (othersExpanded = !othersExpanded)}
              aria-expanded={othersExpanded}
              aria-label={`Other Candidates (${otherCandidates.length})`}
            >
              <span class="flex items-center gap-2">
                <span>Other candidates</span>
                <span class="other-count">{otherCandidates.length}</span>
              </span>
              <span
                class="inline-flex transition-transform duration-200"
                class:rotate-180={othersExpanded}
                ><UiIcon name="chevron-down" /></span
              >
            </button>
            {#if othersExpanded}
              <div
                transition:slide={{ duration: motionDuration(400) }}
                class="others-list"
              >
                {#each otherCandidates as other (candidateSlug(other.name))}
                  <a
                    href="/races/{race.id}/{candidateSlug(
                      other.name,
                    )}/{isDraftPreview ? '?draft=true' : ''}"
                    class="other-chip"
                  >
                    {#if other.image_url && !hiddenOtherImages[other.name]}
                      <img
                        src={other.image_url}
                        alt=""
                        width="32"
                        height="32"
                        loading="lazy"
                        decoding="async"
                        referrerpolicy="no-referrer"
                        class="other-avatar"
                        use:headshotFallback={() =>
                          (hiddenOtherImages = {
                            ...hiddenOtherImages,
                            [other.name]: true,
                          })}
                      />
                    {/if}
                    <span class="other-info">
                      <span class="other-name">{other.name}</span>
                      {#if other.party}
                        <span class="other-party">{other.party}</span>
                      {/if}
                    </span>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </aside>

      <div class="candidate-main">
        {#if summaryText}
          <section id="about" class="detail-section scroll-mt-24">
            <h2 class="h-section section-heading">About</h2>
            <Card class="section-card">
              <p class="candidate-summary" class:is-expanded={summaryExpanded}>
                {summaryText}
              </p>
              {#if summaryText.length > 320}
                <div class="sm:hidden">
                  <button
                    type="button"
                    class="link-button"
                    aria-expanded={summaryExpanded}
                    on:click={() => (summaryExpanded = !summaryExpanded)}
                  >
                    {summaryExpanded ? "Show less" : "Read full biography"}
                    <span
                      class="inline-flex transition-transform duration-200"
                      class:rotate-180={summaryExpanded}
                      ><UiIcon name="chevron-down" size="sm" /></span
                    >
                  </button>
                </div>
              {/if}

              {#if candidate.summary_sources && candidate.summary_sources.length > 0}
                <div class="summary-sources">
                  <p class="summary-sources-heading">
                    Biography sources
                    <span class="source-count"
                      >{candidate.summary_sources.length}</span
                    >
                  </p>
                  <ul class="summary-sources-list">
                    {#each summarySourcesOpen ? candidate.summary_sources : candidate.summary_sources.slice(0, SUMMARY_SOURCE_LIMIT) as src}
                      <li>
                        {#if isExternalUrl(src.url)}
                          <a
                            href={src.url.trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="summary-source-link"
                          >
                            <span>{src.title ?? src.url}</span>
                            <UiIcon name="external" size="sm" />
                          </a>
                        {:else}
                          <span class="summary-source-link"
                            >{src.title ?? src.url}</span
                          >
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  {#if candidate.summary_sources.length > SUMMARY_SOURCE_LIMIT}
                    <button
                      type="button"
                      class="link-button text-xs"
                      on:click={() =>
                        (summarySourcesOpen = !summarySourcesOpen)}
                      aria-expanded={summarySourcesOpen}
                      aria-label={summarySourcesOpen
                        ? `Show fewer biography sources for ${candidate.name}`
                        : `Show ${
                            candidate.summary_sources.length -
                            SUMMARY_SOURCE_LIMIT
                          } more biography sources for ${candidate.name}`}
                    >
                      {summarySourcesOpen
                        ? "Show fewer"
                        : `Show ${
                            candidate.summary_sources.length -
                            SUMMARY_SOURCE_LIMIT
                          } more`}
                    </button>
                  {/if}
                </div>
              {/if}
            </Card>
          </section>
        {/if}

        <!-- Issues Section -->
        <section id="positions" class="detail-section scroll-mt-24">
          <h2 class="h-section section-heading">Positions on Key Issues</h2>
          <Card class="section-card">
            <IssueTable
              issues={candidate.issues}
              raceId={race.id}
              candidateName={candidate.name}
            />
          </Card>
        </section>

        <!-- Background Section -->
        {#if hasCareer || hasEducation}
          <section id="background" class="detail-section scroll-mt-24">
            <h2 class="h-section section-heading">Background</h2>
            <Card class="section-card">
              <div
                class="background-grid"
                class:two-col={hasCareer && hasEducation}
              >
                {#if hasCareer}
                  <div>
                    <h3 class="subsection-title">Career History</h3>
                    <div class="timeline">
                      {#each candidate.career_history as entry}
                        <div class="timeline-entry">
                          <div class="timeline-header">
                            <span class="timeline-title">{entry.title}</span>
                            {#if entry.start_year}
                              <span class="timeline-years">
                                {entry.start_year}{entry.end_year
                                  ? ` – ${entry.end_year}`
                                  : " – Present"}
                              </span>
                            {/if}
                          </div>
                          {#if entry.organization}
                            <span class="timeline-org"
                              >{entry.organization}</span
                            >
                          {/if}
                          {#if entry.description}
                            <p class="timeline-desc">
                              {cleanDisplayText(entry.description)}
                            </p>
                          {/if}
                          {#if entry.source && isExternalUrl(entry.source.url)}
                            <a
                              href={entry.source.url.trim()}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="entry-source-link"
                            >
                              <UiIcon name="external" size="sm" />
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
                    <h3 class="subsection-title">Education</h3>
                    <div class="space-y-3">
                      {#each candidate.education as edu}
                        <div class="edu-entry">
                          <span class="edu-institution">{edu.institution}</span>
                          {#if edu.degree || edu.field}
                            <span class="edu-degree">
                              {[edu.degree, edu.field]
                                .filter(Boolean)
                                .join(" in ")}
                              {#if edu.year}({edu.year}){/if}
                            </span>
                          {/if}
                          {#if edu.source && isExternalUrl(edu.source.url)}
                            <a
                              href={edu.source.url.trim()}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="entry-source-link"
                            >
                              <UiIcon name="external" size="sm" />
                              {edu.source.title ?? "Source"}
                            </a>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </Card>
          </section>
        {/if}

        <!-- Top Donors Section -->
        {#if hasDonors}
          <section id="donors" class="detail-section scroll-mt-24">
            <h2 class="h-section section-heading">Top Donors</h2>
            <Card class="section-card">
              <DonorTable
                donorSummary={candidate.donor_summary || ""}
                donorSourceUrl={candidate.donor_source_url || ""}
                donorSources={candidate.donor_sources || []}
                raceId={race.id}
                candidateName={candidate.name}
              />
            </Card>
          </section>
        {/if}

        <!-- Voting Record Section -->
        {#if hasVoting}
          <section id="voting-record" class="detail-section scroll-mt-24">
            <h2 class="h-section section-heading">Voting Record</h2>
            <Card class="section-card">
              <VotingRecordTable
                votingSummary={candidate.voting_summary || ""}
                votingSourceUrl={candidate.voting_source_url || ""}
                votingSources={candidate.voting_sources || []}
                raceId={race.id}
                candidateName={candidate.name}
              />
            </Card>
          </section>
        {/if}

        <!-- Data Note -->
        <div class="alert-info">
          <p class="font-semibold text-content">About this research</p>
          <p class="mt-1">
            Data compiled from public sources and analyzed using AI. Last
            updated
            {formatPollDate(race.updated_utc, {
              month: "long",
              day: "numeric",
              year: "numeric",
            }) || "recently"}. Visit candidate websites for the most current
            information.
          </p>
        </div>
      </div>
    </div>
  {/if}
</div>

<style lang="postcss">
  /* Scoped `dark:` variants inside <style> never match: Svelte scopes the
     `.dark` ancestor to this component. Dark overrides use :global(.dark). */
  .inline-link {
    @apply font-medium text-primary underline hover:no-underline;
  }

  .link-button {
    @apply inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline;
  }

  .nav-bar {
    @apply mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:mb-6 sm:gap-3;
  }

  .back-link {
    @apply -ml-2 inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary no-underline transition-colors duration-200 hover:bg-surface-alt;
  }

  /* Profile sidebar + content column on desktop. */
  .candidate-layout {
    @apply grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[19rem_minmax(0,1fr)];
  }

  .candidate-aside {
    @apply flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--site-header-height)+1rem)];
  }

  .candidate-main {
    @apply min-w-0 space-y-8;
  }

  :global(.profile-card) {
    @apply p-5;
  }

  .profile-top {
    @apply flex items-start gap-4 lg:flex-col;
  }

  .candidate-photo {
    @apply h-24 w-24 flex-shrink-0 rounded-xl border border-stroke object-cover sm:h-28 sm:w-28 lg:h-32 lg:w-32;
  }

  .candidate-photo-placeholder {
    @apply flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-xl border border-stroke bg-surface-alt sm:h-28 sm:w-28 lg:h-32 lg:w-32;
  }

  .candidate-detail-name {
    @apply text-2xl font-bold leading-tight tracking-tight text-content sm:text-3xl lg:text-2xl;
  }

  .badge {
    @apply rounded-full px-2.5 py-0.5 text-xs font-medium sm:text-sm;
  }

  .incumbent-badge {
    @apply bg-green-100 text-green-800;
  }

  :global(.dark) .incumbent-badge {
    @apply bg-green-900/60 text-green-200;
  }

  .quick-links {
    @apply mt-4 flex flex-wrap gap-2 border-t border-stroke pt-4;
  }

  .quick-link {
    @apply inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-stroke bg-surface px-3 py-1.5 text-sm font-medium text-content no-underline transition-colors duration-200 hover:bg-surface-alt;
  }

  /* Section nav: a horizontal sticky strip on phones, a vertical list in the
     desktop sidebar. */
  .detail-nav {
    @apply sticky top-[var(--site-header-height)] z-30 rounded-xl border border-stroke bg-surface/95 p-2 shadow-sm backdrop-blur lg:static lg:bg-surface lg:p-3 lg:backdrop-blur-none;
  }

  .detail-nav-label {
    @apply hidden px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-content-subtle lg:block;
  }

  .detail-nav-links {
    @apply flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible;
  }

  .detail-nav-links li {
    @apply shrink-0;
  }

  .detail-nav-links a {
    @apply inline-flex min-h-11 w-full items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-primary no-underline hover:bg-surface-alt lg:min-h-10;
  }

  /* Other candidates collapsible */
  .other-candidates-bar {
    @apply overflow-hidden rounded-xl border border-stroke bg-surface shadow-sm;
  }

  .toggle-others {
    @apply flex min-h-12 w-full items-center justify-between px-4 py-3 text-sm font-semibold text-content transition-colors duration-200 hover:bg-surface-alt/70;
  }

  .other-count,
  .source-count {
    @apply inline-flex min-w-5 items-center justify-center rounded-full bg-surface-alt px-1.5 py-0.5 text-xs font-bold text-content-muted;
  }

  .others-list {
    @apply grid grid-cols-1 gap-2 border-t border-stroke bg-surface-alt/35 p-3 sm:grid-cols-2 lg:max-h-80 lg:grid-cols-1 lg:overflow-y-auto;
  }

  .other-chip {
    @apply flex min-h-12 min-w-0 items-center gap-3 rounded-lg border border-stroke bg-surface px-3 py-2 text-content no-underline transition-colors duration-200 hover:border-primary-300 hover:bg-surface-alt;
  }

  .other-avatar {
    @apply h-8 w-8 rounded-full object-cover;
  }

  .other-info {
    @apply flex min-w-0 flex-col;
  }

  .other-name {
    @apply truncate text-sm font-medium text-content;
  }

  .other-party {
    @apply text-xs text-content-subtle;
  }

  /* Sections */
  .section-heading {
    @apply mb-3;
  }

  :global(.section-card) {
    @apply p-4 sm:p-6;
  }

  .candidate-summary {
    @apply text-sm leading-7 text-content-muted sm:text-base sm:leading-relaxed;
  }

  .candidate-summary:not(.is-expanded) {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 6;
  }

  @media (min-width: 640px) {
    .candidate-summary:not(.is-expanded) {
      display: block;
      overflow: visible;
    }
  }

  .summary-sources {
    @apply mt-5 border-t border-stroke pt-4;
  }

  .summary-sources-heading {
    @apply inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-content-subtle;
  }

  .summary-sources-list {
    @apply mt-2 space-y-0.5;
  }

  .summary-source-link {
    @apply -mx-2 inline-flex min-h-9 min-w-0 max-w-full items-start gap-2 rounded-lg px-2 py-1.5 text-sm leading-5 text-primary no-underline hover:bg-surface-alt hover:underline;
  }

  .summary-source-link span {
    @apply min-w-0 break-words;
  }

  .subsection-title {
    @apply mb-3 text-base font-semibold text-content;
  }

  .background-grid {
    @apply grid gap-8;
  }

  .background-grid.two-col {
    @apply md:grid-cols-2;
  }

  /* Timeline */
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

  /* Education */
  .edu-entry {
    @apply flex flex-col;
  }

  .edu-institution {
    @apply text-sm font-medium text-content;
  }

  .edu-degree {
    @apply text-xs text-content-muted;
  }

  .entry-source-link {
    @apply mt-1 inline-flex min-h-6 items-center gap-1 text-xs text-primary no-underline hover:underline;
  }
</style>
