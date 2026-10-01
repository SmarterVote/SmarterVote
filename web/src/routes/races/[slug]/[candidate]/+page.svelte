<script lang="ts">
  import { browser } from "$app/environment";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import { slide } from "svelte/transition";
  import Card from "$lib/components/Card.svelte";
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

  $: sectionLinks = [
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

<div class="container mx-auto px-4 py-6 sm:py-8 max-w-4xl">
  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div
        class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"
      ></div>
      <span class="ml-3 text-lg text-content-muted">Loading candidate...</span>
    </div>
  {:else if notFound}
    <div
      class="mx-auto max-w-2xl rounded-2xl border border-stroke bg-surface p-6 text-center shadow-sm sm:p-10"
    >
      <h1 class="text-2xl font-bold text-content sm:text-3xl">
        {raceNotFound ? "Race not found" : "Candidate not found"}
      </h1>
      <p class="mt-3 text-sm leading-relaxed text-content-muted sm:text-base">
        {#if raceNotFound}
          We couldn't find a published race at this address. It may have been
          renamed, retired after the election, or never published.
        {:else}
          We couldn't find this candidate in the {race
            ? raceDisplayTitle(race)
            : "race"}. They may have been removed from the field or the link may
          be out of date.
        {/if}
      </p>
      <a
        href={raceNotFound
          ? "/elections/"
          : `/races/${slug}/${isDraftPreview ? "?draft=true" : ""}`}
        class="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white no-underline hover:bg-blue-800"
      >
        <UiIcon name="arrow-left" size="sm" />
        {raceNotFound ? "Browse elections" : "See all candidates in this race"}
      </a>
    </div>
  {:else if error}
    <div
      class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center"
      role="alert"
    >
      <h2 class="text-2xl font-bold text-red-800 dark:text-red-200 mb-2">
        We couldn't load this candidate
      </h2>
      <p class="text-red-700 dark:text-red-200">
        Something went wrong while loading the race data. Please check your
        connection and try again.
      </p>
      <a
        href="/races/{slug}/{isDraftPreview ? '?draft=true' : ''}"
        class="mt-4 inline-flex min-h-11 items-center gap-1.5 text-blue-700 hover:underline dark:text-blue-400 font-medium"
      >
        <UiIcon name="arrow-left" size="sm" /> Back to race overview
      </a>
    </div>
  {:else if candidate && race}
    {#if isDraftPreview}
      <div
        class="mb-4 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-600 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2"
      >
        <svg
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
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
      <div
        class="mb-4 rounded-lg border-2 border-gray-400 bg-gray-50 dark:bg-gray-900/20 dark:border-gray-600 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 flex items-start gap-3"
      >
        <svg
          class="w-5 h-5 flex-shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          /></svg
        >
        <div>
          <p class="font-semibold">Candidate Withdrawn</p>
          <p class="mt-1">
            {candidate.name} is no longer running in this race.{candidate.withdrawal_reason
              ? ` ${candidate.withdrawal_reason}.`
              : ""} This profile is preserved for reference.
          </p>
        </div>
      </div>
    {/if}
    {#if candidateDiscoveryOnly}
      <div
        class="mb-4 rounded-lg border-2 border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600 px-4 py-3 text-sm text-blue-800 dark:text-blue-200 flex items-start gap-3"
      >
        <svg
          class="w-5 h-5 flex-shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          /></svg
        >
        <div>
          <p class="font-semibold">Limited Data — Discovery Only</p>
          <p class="mt-1 text-blue-700 dark:text-blue-300">
            This candidate has basic biographical information but detailed issue
            positions have not been researched yet. Want detailed data? <a
              href="https://github.com/SmarterVote/SmarterVote/issues/new/choose"
              target="_blank"
              rel="noopener noreferrer"
              class="underline font-medium hover:text-blue-900 dark:hover:text-blue-100"
              >Request a research run</a
            >
            or
            <a
              href="/support/"
              class="underline font-medium hover:text-blue-900 dark:hover:text-blue-100"
              >sponsor to help fund it</a
            >!
          </p>
        </div>
      </div>
    {/if}
    <!-- Navigation Bar -->
    <nav class="nav-bar">
      <a
        href="/races/{slug}/{isDraftPreview ? '?draft=true' : ''}"
        class="back-link"
      >
        <UiIcon name="arrow-left" size="sm" />
        <span class="sm:hidden">Race overview</span>
        <span class="hidden sm:inline">Back to {raceDisplayTitle(race)}</span>
      </a>
      {#if otherCandidates.length > 0}
        <a href={compareHref} class="compare-link">
          Compare
          <span class="hidden sm:inline">candidates</span>
        </a>
      {/if}
    </nav>

    <!-- Other Candidates (Collapsible) -->
    {#if otherCandidates.length > 0}
      <div class="other-candidates-bar">
        <button
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
                <div class="other-info">
                  <span class="other-name">{other.name}</span>
                  {#if other.party}
                    <span class="other-party">{other.party}</span>
                  {/if}
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Candidate Header -->
    <Card class="candidate-header-card">
      <div class="candidate-top">
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
              class="w-12 h-12 text-gray-400"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
              />
            </svg>
          </div>
        {/if}
        <div class="candidate-headline">
          <h1 class="candidate-detail-name">{candidate.name}</h1>
          <div class="flex flex-wrap items-center gap-2 mt-1">
            {#if candidate.party}
              <span class="badge {partyBadgeClass(candidate.party)}"
                >{candidate.party}</span
              >
            {/if}
            {#if candidate.incumbent}
              <span class="badge incumbent-badge">Incumbent</span>
            {/if}
          </div>
        </div>
      </div>

      {#if candidate.summary}
        <div class="candidate-about">
          <p class="candidate-about-label">About</p>
          <p class="candidate-summary" class:is-expanded={summaryExpanded}>
            {candidate.summary}
          </p>
          {#if candidate.summary.length > 320}
            <button
              type="button"
              class="summary-toggle sm:hidden"
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
          {/if}
        </div>
      {/if}

      {#if candidate.summary_sources && candidate.summary_sources.length > 0}
        <div class="summary-sources">
          <div class="summary-sources-heading">
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            Biography sources
            <span class="source-count">{candidate.summary_sources.length}</span>
          </div>
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
                  <span class="summary-source-link">{src.title ?? src.url}</span
                  >
                {/if}
              </li>
            {/each}
          </ul>
          {#if candidate.summary_sources.length > SUMMARY_SOURCE_LIMIT}
            <button
              class="summary-sources-toggle"
              on:click={() => (summarySourcesOpen = !summarySourcesOpen)}
              aria-expanded={summarySourcesOpen}
              aria-label={summarySourcesOpen
                ? `Show fewer biography sources for ${candidate.name}`
                : `Show ${
                    candidate.summary_sources.length - SUMMARY_SOURCE_LIMIT
                  } more biography sources for ${candidate.name}`}
            >
              {summarySourcesOpen
                ? "Show fewer"
                : `Show ${
                    candidate.summary_sources.length - SUMMARY_SOURCE_LIMIT
                  } more`}
            </button>
          {/if}
        </div>
      {/if}

      <!-- Quick links -->
      <div class="quick-links">
        {#if isExternalUrl(candidate.website)}
          <a
            href={candidate.website.trim()}
            target="_blank"
            rel="noopener noreferrer"
            class="quick-link"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
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
    </Card>

    <nav class="detail-nav" aria-label="Candidate profile sections">
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

    <!-- Issues Section -->
    <section id="positions" class="detail-section scroll-mt-36">
      <h2 class="section-heading">Positions on Key Issues</h2>
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
      <section id="background" class="detail-section scroll-mt-36">
        <h2 class="section-heading">Background</h2>
        <Card class="section-card">
          {#if hasCareer}
            <div class="mb-6">
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
              <h3 class="subsection-title">Education</h3>
              <div class="space-y-2">
                {#each candidate.education as edu}
                  <div class="edu-entry">
                    <span class="edu-institution">{edu.institution}</span>
                    {#if edu.degree || edu.field}
                      <span class="edu-degree">
                        {[edu.degree, edu.field].filter(Boolean).join(" in ")}
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
                        <svg
                          class="w-3 h-3 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
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
        </Card>
      </section>
    {/if}

    <!-- Top Donors Section -->
    {#if hasDonors}
      <section id="donors" class="detail-section scroll-mt-36">
        <h2 class="section-heading">Top Donors</h2>
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
      <section id="voting-record" class="detail-section scroll-mt-36">
        <h2 class="section-heading">Voting Record</h2>
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
    <div class="data-note">
      <p class="data-note-title">About this research</p>
      <p class="data-note-text">
        Data compiled from public sources and analyzed using AI. Last updated
        {formatPollDate(race.updated_utc, {
          month: "long",
          day: "numeric",
          year: "numeric",
        }) || "recently"}. Visit candidate websites for the most current
        information.
      </p>
    </div>
  {/if}
</div>

<style lang="postcss">
  /* Scoped `dark:` variants inside <style> never match: Svelte scopes the
     `.dark` ancestor to this component. Dark overrides use :global(.dark). */
  .nav-bar {
    @apply mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:mb-6 sm:gap-3;
  }

  .back-link {
    @apply inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-blue-700 no-underline transition-colors duration-200 hover:bg-blue-50 hover:text-blue-900 sm:px-3;
  }

  :global(.dark) .back-link {
    @apply text-blue-400 hover:bg-blue-950/30 hover:text-blue-300;
  }

  .compare-link {
    @apply inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-surface px-3 py-1.5 text-sm font-bold text-blue-700 no-underline transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600;
  }

  :global(.dark) .compare-link {
    @apply border-blue-800 text-blue-300 hover:bg-blue-950/30 hover:text-blue-200;
  }

  /* Other candidates collapsible */
  .other-candidates-bar {
    @apply mb-5 overflow-hidden rounded-2xl border border-stroke bg-surface shadow-sm sm:mb-6;
  }

  .toggle-others {
    @apply flex min-h-12 w-full items-center justify-between px-4 py-3 text-sm font-bold
           text-content transition-colors duration-200 hover:bg-surface-alt/70 sm:px-5;
  }

  .other-count,
  .source-count {
    @apply inline-flex min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-extrabold text-blue-700;
  }

  :global(.dark) .other-count,
  :global(.dark) .source-count {
    @apply bg-blue-900/50 text-blue-200;
  }

  .others-list {
    @apply grid grid-cols-1 gap-2 border-t border-stroke bg-surface-alt/35 p-3 sm:grid-cols-2 sm:p-4;
  }

  .other-chip {
    @apply flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-stroke bg-surface px-3 py-2.5 text-content no-underline shadow-sm transition-colors duration-200 hover:border-blue-400 hover:bg-blue-50;
  }

  :global(.dark) .other-chip {
    @apply hover:bg-blue-950;
  }

  .other-avatar {
    @apply w-8 h-8 rounded-full object-cover;
  }

  .other-info {
    @apply flex flex-col;
  }

  .other-name {
    @apply text-sm font-medium text-content;
  }

  .other-party {
    @apply text-xs text-content-subtle;
  }

  /* Candidate header */
  :global(.candidate-header-card) {
    @apply mb-6 overflow-hidden rounded-2xl border border-stroke p-5 shadow-sm sm:p-6;
  }

  .candidate-top {
    @apply flex items-start gap-5 mb-4;
  }

  .candidate-photo {
    @apply w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover border-2 border-stroke flex-shrink-0;
  }

  .candidate-photo-placeholder {
    @apply w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-surface-alt border-2 border-stroke
           flex items-center justify-center flex-shrink-0;
  }

  .candidate-detail-name {
    @apply text-2xl sm:text-3xl font-bold text-content;
  }

  .badge {
    @apply px-2.5 py-1 rounded-full text-xs sm:text-sm font-medium;
  }

  .incumbent-badge {
    @apply bg-green-100 text-green-800;
  }

  :global(.dark) .incumbent-badge {
    @apply bg-green-900 text-green-200;
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

  .candidate-about {
    @apply mb-4 border-t border-stroke pt-4;
  }

  .candidate-about-label {
    @apply mb-2 text-xs font-extrabold uppercase tracking-wider text-content-subtle;
  }

  .summary-toggle {
    @apply mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-800;
  }

  :global(.dark) .summary-toggle {
    @apply text-blue-400 hover:text-blue-300;
  }

  .quick-links {
    @apply flex flex-wrap gap-2;
  }

  .quick-link {
    @apply inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 bg-surface-alt border border-stroke rounded-md text-sm text-content hover:bg-blue-50 hover:border-blue-400 hover:text-blue-600 transition-colors duration-200 no-underline;
  }

  :global(.dark) .quick-link {
    @apply hover:bg-blue-950 hover:text-blue-400;
  }

  /* Sections */
  .detail-section {
    @apply mb-6;
  }

  .detail-nav {
    @apply sticky top-[var(--site-header-height)] z-30 mb-6 rounded-xl border border-stroke bg-surface/95 p-3 shadow-sm backdrop-blur;
  }

  /* A horizontally scrollable row of in-page links on small screens, so the
     section jump works with plain keyboard/AT semantics (the old <select>
     scrolled on every arrow keypress). */
  .detail-nav-links {
    @apply -mx-1 flex gap-1 overflow-x-auto px-1 sm:flex-wrap sm:gap-2;
  }

  .detail-nav-links li {
    @apply shrink-0;
  }

  .detail-nav-links a {
    @apply inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 no-underline hover:bg-blue-50 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600;
  }

  :global(.dark) .detail-nav-links a {
    @apply text-blue-400 hover:bg-blue-950/30 hover:text-blue-300;
  }

  .section-heading {
    @apply text-lg sm:text-xl font-semibold text-content mb-3;
  }

  :global(.section-card) {
    @apply p-4 sm:p-6 shadow-sm;
  }

  .subsection-title {
    @apply text-base font-semibold text-content mb-3;
  }

  /* Timeline */
  .timeline {
    @apply space-y-3;
  }

  .timeline-entry {
    @apply border-l-2 border-blue-300 pl-4 py-1;
  }

  :global(.dark) .timeline-entry {
    @apply border-blue-700;
  }

  .timeline-header {
    @apply flex flex-wrap items-baseline gap-2;
  }

  .timeline-title {
    @apply font-medium text-content text-sm;
  }

  .timeline-years {
    @apply text-xs text-content-subtle;
  }

  .timeline-org {
    @apply text-sm text-content-muted block;
  }

  .timeline-desc {
    @apply text-xs text-content-subtle mt-1;
  }

  /* Education */
  .edu-entry {
    @apply flex flex-col;
  }

  .edu-institution {
    @apply font-medium text-content text-sm;
  }

  .edu-degree {
    @apply text-xs text-content-muted;
  }

  /* Summary sources */
  .summary-sources {
    @apply mb-4 rounded-xl border border-stroke bg-surface-alt/35 p-3 sm:p-4;
  }

  .summary-sources-heading {
    @apply inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-content-subtle;
  }

  .summary-sources-toggle {
    @apply mt-2 inline-flex min-h-11 items-center text-xs text-blue-600 hover:underline font-medium;
  }

  :global(.dark) .summary-sources-toggle {
    @apply text-blue-400;
  }

  .summary-sources-list {
    @apply mt-2 space-y-1 pl-1;
  }

  .summary-source-link {
    @apply inline-flex min-h-9 min-w-0 max-w-full items-start gap-2 rounded-lg px-2 py-1.5 text-xs leading-5 text-blue-600 no-underline hover:bg-blue-50 hover:text-blue-800 sm:text-sm;
  }

  :global(.dark) .summary-source-link {
    @apply text-blue-400 hover:bg-blue-950/30 hover:text-blue-300;
  }

  .summary-source-link span {
    @apply min-w-0 break-words;
  }

  @media (min-width: 640px) {
    .candidate-summary:not(.is-expanded) {
      display: block;
      overflow: visible;
    }
  }

  /* Entry source link (career + education) */
  .entry-source-link {
    @apply inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:underline no-underline;
  }

  :global(.dark) /* Entry source link (career + education) */
  .entry-source-link {
    @apply text-blue-400;
  }

  /* Data note */
  .data-note {
    @apply mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4 sm:p-6 text-center;
  }

  :global(.dark) /* Data note */
  .data-note {
    @apply bg-blue-950 border-blue-800;
  }

  .data-note-title {
    @apply text-blue-800 font-medium mb-2 text-sm sm:text-base;
  }

  :global(.dark) .data-note-title {
    @apply text-blue-200;
  }

  .data-note-text {
    @apply text-blue-700 text-xs sm:text-sm;
  }

  :global(.dark) .data-note-text {
    @apply text-blue-300;
  }
</style>
