<script lang="ts">
  import { browser } from "$app/environment";
  import { replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import CandidateCard from "$lib/components/CandidateCard.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import ReviewPanel from "$lib/components/ReviewPanel.svelte";
  import ValidationGradeBadge from "$lib/components/ValidationGradeBadge.svelte";
  import Card from "$lib/components/Card.svelte";
  import ElectionCountdown from "$lib/components/ElectionCountdown.svelte";
  import { fade, slide } from "svelte/transition";
  import VoterResources from "$lib/components/VoterResources.svelte";
  import type { Race } from "$lib/types";
  import { getRace, getDraftRace } from "$lib/api";
  import { formatModelName, candidateSlug } from "$lib/utils/format";
  import { partyAbbr, partyKey } from "$lib/utils/party";
  import { isExternalUrl } from "$lib/utils/url";
  import { formatRating } from "$lib/utils/forecast";
  import {
    getHostname,
    marketAsOf,
    marketSignalTarget,
    marketSpread,
    probability,
    probabilityOneDecimal,
    ratingClass,
  } from "$lib/utils/forecastPresentation";
  import { formatElectionDate } from "$lib/utils/electionDate";
  import {
    neutralCandidateOrder,
    shortCandidateName,
  } from "$lib/utils/candidates";
  import { motionDuration, scrollBehavior } from "$lib/utils/motion";
  import { headshotFallback } from "$lib/utils/racePageImage";
  import {
    forecastHeadline,
    formatPollDate,
    isNotFoundError,
    jsonLdScript,
    partyProbabilityAriaLabel,
    partyProbabilitySegments,
    raceJsonLd,
    sortPollsByDate,
  } from "$lib/utils/racePage";
  import {
    raceDisplayTitle,
    raceMetaDescription,
    racePageTitle,
  } from "$lib/utils/raceTitle";

  export let data: { prerenderedRace?: Race | null };

  let race: Race | null = data.prerenderedRace ?? null;
  let loading = !race;
  let error: string | null = null;
  let notFound = false;
  let usingFallbackData = false;
  let isDraftPreview = false;

  let selectedCandidates: Set<string> = new Set();
  let forecastExpanded = false;
  let overviewExpanded = false;
  let withdrawnExpanded = false;
  let hiddenChipImages: Record<string, boolean> = {};

  let slug: string;
  $: slug = $page.params.slug as string;

  let mounted = false;
  let loadedKey: string | null = null;
  let requestId = 0;

  $: draftParam =
    mounted && browser && $page.url.searchParams.get("draft") === "true";
  // Client-side navigation between races reuses this component, so the race
  // (and every bit of per-race UI state) must follow the URL, not mount time.
  $: if (mounted && `${slug}|${draftParam}` !== loadedKey)
    loadRace(slug, draftParam);

  onMount(() => {
    mounted = true;
  });

  function resetRaceState() {
    selectedCandidates = new Set();
    forecastExpanded = false;
    overviewExpanded = false;
    withdrawnExpanded = false;
    hiddenChipImages = {};
  }

  function hideChipImage(name: string) {
    hiddenChipImages = { ...hiddenChipImages, [name]: true };
  }

  async function loadRace(target: string, draft: boolean) {
    const previousSlug = loadedKey?.split("|")[0];
    loadedKey = `${target}|${draft}`;
    const id = ++requestId;
    const prerendered =
      data.prerenderedRace && data.prerenderedRace.id === target
        ? data.prerenderedRace
        : null;

    if (previousSlug !== target) {
      resetRaceState();
      // Show the matching prerendered race (never the previous race) while
      // the fresh copy loads.
      race = prerendered;
      usingFallbackData = false;
    }
    isDraftPreview = draft;
    error = null;
    notFound = false;
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
            replaceState(`/races/${target}/`, {});
          } catch {
            // Router not ready yet; the stale ?draft=true is harmless.
          }
        }
      } else {
        next = await getRace(target);
      }
      if (id !== requestId) return;
      race = next;
      usingFallbackData = false;
    } catch (err) {
      if (id !== requestId) return;
      // Keep the prerendered copy if the refresh fails.
      if (race && race.id === target) {
        if (draft) isDraftPreview = false;
        return;
      }
      try {
        const fallback = await getRace(target, fetch, true);
        if (id !== requestId) return;
        race = fallback;
        usingFallbackData = true;
      } catch {
        if (id !== requestId) return;
        race = null;
        if (isNotFoundError(err)) notFound = true;
        else
          error =
            err instanceof Error ? err.message : "Failed to load race data";
      }
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function toggleCandidateSelect(candidateName: string) {
    const s = candidateSlug(candidateName);
    if (selectedCandidates.has(s)) {
      selectedCandidates.delete(s);
    } else {
      selectedCandidates.add(s);
    }
    selectedCandidates = new Set(selectedCandidates);
  }

  function clearSelection() {
    selectedCandidates = new Set();
  }

  function toggleForecastExpanded() {
    forecastExpanded = !forecastExpanded;
  }

  $: activeCandidates = neutralCandidateOrder(
    race?.candidates?.filter((c) => !c.withdrawn),
  );
  $: withdrawnCandidates = neutralCandidateOrder(
    race?.candidates?.filter((c) => c.withdrawn),
  );
  $: compareAllHref = race
    ? `/races/${race.id}/compare/?candidates=${activeCandidates
        .map((candidate) => candidateSlug(candidate.name))
        .join(",")}${isDraftPreview ? "&draft=true" : ""}`
    : "";
  $: polls = sortPollsByDate(race?.polling);
  $: latestPoll = polls.length > 0 ? polls[0] : null;
  $: latestMatchup =
    latestPoll?.matchups?.find(
      (matchup) =>
        Array.isArray(matchup.candidates) && matchup.candidates.length > 0,
    ) ?? null;
  $: snapshotRows = latestMatchup ? orderedMatchupRows(latestMatchup) : [];
  $: discoveryOnly =
    activeCandidates.length > 0 &&
    activeCandidates.every(
      (c) =>
        !c.issues ||
        Object.keys(c.issues).length === 0 ||
        Object.values(c.issues).every((i) => !i?.stance?.trim()),
    );
  $: jsonLd = race && !notFound ? jsonLdScript(raceJsonLd(race)) : "";

  // Derive ballotpedia URL: race-level field first, then fall back to any candidate link
  $: ballotpediaUrl =
    race?.ballotpedia_url ??
    race?.candidates
      ?.flatMap((c) => c.links ?? [])
      .find((l) => l.type === "ballotpedia")?.url ??
    null;

  // Derive voter action URLs: race-level fields first, then fall back to vote.gov
  $: registerToVoteUrl =
    race?.register_to_vote_url ?? "https://vote.gov/register";
  $: howToVoteUrl = race?.how_to_vote_url ?? "https://vote.gov/";

  /** Colour bucket for a poll name: its party, or "unknown" when not on the roster. */
  function partyClassForName(name: string): string {
    const candidate = race?.candidates?.find((c) => c.name === name);
    return candidate ? partyKey(candidate.party) : "unknown";
  }

  function matchupPercentages(matchup: {
    percentages?: number[] | null;
  }): number[] {
    return Array.isArray(matchup.percentages) ? matchup.percentages : [];
  }

  function matchupHasPercentages(matchup: {
    percentages?: number[] | null;
  }): boolean {
    return matchupPercentages(matchup).some(
      (value) => typeof value === "number",
    );
  }

  function percentageAt(
    matchup: { percentages?: number[] | null },
    index: number,
  ): number | null {
    const value = matchupPercentages(matchup)[index];
    return typeof value === "number" ? value : null;
  }

  /** Matchup rows in the same neutral order the rest of the page uses. */
  function orderedMatchupRows(matchup: {
    candidates: string[];
    percentages?: number[] | null;
  }): { name: string; pct: number | null }[] {
    const rows = matchup.candidates.map((name, i) => ({
      name,
      pct: percentageAt(matchup, i),
      party: race?.candidates?.find((c) => c.name === name)?.party,
    }));
    return neutralCandidateOrder(rows).map(({ name, pct }) => ({ name, pct }));
  }

  function signedMargin(value?: number | null): string {
    if (typeof value !== "number") return "n/a";
    return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
  }

  function ratingLabel(rating: string | undefined): string {
    if (!rating) return "Unrated";
    return (
      formatRating(rating as Parameters<typeof formatRating>[0]) ??
      rating.replace(/_/g, " ")
    );
  }
</script>

<svelte:head>
  {#if notFound}
    <title>Race not found | Smarter.Vote</title>
    <meta name="robots" content="noindex" />
  {:else}
    <title>{racePageTitle(race)}</title>
    <meta name="description" content={raceMetaDescription(race)} />
    <link rel="canonical" href="https://smarter.vote/races/{slug}/" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="https://smarter.vote/races/{slug}/" />
    <meta property="og:title" content={racePageTitle(race)} />
    <meta property="og:description" content={raceMetaDescription(race)} />
    <meta property="og:image" content="https://smarter.vote/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="https://smarter.vote/races/{slug}/" />
    <meta name="twitter:title" content={racePageTitle(race)} />
    <meta name="twitter:description" content={raceMetaDescription(race)} />
    <meta name="twitter:image" content="https://smarter.vote/og-image.png" />
    {#if isDraftPreview}
      <meta name="robots" content="noindex" />
    {/if}
    {#if jsonLd}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html jsonLd}
    {/if}
  {/if}
</svelte:head>

<div class="container mx-auto px-4 py-6 sm:py-8 max-w-7xl">
  {#if loading}
    <div class="loading-wrapper">
      <div class="spinner"></div>
      <span class="loading-text">Loading race data...</span>
    </div>
  {:else if notFound}
    <div class="not-found-box">
      <h1 class="not-found-title">Race not found</h1>
      <p class="not-found-text">
        We couldn't find a published race at this address. It may have been
        renamed, retired after the election, or never published.
      </p>
      <div class="not-found-actions">
        <a href="/elections/" class="not-found-primary">Browse elections</a>
        <a href="/" class="not-found-secondary">Go to the homepage</a>
      </div>
    </div>
  {:else if error}
    <div class="error-box" role="alert">
      <h2 class="error-title">We couldn't load this race</h2>
      <p class="error-text">
        Something went wrong while loading the race data. Please check your
        connection and try again.
      </p>
      <button class="error-button" on:click={() => window.location.reload()}>
        Try again
      </button>
    </div>
  {:else if race}
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
    {#if discoveryOnly}
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
            This race has basic candidate information but detailed issue
            positions have not been researched yet. Want detailed data on this
            race? <a
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
    <!-- Race Header -->
    <Card tag="header" class="header-card">
      <div class="header-top">
        <h1 class="header-title">{raceDisplayTitle(race)}</h1>
        {#if race.validation_grade}
          <ValidationGradeBadge grade={race.validation_grade} />
        {/if}
      </div>
      <p class="mt-2 text-sm text-content-muted">
        Compare candidates’ positions, polling, and sourced race updates.
      </p>
      <div class="header-meta">
        <div class="info-row">
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span>Election: {formatElectionDate(race.election_date)}</span>
        </div>
        <div class="info-row">
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span
            >{race.office}{race.district ? ` · ${race.district}` : ""} &bull; {race.jurisdiction}</span
          >
        </div>
        <div class="info-row">
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span
            >Updated: {formatPollDate(race.updated_utc, {
              month: "long",
              day: "numeric",
              year: "numeric",
            }) || "date unavailable"}</span
          >
        </div>
      </div>
      {#if activeCandidates.length > 1}
        <a href={compareAllHref} class="header-compare-link">
          Compare all {activeCandidates.length} candidates
        </a>
      {/if}
    </Card>

    <!-- Election Countdown -->
    {#if race.election_date}
      <div class="mb-6 sm:mb-8">
        <ElectionCountdown electionDate={race.election_date} />
      </div>
    {/if}

    <!-- Voter Resources -->
    <VoterResources {ballotpediaUrl} {registerToVoteUrl} {howToVoteUrl} />

    <!-- Race Overview -->
    <Card class="overview-card">
      <div class="overview-layout">
        <!-- Left: description + candidate chips -->
        <div class="overview-main">
          {#if race.description}
            <p
              class="overview-description"
              class:overview-description-collapsed={!overviewExpanded}
            >
              {race.description}
            </p>
            {#if race.description.length > 320}
              <button
                type="button"
                class="overview-toggle"
                aria-expanded={overviewExpanded}
                on:click={() => (overviewExpanded = !overviewExpanded)}
              >
                {overviewExpanded ? "Show less overview" : "Read full overview"}
              </button>
            {/if}
          {/if}
          <div class="overview-candidates">
            {#each activeCandidates as candidate (candidateSlug(candidate.name))}
              <a
                href="/races/{race.id}/{candidateSlug(
                  candidate.name,
                )}/{isDraftPreview ? '?draft=true' : ''}"
                class="overview-candidate-chip"
              >
                {#if candidate.image_url && !hiddenChipImages[candidate.name]}
                  <img
                    src={candidate.image_url}
                    alt=""
                    width="20"
                    height="20"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    class="chip-avatar"
                    use:headshotFallback={() => hideChipImage(candidate.name)}
                  />
                {/if}
                <span class="chip-name">{candidate.name}</span>
                {#if candidate.party}
                  <span
                    class="chip-party chip-party-{partyKey(candidate.party)}"
                    title={candidate.party}>{partyAbbr(candidate.party)}</span
                  >
                {/if}
                {#if candidate.incumbent}
                  <span class="chip-incumbent">Incumbent</span>
                {/if}
              </a>
            {/each}
          </div>
        </div>

        <!-- Right: poll snapshot widget -->
        {#if latestPoll && latestMatchup}
          <a href="#polls" class="poll-snapshot">
            <div class="poll-snapshot-header">
              <svg
                class="w-4 h-4 text-blue-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span class="poll-snapshot-title">Latest Poll</span>
            </div>
            <p class="poll-snapshot-meta">
              {latestPoll.pollster}{formatPollDate(latestPoll.date)
                ? ` · ${formatPollDate(latestPoll.date, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}`
                : ""}
            </p>
            <div class="poll-snapshot-bars">
              {#each snapshotRows as row, rowIndex (`${row.name}|${rowIndex}`)}
                {@const name = row.name}
                {@const pct = row.pct}
                <div class="poll-snap-row">
                  <span class="poll-snap-name" title={name}
                    >{shortCandidateName(name, latestMatchup.candidates)}</span
                  >
                  <div class="poll-snap-bar-wrap">
                    <div
                      class="poll-snap-bar {partyClassForName(name)}"
                      style="width:{Math.min(pct ?? 0, 100)}%"
                    ></div>
                  </div>
                  <span class="poll-snap-pct"
                    >{pct !== null ? `${pct}%` : "n/a"}</span
                  >
                </div>
              {/each}
            </div>
            {#if polls.length > 1}
              <span class="poll-snapshot-more"
                >{polls.length} polls total — view all
                <UiIcon name="chevron-down" size="sm" /></span
              >
            {:else}
              <span class="poll-snapshot-more"
                >View detailed results
                <UiIcon name="chevron-down" size="sm" /></span
              >
            {/if}
          </a>
        {/if}
      </div>
    </Card>

    <!-- Fallback Data Notice -->
    {#if usingFallbackData}
      <div class="fallback-notice">
        <div class="fallback-content">
          <svg
            class="w-5 h-5 text-yellow-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div>
            <p class="fallback-title">Using Sample Data</p>
            <p class="fallback-text">
              Live data is currently unavailable. The information shown below is
              sample data for demonstration purposes.
            </p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Candidates Section -->
    <section id="candidates" class="scroll-mt-24">
      <div class="candidates-heading">
        <h2 class="candidates-title">Candidates</h2>
        {#if activeCandidates.length > 1}
          <a href={compareAllHref} class="compare-all-link">
            Compare all <span aria-hidden="true">&rarr;</span>
          </a>
        {/if}
      </div>
      {#if activeCandidates.length === 0}
        <div class="candidates-empty">
          <p class="candidates-empty-title">No active candidates listed yet</p>
          <p class="candidates-empty-text">
            {#if withdrawnCandidates.length > 0}
              Every candidate we tracked for this race has withdrawn or is not
              running. Check back after the filing deadline for an updated
              field.
            {:else}
              We haven't published a candidate field for this race yet. Check
              back closer to the filing deadline, or see your state's election
              office for the official list.
            {/if}
          </p>
        </div>
      {/if}
      <div class="candidate-grid">
        {#each activeCandidates as candidate (candidateSlug(candidate.name))}
          <CandidateCard
            {candidate}
            raceId={race.id}
            draft={isDraftPreview}
            selectable={activeCandidates.length > 1}
            selected={selectedCandidates.has(candidateSlug(candidate.name))}
            on:toggleSelect={() => toggleCandidateSelect(candidate.name)}
          />
        {/each}
      </div>
    </section>

    <!-- Withdrawn Candidates -->
    {#if withdrawnCandidates.length > 0}
      <section class="mt-4">
        <button
          class="flex items-center gap-2 text-sm text-content-muted hover:text-content transition-colors"
          on:click={() => (withdrawnExpanded = !withdrawnExpanded)}
          aria-expanded={withdrawnExpanded}
        >
          <svg
            class="w-4 h-4 transition-transform {withdrawnExpanded
              ? 'rotate-90'
              : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
          Withdrawn / Not Running ({withdrawnCandidates.length})
        </button>
        {#if withdrawnExpanded}
          <div
            transition:slide={{ duration: motionDuration(400) }}
            class="candidate-grid mt-3 opacity-60"
          >
            {#each withdrawnCandidates as candidate (candidateSlug(candidate.name))}
              <CandidateCard
                {candidate}
                raceId={race.id}
                draft={isDraftPreview}
              />
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <!-- Race Forecast -->
    {#if race.forecast}
      {@const forecast = race.forecast}
      {@const headline = forecastHeadline(forecast)}
      {@const segments = partyProbabilitySegments(forecast.party_probabilities)}
      <Card id="forecast" class="forecast-card scroll-mt-6">
        <div class="forecast-header">
          <div>
            <p class="forecast-eyebrow">Race Forecast</p>
            <h2 class="forecast-title">{headline.title}</h2>

            {#if headline.leader && typeof forecast.win_probability === "number"}
              <p class="forecast-summary">
                <strong>{headline.leader}:</strong>
                {probability(forecast.win_probability)} modeled win probability
                {#if typeof forecast.margin_estimate === "number"}
                  with a {signedMargin(forecast.margin_estimate)} estimated margin
                {/if}
              </p>
            {/if}
          </div>
          <div class="forecast-actions">
            <span class="forecast-rating {ratingClass(forecast.rating)}">
              {ratingLabel(forecast.rating)}
            </span>
          </div>
        </div>

        <div class="forecast-grid">
          <div class="forecast-metric">
            <span class="forecast-metric-label">Win Probability</span>
            <span class="forecast-metric-value"
              >{probability(forecast.win_probability)}</span
            >
          </div>
          <div class="forecast-metric">
            <span class="forecast-metric-label">Estimated Margin</span>
            <span class="forecast-metric-value"
              >{signedMargin(forecast.margin_estimate)}</span
            >
          </div>
          <div class="forecast-metric">
            <span class="forecast-metric-label">Polling Inputs</span>
            <span class="forecast-metric-value"
              >{forecast.based_on_poll_count} poll{forecast.based_on_poll_count ===
              1
                ? ""
                : "s"}</span
            >
          </div>
        </div>

        <!-- Toggle Button placed at bottom left of primary info -->
        <div class="mt-4">
          <button
            type="button"
            class="expand-button"
            aria-expanded={forecastExpanded}
            aria-controls={forecastExpanded ? "forecast-details" : undefined}
            on:click={toggleForecastExpanded}
          >
            <span class="expand-text">
              {forecastExpanded ? "Hide details" : "Show details"}
            </span>
            <svg
              class="expand-icon"
              class:expanded={forecastExpanded}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>

        <!-- Expanded Content - slide transitions for details -->
        {#if forecastExpanded}
          <div
            transition:slide={{ duration: motionDuration(400) }}
            class="expanded-content mt-6"
          >
            {#if segments.length > 0}
              <div
                class="forecast-probability-bar"
                role="img"
                aria-label={partyProbabilityAriaLabel(segments)}
              >
                {#each segments as segment (segment.party)}
                  <div
                    class="forecast-probability-segment forecast-probability-segment-{segment.key}"
                    style="flex: {segment.value} 1 0%"
                    title="{segment.party} {segment.label}"
                  >
                    {#if segment.value >= 0.15}
                      <span aria-hidden="true"
                        >{segment.party} {segment.label}</span
                      >
                    {:else}
                      <span class="sr-only"
                        >{segment.party} {segment.label}</span
                      >
                    {/if}
                  </div>
                {/each}
              </div>
              {#if segments.some((segment) => segment.value < 0.15)}
                <ul class="forecast-probability-legend">
                  {#each segments as segment (segment.party)}
                    <li>
                      <span
                        class="forecast-legend-swatch forecast-probability-segment-{segment.key}"
                        aria-hidden="true"
                      ></span>
                      {segment.party}
                      {segment.label}
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}

            <div class="forecast-body" id="forecast-details">
              <p class="forecast-takeaway font-semibold leading-relaxed mb-4">
                {forecast.takeaway || forecast.rationale}
              </p>
              {#if forecast.market_signals?.length}
                <div class="forecast-market-signals">
                  <div class="forecast-market-header">
                    <h3>Kalshi Market Signals</h3>
                    <span
                      >{forecast.market_signals.length} market{forecast
                        .market_signals.length === 1
                        ? ""
                        : "s"}</span
                    >
                  </div>
                  <div class="forecast-market-grid">
                    {#each forecast.market_signals as signal}
                      <div class="forecast-market-signal">
                        <div>
                          <span class="forecast-market-target"
                            >{marketSignalTarget(signal)}</span
                          >
                          <span class="forecast-market-title"
                            >{signal.title}</span
                          >
                        </div>
                        <div class="forecast-market-values">
                          <span class="forecast-market-probability">
                            {probabilityOneDecimal(signal.implied_probability)}
                          </span>
                          {#if marketSpread(signal)}
                            <span>{marketSpread(signal)}</span>
                          {/if}
                          <span class="capitalize"
                            >{signal.confidence} confidence</span
                          >
                          {#if marketAsOf(signal.as_of)}
                            <span>As of {marketAsOf(signal.as_of)}</span>
                          {/if}
                          {#if signal.url && isExternalUrl(signal.url)}
                            <a
                              href={signal.url}
                              target="_blank"
                              rel="noopener noreferrer">Kalshi</a
                            >
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if forecast.key_reasons?.length}
                <div class="forecast-detail-block">
                  <h3>Key Drivers</h3>
                  <ul>
                    {#each forecast.key_reasons as reason}
                      <li>{reason}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if forecast.uncertainty}
                <div class="forecast-detail-block">
                  <h3>Uncertainty</h3>
                  <p>{forecast.uncertainty}</p>
                </div>
              {/if}
              {#if forecast.rationale && forecast.takeaway}
                <div class="forecast-detail-block">
                  <h3>Model Rationale</h3>
                  <p>{forecast.rationale}</p>
                </div>
              {/if}
            </div>

            {#if forecast.source_urls?.length}
              <div class="forecast-sources">
                {#each forecast.source_urls as url}
                  {#if isExternalUrl(url)}
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {getHostname(url)}
                    </a>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <div class="forecast-meta">
          <span>Forecast confidence: {forecast.confidence}</span>
          {#if forecast.model}
            <span>Model: {formatModelName(forecast.model)}</span>
          {/if}
          {#if forecast.generated_at}
            <span
              >Generated: {formatPollDate(forecast.generated_at) ||
                "date unavailable"}</span
            >
          {/if}
        </div>
      </Card>
    {/if}

    <!-- Detailed Polls Section -->
    {#if polls.length > 0}
      <section id="polls" class="polls-section">
        <h2 class="section-heading">Polling</h2>
        <div class="polls-grid">
          {#each polls as poll, pollIndex (`${poll.pollster}|${poll.date ?? ""}|${pollIndex}`)}
            <div class="poll-card">
              <div class="poll-card-header">
                <div>
                  <span class="poll-card-pollster">{poll.pollster}</span>
                  {#if formatPollDate(poll.date)}
                    <span class="poll-card-date"
                      >{formatPollDate(poll.date)}</span
                    >
                  {/if}
                </div>
                {#if poll.sample_size}
                  <span class="poll-card-sample"
                    >n={poll.sample_size.toLocaleString()}</span
                  >
                {/if}
              </div>

              {#each poll.matchups ?? [] as matchup, mi}
                {#if mi > 0}<div class="poll-matchup-divider"></div>{/if}
                <div class="poll-matchup">
                  {#each orderedMatchupRows(matchup) as row, rowIndex (`${row.name}|${rowIndex}`)}
                    {@const pc = partyClassForName(row.name)}
                    {@const pct = row.pct}
                    <div class="poll-bar-row">
                      <span class="poll-bar-name" title={row.name}
                        >{row.name}</span
                      >
                      <div class="poll-bar-track" aria-hidden="true">
                        {#if pct !== null}
                          <div
                            class="poll-bar-fill {pc}"
                            style="width:{Math.min(Math.max(pct, 0), 100)}%"
                          ></div>
                        {/if}
                      </div>
                      <span
                        class="poll-bar-label"
                        class:poll-bar-label--missing={pct === null}
                        >{pct !== null ? `${pct}%` : "n/a"}</span
                      >
                    </div>
                  {/each}
                  {#if !matchupHasPercentages(matchup)}
                    <p class="poll-missing-note">
                      Candidate matchup reported without percentage values.
                    </p>
                  {/if}
                </div>
              {/each}

              {#if isExternalUrl(poll.source_url)}
                <a
                  href={poll.source_url.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="poll-card-source"
                >
                  <svg
                    class="w-3 h-3"
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
                  Source
                </a>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Data Note -->
    <div class="data-note">
      <p class="data-note-title">
        {usingFallbackData ? "Sample Data Information" : "About this research"}
      </p>
      <p class="data-note-text">
        {#if usingFallbackData}
          This is sample data for demonstration purposes. The actual race data
          is currently unavailable.
        {:else}
          Data compiled from public sources and analyzed using AI. Last updated {formatPollDate(
            race.updated_utc,
            {
              month: "long",
              day: "numeric",
              year: "numeric",
            },
          ) || "recently"}. Visit candidate websites for the most current
          information.
        {/if}
      </p>
    </div>

    <!-- Automated review details (bottom) -->
    <ReviewPanel reviews={race.reviews ?? []} />

    <!-- Models used to generate this race -->
    {#if race.generator && race.generator.length > 0}
      <div class="model-label">
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
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        <span>Models:</span>
        {#each race.generator as model}
          <span class="model-tag">{formatModelName(model)}</span>
        {/each}
      </div>
    {/if}

    <!-- Back to Top -->
    <div class="back-to-top">
      <button
        class="back-to-top-link"
        on:click={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
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
            d="M5 10l7-7m0 0l7 7m-7-7v18"
          />
        </svg>
        Back to top
      </button>
    </div>

    <!-- Compare sticky drawer -->
    {#if selectedCandidates.size > 0}
      <div
        transition:fade={{ duration: motionDuration(200) }}
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface/95 backdrop-blur-md border border-stroke py-4 px-6 shadow-2xl rounded-2xl flex items-center justify-between gap-6 max-w-md w-[calc(100%-2rem)] transition-all duration-300"
      >
        <div class="flex items-center gap-3">
          <span
            class="inline-flex items-center justify-center bg-blue-600 text-white font-bold rounded-full w-6 h-6 text-xs"
            >{selectedCandidates.size}</span
          >
          <span class="text-sm font-semibold text-content"
            >Selected to compare</span
          >
        </div>
        <div class="flex items-center gap-3">
          <button
            on:click={clearSelection}
            class="text-xs text-content-muted hover:text-content font-medium transition-colors"
            >Clear</button
          >
          {#if selectedCandidates.size >= 2}
            <a
              href="/races/{race.id}/compare/?candidates={[
                ...selectedCandidates,
              ].join(',')}{isDraftPreview ? '&draft=true' : ''}"
              class="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors no-underline shadow-sm"
            >
              Compare Now &rarr;
            </a>
          {:else}
            <span class="text-xs text-content-subtle">Select one more</span>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style lang="postcss">
  /* Scoped `dark:` variants inside <style> never match: Svelte scopes the
     `.dark` ancestor to this component. Dark overrides use :global(.dark). */
  .loading-wrapper {
    @apply flex items-center justify-center py-20;
  }

  .spinner {
    @apply animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600;
  }

  .loading-text {
    @apply ml-3 text-lg text-content-muted;
  }

  .error-box {
    @apply bg-red-50 border border-red-200 rounded-lg p-6 text-center;
  }

  :global(.dark) .error-box {
    @apply bg-red-950/30 border-red-800;
  }

  .error-title {
    @apply text-2xl font-bold text-red-800 mb-2;
  }

  :global(.dark) .error-title {
    @apply text-red-200;
  }

  .error-text {
    @apply text-red-700;
  }

  :global(.dark) .error-text {
    @apply text-red-200;
  }

  .error-button {
    @apply mt-4 bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 transition-colors;
  }

  .not-found-box {
    @apply mx-auto max-w-2xl rounded-2xl border border-stroke bg-surface p-6 text-center shadow-sm sm:p-10;
  }

  .not-found-title {
    @apply text-2xl font-bold text-content sm:text-3xl;
  }

  .not-found-text {
    @apply mt-3 text-sm leading-relaxed text-content-muted sm:text-base;
  }

  .not-found-actions {
    @apply mt-6 flex flex-wrap items-center justify-center gap-3;
  }

  .not-found-primary {
    @apply inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white no-underline hover:bg-blue-800;
  }

  .not-found-secondary {
    @apply inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 no-underline hover:underline;
  }

  :global(.dark) .not-found-secondary {
    @apply text-blue-400;
  }

  :global(.header-card) {
    @apply p-4 sm:p-6 mb-6 sm:mb-8 shadow-sm;
  }

  .header-title {
    @apply text-2xl sm:text-3xl lg:text-4xl font-bold text-content capitalize;
  }

  .header-top {
    @apply flex flex-wrap items-start sm:items-center justify-between gap-3 mb-4;
  }

  .header-meta {
    @apply flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3 sm:gap-6 text-content-muted;
  }

  .header-compare-link {
    @apply mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600;
  }

  .info-row {
    @apply flex items-center gap-2;
  }

  /* Voter Resources styled within component */

  .model-label {
    @apply mt-2 mb-4 flex flex-wrap items-center gap-2 text-sm text-content-subtle;
  }

  .model-tag {
    @apply bg-surface-alt px-2 py-1 rounded text-xs font-mono;
  }

  .candidates-title {
    @apply text-xl sm:text-2xl font-semibold text-content mb-4 sm:mb-6;
  }

  /* Race Overview */
  :global(.overview-card) {
    @apply p-4 sm:p-6 mb-6 sm:mb-8 shadow-sm;
  }

  .overview-layout {
    @apply flex flex-col lg:flex-row gap-6;
  }

  .overview-main {
    @apply flex-1 min-w-0;
  }

  .overview-description {
    @apply text-content-muted text-sm sm:text-base leading-relaxed mb-4;
  }

  .overview-toggle {
    @apply mb-4 inline-flex min-h-11 items-center text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline sm:hidden;
  }

  :global(.dark) .overview-toggle {
    @apply text-blue-400 hover:text-blue-300;
  }

  @media (max-width: 639px) {
    .overview-description-collapsed {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 6;
    }
  }

  .overview-candidates {
    @apply flex flex-wrap gap-2;
  }

  .overview-candidate-chip {
    @apply flex min-h-11 items-center gap-1.5 px-3 py-1.5 bg-surface border border-stroke rounded-full hover:border-blue-300 hover:bg-blue-50 transition-colors duration-200 text-sm no-underline text-content-muted;
  }

  :global(.dark) .overview-candidate-chip {
    @apply hover:bg-blue-950/30;
  }

  .chip-avatar {
    @apply w-5 h-5 rounded-full object-cover;
  }

  .chip-name {
    @apply font-medium text-content text-sm;
  }

  .chip-party {
    @apply text-xs font-semibold;
  }
  .chip-party-dem {
    @apply text-blue-700;
  }

  :global(.dark) .chip-party-dem {
    @apply text-blue-300;
  }
  .chip-party-rep {
    @apply text-red-700;
  }

  :global(.dark) .chip-party-rep {
    @apply text-red-300;
  }
  .chip-party-ind {
    @apply text-purple-700;
  }

  :global(.dark) .chip-party-ind {
    @apply text-purple-300;
  }
  .chip-party-grn {
    @apply text-emerald-700;
  }

  :global(.dark) .chip-party-grn {
    @apply text-emerald-300;
  }
  .chip-party-lib {
    @apply text-amber-800;
  }

  :global(.dark) .chip-party-lib {
    @apply text-amber-300;
  }
  .chip-party-other {
    @apply text-content-muted;
  }

  .chip-incumbent {
    @apply bg-green-100 text-green-700 text-xs px-1.5 py-0.5 rounded-full;
  }

  :global(.dark) .chip-incumbent {
    @apply bg-green-900 text-green-300;
  }

  /* Poll Snapshot Widget */
  .poll-snapshot {
    @apply flex flex-col gap-2 p-4 bg-page border border-stroke rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors no-underline lg:w-64 lg:shrink-0 cursor-pointer;
  }

  :global(.dark) /* Poll Snapshot Widget */
  .poll-snapshot {
    @apply hover:border-blue-700 hover:bg-blue-950/30;
  }

  .poll-snapshot-header {
    @apply flex items-center gap-1.5;
  }

  .poll-snapshot-title {
    @apply text-sm font-semibold text-content;
  }

  .poll-snapshot-meta {
    @apply text-xs text-content-subtle;
  }

  .poll-snapshot-bars {
    @apply space-y-1.5 my-1;
  }

  .poll-snap-row {
    @apply flex items-center gap-2;
  }

  .poll-snap-name {
    @apply text-xs font-medium text-content-muted w-16 shrink-0 truncate;
  }

  .poll-snap-bar-wrap {
    @apply flex-1 bg-surface-alt rounded-full h-2 overflow-hidden;
  }

  .poll-snap-bar {
    @apply h-full rounded-full bg-slate-500;
  }

  .poll-snap-pct {
    @apply text-xs font-bold text-content-muted w-8 text-right shrink-0;
  }

  .poll-snapshot-more {
    @apply text-xs text-blue-700 font-medium mt-1;
  }

  :global(.dark) .poll-snapshot-more {
    @apply text-blue-400;
  }

  /* Party fills shared by the snapshot and detailed poll bars. Third parties
     get their own colours; "unknown" (a name not on the roster) is neutral
     slate, and a missing value draws no bar at all. */
  .poll-snap-bar.dem,
  .poll-bar-fill.dem {
    @apply bg-blue-600;
  }
  .poll-snap-bar.rep,
  .poll-bar-fill.rep {
    @apply bg-red-600;
  }
  .poll-snap-bar.ind,
  .poll-bar-fill.ind {
    @apply bg-purple-600;
  }
  .poll-snap-bar.grn,
  .poll-bar-fill.grn {
    @apply bg-emerald-600;
  }
  .poll-snap-bar.lib,
  .poll-bar-fill.lib {
    @apply bg-amber-500;
  }
  .poll-snap-bar.other,
  .poll-bar-fill.other {
    @apply bg-teal-600;
  }

  /* Forecast */
  :global(.forecast-card) {
    @apply mt-10 sm:mt-12 p-4 sm:p-5 mb-6 sm:mb-7 shadow-sm;
  }

  .forecast-header {
    @apply flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3;
  }

  .forecast-eyebrow {
    @apply text-xs font-bold uppercase tracking-wide text-content-subtle mb-1;
  }

  .forecast-title {
    @apply text-lg sm:text-xl font-semibold text-content;
  }

  .forecast-summary {
    @apply mt-1 text-sm leading-snug text-content-muted;
  }

  .forecast-actions {
    @apply flex shrink-0 items-center gap-2 sm:flex-col sm:items-end;
  }

  .forecast-rating {
    @apply inline-flex self-start rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide;
  }

  .expand-button {
    @apply flex min-h-11 items-center gap-2 text-blue-600 font-medium;
    @apply transition-colors duration-200;
  }

  :global(.dark) .expand-button {
    @apply text-blue-400;
  }

  .expand-button:hover {
    @apply text-blue-500;
  }

  :global(.dark) .expand-button:hover {
    @apply text-blue-300;
  }

  .expand-text {
    @apply text-xs sm:text-sm font-medium;
  }

  .expand-icon {
    @apply w-4 h-4 transition-transform duration-200;
  }

  .expand-icon.expanded {
    @apply rotate-180;
  }

  .expanded-content {
    @apply border-t border-stroke pt-4 sm:pt-6;
  }

  .forecast-grid {
    @apply grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-3;
  }

  .forecast-metric {
    @apply rounded-lg border border-stroke bg-page px-3 py-2.5;
  }

  .forecast-metric-label {
    @apply block text-xs font-semibold uppercase tracking-wide text-content-subtle;
  }

  .forecast-metric-value {
    @apply mt-0.5 block text-base font-bold text-content;
  }

  .forecast-probability-bar {
    @apply mb-4 flex h-8 overflow-hidden rounded-xl border border-stroke bg-surface-alt;
  }

  .forecast-probability-segment {
    @apply flex min-w-[4px] items-center justify-center overflow-hidden whitespace-nowrap px-1 text-xs font-bold text-white transition-all duration-300;
  }
  /* 600/700 shades keep white labels at >= 4.5:1. */
  .forecast-probability-segment-dem {
    @apply bg-blue-700;
  }
  .forecast-probability-segment-rep {
    @apply bg-red-700;
  }
  .forecast-probability-segment-ind {
    @apply bg-purple-700;
  }
  .forecast-probability-segment-grn {
    @apply bg-emerald-700;
  }
  .forecast-probability-segment-lib {
    @apply bg-amber-700;
  }
  .forecast-probability-segment-other {
    @apply bg-slate-600;
  }

  .forecast-probability-legend {
    @apply -mt-2 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-content-muted;
  }

  .forecast-probability-legend li {
    @apply inline-flex items-center gap-1.5;
  }

  .forecast-legend-swatch {
    @apply inline-block h-2.5 w-2.5 rounded-sm;
  }

  .forecast-body {
    @apply space-y-4;
  }

  .forecast-takeaway {
    @apply text-sm sm:text-base font-medium leading-relaxed text-content;
  }

  .forecast-detail-block {
    @apply rounded-xl border border-stroke bg-page p-4;
  }

  .forecast-detail-block h3 {
    @apply mb-2 text-xs font-bold uppercase tracking-wide text-content-subtle;
  }

  .forecast-detail-block p,
  .forecast-detail-block li {
    @apply text-sm leading-relaxed text-content-muted;
  }

  .forecast-detail-block ul {
    @apply list-disc space-y-1 pl-5;
  }

  .forecast-market-signals {
    @apply rounded-xl border border-stroke bg-page p-4;
  }

  .forecast-market-header {
    @apply mb-3 flex flex-wrap items-center justify-between gap-2;
  }

  .forecast-market-header h3 {
    @apply text-xs font-bold uppercase tracking-wide text-content-subtle;
  }

  .forecast-market-header span {
    @apply text-xs font-semibold text-content-subtle;
  }

  .forecast-market-grid {
    @apply grid gap-2;
  }

  .forecast-market-signal {
    @apply flex flex-col gap-2 rounded-lg border border-stroke/70 bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between;
  }

  .forecast-market-target {
    @apply block text-sm font-semibold text-content;
  }

  .forecast-market-title {
    @apply block text-xs leading-snug text-content-subtle;
  }

  .forecast-market-values {
    @apply flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-subtle sm:justify-end;
  }

  .forecast-market-probability {
    @apply font-bold text-content;
  }

  .forecast-market-values a {
    @apply font-semibold text-blue-600 hover:underline;
  }

  :global(.dark) .forecast-market-values a {
    @apply text-blue-400;
  }

  .forecast-meta {
    @apply mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-stroke pt-3 text-xs text-content-subtle;
  }

  .forecast-sources {
    @apply mt-3 flex flex-wrap gap-2;
  }

  .forecast-sources a {
    @apply rounded-full border border-stroke bg-page px-3 py-1 text-xs font-medium text-blue-700 hover:border-blue-300 hover:bg-blue-50;
  }

  :global(.dark) .forecast-sources a {
    @apply text-blue-400 hover:border-blue-700 hover:bg-blue-950/30;
  }

  /* Candidates */
  .candidates-heading {
    @apply mb-4 flex items-center justify-between gap-4 sm:mb-6;
  }

  .candidates-title {
    @apply text-xl font-semibold text-content sm:text-2xl;
  }

  .compare-all-link {
    @apply inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-sm font-semibold text-blue-600 no-underline transition-colors hover:text-blue-800 hover:underline;
  }

  :global(.dark) .compare-all-link {
    @apply text-blue-400 hover:text-blue-300;
  }

  .candidates-empty {
    @apply mb-6 rounded-xl border border-dashed border-stroke bg-surface p-6 text-center;
  }

  .candidates-empty-title {
    @apply text-base font-semibold text-content;
  }

  .candidates-empty-text {
    @apply mt-1 text-sm text-content-muted;
  }

  .candidate-grid {
    @apply grid gap-6 sm:gap-8 justify-items-stretch;
  }

  /* Detailed Polls Section */
  .polls-section {
    @apply mt-10 mb-8;
  }

  .section-heading {
    @apply text-xl sm:text-2xl font-semibold text-content mb-4 sm:mb-6;
  }

  .polls-grid {
    @apply grid gap-4 sm:grid-cols-2 lg:grid-cols-3;
  }

  .poll-card {
    @apply bg-surface border border-stroke rounded-xl p-4 shadow-sm flex flex-col gap-3;
  }

  .poll-card-header {
    @apply flex items-start justify-between gap-2;
  }

  .poll-card-pollster {
    @apply text-sm font-semibold text-content block;
  }

  .poll-card-date {
    @apply text-xs text-content-subtle block mt-0.5;
  }

  .poll-card-sample {
    @apply text-xs text-content-subtle shrink-0;
  }

  .poll-matchup-divider {
    @apply border-t border-dashed border-stroke;
  }

  .poll-matchup {
    @apply space-y-2;
  }

  .poll-bar-row {
    @apply flex items-center gap-2;
  }

  .poll-bar-name {
    @apply text-xs font-medium text-content-muted w-28 shrink-0 truncate;
  }

  .poll-bar-track {
    @apply flex-1 bg-surface-alt rounded-full h-3 overflow-hidden;
  }

  .poll-bar-fill {
    @apply h-full rounded-full bg-slate-500 transition-all duration-300;
  }

  /* Labels sit outside the bar in body text colour so they stay readable on
     any fill (white on a 500-shade fill failed contrast). */
  .poll-bar-label {
    @apply w-10 shrink-0 text-right text-xs font-bold tabular-nums text-content;
  }

  .poll-bar-label--missing {
    @apply font-medium italic text-content-muted;
  }

  .poll-missing-note {
    @apply text-xs text-content-muted italic;
  }

  .poll-card-source {
    @apply inline-flex min-h-6 items-center gap-1 py-1 text-xs text-blue-700 hover:underline mt-auto;
  }

  :global(.dark) .poll-card-source {
    @apply text-blue-400;
  }

  /* Misc */
  .data-note {
    @apply mt-8 sm:mt-10 bg-blue-50 border border-blue-200 rounded-lg p-4 sm:p-6 text-center;
  }

  :global(.dark) /* Misc */
  .data-note {
    @apply bg-blue-950/30 border-blue-800;
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

  .fallback-notice {
    @apply bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4 mb-6 sm:mb-8;
  }

  :global(.dark) .fallback-notice {
    @apply bg-yellow-950/30 border-yellow-800;
  }

  .fallback-content {
    @apply flex items-start gap-2 sm:gap-3;
  }

  .fallback-title {
    @apply font-medium text-yellow-800 text-sm sm:text-base;
  }

  :global(.dark) .fallback-title {
    @apply text-yellow-200;
  }

  .fallback-text {
    @apply text-yellow-700 text-xs sm:text-sm mt-1;
  }

  :global(.dark) .fallback-text {
    @apply text-yellow-300;
  }

  .back-to-top {
    @apply mt-8 text-center;
  }

  .back-to-top-link {
    @apply inline-flex items-center gap-2 text-content-muted hover:text-blue-700 font-medium transition-colors duration-200 border-none bg-transparent cursor-pointer;
  }

  :global(.dark) .back-to-top-link {
    @apply hover:text-blue-400;
  }
</style>
