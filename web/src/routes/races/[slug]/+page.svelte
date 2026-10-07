<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import CandidateCard from "$lib/components/CandidateCard.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import ReviewPanel from "$lib/components/ReviewPanel.svelte";
  import SupportNote from "$lib/components/support/SupportNote.svelte";
  import ValidationGradeBadge from "$lib/components/ValidationGradeBadge.svelte";
  import Card from "$lib/components/Card.svelte";
  import ElectionCountdown from "$lib/components/ElectionCountdown.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { fade, slide } from "svelte/transition";
  import VoterResources from "$lib/components/VoterResources.svelte";
  import type { Race } from "$lib/types";
  import { getRace, getDraftRace } from "$lib/api";
  import { formatModelName, candidateSlug } from "$lib/utils/format";
  import { partyAbbr, partyKey } from "$lib/utils/party";
  import { isExternalUrl } from "$lib/utils/url";
  import { formatRating } from "$lib/utils/forecast";
  import {
    marketAsOf,
    marketSignalTarget,
    marketSpread,
    probabilityOneDecimal,
    ratingClass,
  } from "$lib/utils/forecastPresentation";
  import {
    hasNoResearchedPositions,
    neutralCandidateOrder,
    shortCandidateName,
    uniqueCandidatesByName,
  } from "$lib/utils/candidates";
  import { motionDuration, scrollBehavior } from "$lib/utils/motion";
  import {
    cleanDisplayText,
    contestStageNotice,
    forecastHeadline,
    formatPollDate,
    formatWinProbability,
    pollDateLabel,
    isNotFoundError,
    isPreviousCyclePoll,
    isUncontestedRace,
    jsonLdScript,
    pollAgeLabel,
    partyProbabilityAriaLabel,
    partyProbabilitySegments,
    raceJsonLd,
    raceLocationLabel,
    sortPollsByDate,
    sourceHostname,
    splitSourcedText,
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

  /** Poll cards shown before "Show all polls"; a full grid buried the page. */
  const POLL_PREVIEW_COUNT = 6;

  let selectedCandidates: Set<string> = new Set();
  let forecastExpanded = false;
  let overviewExpanded = false;
  let withdrawnExpanded = false;
  let pollsExpanded = false;

  let slug: string;
  $: slug = $page.params.slug as string;

  let mounted = false;
  let loadedKey: string | null = null;
  let requestId = 0;
  /** Race whose draft fetch failed: its `?draft=true` is ignored from then on. */
  let draftRejectedSlug: string | null = null;

  // A rejected draft must stay rejected even while the URL still says
  // `?draft=true` — otherwise the guard below refetches the draft forever.
  $: draftParam =
    mounted &&
    browser &&
    $page.url.searchParams.get("draft") === "true" &&
    draftRejectedSlug !== slug;
  // Client-side navigation between races reuses this component, so the race
  // (and every bit of per-race UI state) must follow the URL, not mount time.
  $: if (mounted && `${slug}|${draftParam}` !== loadedKey)
    loadRace(slug, draftParam);

  // Client-side navigation within the same race (another candidate, say)
  // brings new embedded data; follow it unless a draft is being previewed.
  $: if (
    mounted &&
    !draftParam &&
    data.prerenderedRace &&
    data.prerenderedRace.id === slug &&
    race !== data.prerenderedRace
  )
    race = data.prerenderedRace;

  onMount(() => {
    mounted = true;
    window.addEventListener("hashchange", focusHashTarget);
    // A shared link straight to a section gets the same focus treatment.
    requestAnimationFrame(focusHashTarget);
    return () => window.removeEventListener("hashchange", focusHashTarget);
  });

  function resetRaceState() {
    selectedCandidates = new Set();
    forecastExpanded = false;
    overviewExpanded = false;
    withdrawnExpanded = false;
    pollsExpanded = false;
  }

  /**
   * Move focus to an in-page anchor target (#forecast, #polls, #candidates)
   * so keyboard and screen-reader users land where the link pointed. The
   * targets carry tabindex="-1"; scrolling is left to the browser.
   */
  function focusHashTarget() {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (target?.getAttribute("tabindex") === "-1")
      target.focus({ preventScroll: true });
  }

  /** Drop the rejected `?draft=true` from the address bar (a real navigation, so `$page.url` agrees). */
  function dropDraftParam(target: string) {
    const params = new URLSearchParams($page.url.searchParams);
    params.delete("draft");
    const query = params.toString();
    goto(`/races/${target}/${query ? `?${query}` : ""}${$page.url.hash}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    }).catch(() => undefined);
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
    // The build embedded this race: nothing to refetch (drafts always fetch).
    if (!draft && prerendered) {
      race = prerendered;
      usingFallbackData = false;
      loading = false;
      return;
    }
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
          draftRejectedSlug = target;
          dropDraftParam(target);
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

  // Exact-duplicate roster entries are dropped so each candidate renders once.
  $: roster = uniqueCandidatesByName(race?.candidates);
  $: activeCandidates = neutralCandidateOrder(
    roster.filter((c) => !c.withdrawn),
  );
  $: withdrawnCandidates = neutralCandidateOrder(
    roster.filter((c) => c.withdrawn),
  );
  $: compareAllHref = race
    ? `/races/${race.id}/compare/?candidates=${activeCandidates
        .map((candidate) => candidateSlug(candidate.name))
        .join(",")}${isDraftPreview ? "&draft=true" : ""}`
    : "";
  $: polls = sortPollsByDate(race?.polling);
  $: visiblePolls =
    pollsExpanded || polls.length <= POLL_PREVIEW_COUNT
      ? polls
      : polls.slice(0, POLL_PREVIEW_COUNT);
  $: overview = splitSourcedText(race?.description);
  $: locationLabel = race ? raceLocationLabel(race) : "";
  // The desktop sidebar spans every main-column block so it can stay sticky.
  $: asideRowSpan =
    (overview.paragraphs.length > 0 ? 1 : 0) +
    1 +
    (withdrawnCandidates.length > 0 ? 1 : 0);
  // A poll from an earlier campaign is never this race's "latest poll".
  $: latestPoll =
    polls.find(
      (poll) => !isPreviousCyclePoll(poll.date, race?.election_date),
    ) ?? null;
  $: stageNotice = race ? contestStageNotice(race, activeCandidates) : null;
  // An uncontested race has no contest to forecast: no favorite, no odds.
  $: uncontested = race
    ? isUncontestedRace(race, activeCandidates.length)
    : false;
  $: showForecast = !!race?.forecast && !uncontested;
  $: noPollInputs = race?.forecast?.based_on_poll_count === 0;
  // Every model that produced this page, shown with the review details.
  $: researchModels = [
    ...new Set(
      [...(race?.generator ?? []), race?.forecast?.model]
        .filter((model): model is string => !!model)
        .map((model) => formatModelName(model)),
    ),
  ];
  $: latestMatchup =
    latestPoll?.matchups?.find(
      (matchup) =>
        Array.isArray(matchup.candidates) && matchup.candidates.length > 0,
    ) ?? null;
  $: snapshotRows = latestMatchup ? orderedMatchupRows(latestMatchup) : [];
  // Candidates with only "no public position found" markers count as having
  // no researched positions.
  $: discoveryOnly =
    activeCandidates.length > 0 &&
    activeCandidates.every(hasNoResearchedPositions);
  $: jsonLd = race && !notFound ? jsonLdScript(raceJsonLd(race)) : "";

  // Derive ballotpedia URL: race-level field first, then fall back to any
  // candidate link. Only http(s) URLs qualify.
  $: ballotpediaUrl =
    [
      race?.ballotpedia_url,
      ...(race?.candidates ?? [])
        .flatMap((c) => c.links ?? [])
        .filter((l) => l.type === "ballotpedia")
        .map((l) => l.url),
    ].find((url) => isExternalUrl(url)) ?? null;

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
    const rows = matchup.candidates.map((name, i) => {
      const listed = race?.candidates?.find((c) => c.name === name);
      return {
        name,
        pct: percentageAt(matchup, i),
        party: listed?.party,
        incumbent: listed?.incumbent,
      };
    });
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

<div class="page-container py-6 sm:py-8">
  {#if loading}
    <div class="loading-wrapper">
      <div class="spinner"></div>
      <span class="loading-text">Loading race data...</span>
    </div>
  {:else if notFound}
    <EmptyState
      title="Race not found"
      body="We couldn't find a published race at this address. It may have been renamed, retired after the election, or never published."
    />
  {:else if error}
    <div class="alert-error mx-auto max-w-xl p-6 text-center" role="alert">
      <h1 class="text-xl font-semibold">We couldn't load this race</h1>
      <p class="mt-2">
        Something went wrong while loading the race data. Please check your
        connection and try again.
      </p>
      <button
        type="button"
        class="btn-secondary mt-4"
        on:click={() => window.location.reload()}
      >
        Try again
      </button>
    </div>
  {:else if race}
    {#if isDraftPreview}
      <div class="alert-warn mb-4 flex items-center gap-2">
        <svg
          class="h-5 w-5 shrink-0"
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
    {#if usingFallbackData}
      <div class="alert-warn mb-4">
        <p class="font-semibold">Using Sample Data</p>
        <p class="mt-1">
          Live data is currently unavailable. The information shown below is
          sample data for demonstration purposes.
        </p>
      </div>
    {/if}
    {#if discoveryOnly}
      <div class="alert-info mb-4 flex items-start gap-3">
        <svg
          class="mt-0.5 h-5 w-5 shrink-0 text-primary"
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
            This race has basic candidate information but detailed issue
            positions have not been researched yet. Want detailed data on this
            race? <a
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

    <!-- Race Header -->
    <Card tag="header" class="race-header">
      <div class="header-top">
        <h1 class="h-page min-w-0">{raceDisplayTitle(race)}</h1>
        {#if race.validation_grade}
          <ValidationGradeBadge
            grade={race.validation_grade}
            reviews={race.reviews ?? []}
          />
        {/if}
      </div>
      <p class="mt-2 text-sm text-content-muted sm:text-base">
        Compare candidates’ positions, polling, and sourced race updates.
      </p>
      {#if stageNotice}
        <div
          class="alert-info stage-notice"
          role="note"
          data-stage={stageNotice.kind}
        >
          <p class="font-semibold text-content">{stageNotice.title}</p>
          <p class="mt-1">{stageNotice.body}</p>
        </div>
      {/if}
      <div class="header-meta">
        {#if locationLabel}
          <span class="info-row">
            <svg
              class="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
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
            <span>{locationLabel}</span>
          </span>
        {/if}
        <span class="info-row">
          <svg
            class="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span
            >Updated {formatPollDate(race.updated_utc, {
              month: "long",
              day: "numeric",
              year: "numeric",
            }) || "date unavailable"}</span
          >
        </span>
      </div>
      {#if race.election_date || activeCandidates.length > 1}
        <div class="header-actions">
          {#if race.election_date}
            <div class="min-w-0 sm:flex-1">
              <ElectionCountdown electionDate={race.election_date} />
            </div>
          {/if}
          {#if activeCandidates.length > 1}
            <a href={compareAllHref} class="btn-primary shrink-0">
              {activeCandidates.length === 2
                ? "Compare both candidates"
                : `Compare all ${activeCandidates.length} candidates`}
            </a>
          {/if}
        </div>
      {/if}
    </Card>

    <div class="race-layout">
      <!-- Race Overview -->
      {#if overview.paragraphs.length > 0}
        <section
          class="race-main card overview-card"
          aria-label="Race overview"
        >
          <h2 class="h-card">About this race</h2>
          <div class="overview-text">
            {#each overview.paragraphs as paragraph, index}
              <p class:overview-extra={index > 0 && !overviewExpanded}>
                {paragraph}
              </p>
            {/each}
          </div>
          {#if overview.paragraphs.length > 1}
            <div class="sm:hidden">
              <button
                type="button"
                class="link-button"
                aria-expanded={overviewExpanded}
                on:click={() => (overviewExpanded = !overviewExpanded)}
              >
                {overviewExpanded ? "Show less overview" : "Read full overview"}
                <span
                  class="inline-flex transition-transform duration-200"
                  class:rotate-180={overviewExpanded}
                  ><UiIcon name="chevron-down" size="sm" /></span
                >
              </button>
            </div>
          {/if}
          {#if overview.sources.length > 0}
            <div class="overview-sources">
              <span class="overview-sources-label">Sources</span>
              {#each overview.sources as source (source.url)}
                {#if isExternalUrl(source.url)}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="source-chip"
                    title={source.url}
                  >
                    {source.label}
                    <UiIcon name="external" size="sm" />
                  </a>
                {/if}
              {/each}
            </div>
          {/if}
          {#if activeCandidates.length > 0}
            <div
              class="overview-candidates"
              role="group"
              aria-label="Candidates in this race"
            >
              {#each activeCandidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
                <a
                  href="/races/{race.id}/{candidateSlug(
                    candidate.name,
                  )}/{isDraftPreview ? '?draft=true' : ''}"
                  class="overview-candidate-chip"
                >
                  <CandidateAvatar
                    name={candidate.name}
                    imageUrl={candidate.image_url}
                    size={20}
                    loading="eager"
                  />
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
          {/if}
        </section>
      {/if}

      <!-- At a glance: forecast + latest poll + voting resources. A sticky
           sidebar on desktop; right after the overview on smaller screens. -->
      <aside
        class="race-aside"
        class:has-glance={showForecast || !!(latestPoll && latestMatchup)}
        aria-label="Race at a glance"
        style="--aside-rows: {asideRowSpan}"
      >
        {#if showForecast || (latestPoll && latestMatchup)}
          <div class="card glance-card">
            <p class="eyebrow">At a glance</p>
            {#if showForecast && race.forecast}
              {@const glance = forecastHeadline(race.forecast)}
              <div class="glance-block">
                <div class="flex items-start justify-between gap-3">
                  <p class="glance-title">{glance.title}</p>
                  <span
                    class="forecast-rating shrink-0 {ratingClass(
                      race.forecast.rating,
                    )}">{ratingLabel(race.forecast.rating)}</span
                  >
                </div>
                {#if glance.leader && typeof race.forecast.win_probability === "number"}
                  <p class="glance-text">
                    {glance.leader}: {formatWinProbability(
                      race.forecast.win_probability,
                    )}
                    modeled win probability
                  </p>
                {/if}
                <a href="#forecast" class="glance-link"
                  >Forecast details <UiIcon name="chevron-down" size="sm" /></a
                >
              </div>
            {/if}
            {#if latestPoll && latestMatchup}
              <div class="glance-block" class:glance-divider={showForecast}>
                <p class="glance-subtitle">Latest poll</p>
                <p class="poll-snapshot-meta">
                  {latestPoll.pollster}{pollDateLabel(latestPoll.date)
                    ? ` · ${pollDateLabel(latestPoll.date)}`
                    : ""}{pollAgeLabel(latestPoll.date)
                    ? ` (${pollAgeLabel(latestPoll.date)})`
                    : ""}
                </p>
                <div class="poll-snapshot-bars">
                  {#each snapshotRows as row, rowIndex (`${row.name}|${rowIndex}`)}
                    {@const name = row.name}
                    {@const pct = row.pct}
                    <div class="poll-snap-row">
                      <span class="poll-snap-name" title={name}
                        >{shortCandidateName(
                          name,
                          latestMatchup.candidates,
                        )}</span
                      >
                      <div class="poll-snap-bar-wrap" aria-hidden="true">
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
                <a href="#polls" class="glance-link">
                  {polls.length > 1
                    ? `All ${polls.length} polls`
                    : "Poll details"}
                  <UiIcon name="chevron-down" size="sm" />
                </a>
              </div>
            {/if}
          </div>
        {/if}
        <VoterResources {ballotpediaUrl} {registerToVoteUrl} {howToVoteUrl} />
      </aside>

      <!-- Candidates Section -->
      <section id="candidates" class="race-main scroll-mt-24" tabindex="-1">
        <div class="candidates-heading">
          <h2 class="h-section">Candidates</h2>
          {#if activeCandidates.length > 1}
            <p class="text-sm text-content-subtle">
              Tick <strong class="font-semibold text-content-muted"
                >Compare</strong
              > on two or more cards to see them side by side.
            </p>
          {/if}
        </div>
        {#if activeCandidates.length === 0}
          <div class="candidates-empty">
            <p class="candidates-empty-title">
              No active candidates listed yet
            </p>
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
        <div
          class="candidate-grid"
          class:single-column={activeCandidates.length === 1}
        >
          {#each activeCandidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
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
        <section class="race-main">
          <button
            type="button"
            class="flex min-h-11 items-center gap-2 text-sm font-medium text-content-muted transition-colors hover:text-content"
            on:click={() => (withdrawnExpanded = !withdrawnExpanded)}
            aria-expanded={withdrawnExpanded}
          >
            <svg
              class="h-4 w-4 transition-transform {withdrawnExpanded
                ? 'rotate-90'
                : ''}"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
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
              class="candidate-grid withdrawn-grid mt-3"
            >
              {#each withdrawnCandidates as candidate, index (`${index}-${candidateSlug(candidate.name)}`)}
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
    </div>

    <!-- Race Forecast -->
    {#if showForecast && race.forecast}
      {@const forecast = race.forecast}
      {@const headline = forecastHeadline(forecast)}
      {@const segments = partyProbabilitySegments(forecast.party_probabilities)}
      <section id="forecast" class="page-section scroll-mt-24" tabindex="-1">
        <h2 class="h-section section-title">Forecast</h2>
        <Card class="forecast-card">
          <div class="forecast-header">
            <div>
              <h3 class="forecast-title">{headline.title}</h3>

              {#if headline.leader && typeof forecast.win_probability === "number"}
                <p class="forecast-summary">
                  <strong>{headline.leader}:</strong>
                  {formatWinProbability(forecast.win_probability)} modeled win probability
                  {#if typeof forecast.margin_estimate === "number"}
                    with a {signedMargin(forecast.margin_estimate)} estimated margin
                  {/if}
                </p>
              {/if}
            </div>
            <span
              class="forecast-rating shrink-0 {ratingClass(forecast.rating)}"
            >
              {ratingLabel(forecast.rating)}
            </span>
          </div>

          <div class="forecast-grid">
            {#if headline.leader && typeof forecast.win_probability === "number"}
              <!-- A bare probability with no named leader is meaningless, so
                   the metric only shows when the forecast says whose it is. -->
              <div class="forecast-metric">
                <span class="forecast-metric-label"
                  >{headline.leader} win probability</span
                >
                <span class="forecast-metric-value"
                  >{formatWinProbability(forecast.win_probability)}</span
                >
              </div>
            {/if}
            <div class="forecast-metric">
              <span class="forecast-metric-label">Estimated Margin</span>
              <span class="forecast-metric-value"
                >{signedMargin(forecast.margin_estimate)}</span
              >
            </div>
            <div class="forecast-metric">
              <span class="forecast-metric-label">Polling Inputs</span>
              {#if noPollInputs}
                <span class="forecast-metric-note"
                  >{polls.length > 0
                    ? "The polls below were not used — estimate based on partisan lean, incumbency and fundraising"
                    : "No public polls — estimate based on partisan lean, incumbency and fundraising"}</span
                >
              {:else}
                <span class="forecast-metric-value"
                  >{forecast.based_on_poll_count} poll{forecast.based_on_poll_count ===
                  1
                    ? ""
                    : "s"}</span
                >
              {/if}
            </div>
          </div>

          <button
            type="button"
            class="link-button mt-2"
            aria-expanded={forecastExpanded}
            aria-controls={forecastExpanded ? "forecast-details" : undefined}
            on:click={toggleForecastExpanded}
          >
            {forecastExpanded ? "Hide details" : "Show details"}
            <span
              class="inline-flex transition-transform duration-200"
              class:rotate-180={forecastExpanded}
              ><UiIcon name="chevron-down" size="sm" /></span
            >
          </button>

          {#if forecastExpanded}
            <div
              transition:slide={{ duration: motionDuration(400) }}
              class="expanded-content mt-4"
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
                <p class="forecast-takeaway">
                  {cleanDisplayText(forecast.takeaway || forecast.rationale)}
                </p>
                {#if forecast.market_signals?.length}
                  <div class="forecast-market-signals">
                    <div class="forecast-market-header">
                      <h4>Kalshi Market Signals</h4>
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
                              {probabilityOneDecimal(
                                signal.implied_probability,
                              )}
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
                    <h4>Key Drivers</h4>
                    <ul>
                      {#each forecast.key_reasons as reason}
                        <li>{cleanDisplayText(reason)}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if forecast.uncertainty}
                  <div class="forecast-detail-block">
                    <h4>Uncertainty</h4>
                    <p>{cleanDisplayText(forecast.uncertainty)}</p>
                  </div>
                {/if}
                {#if forecast.rationale && forecast.takeaway}
                  <div class="forecast-detail-block">
                    <h4>Model Rationale</h4>
                    <p>{cleanDisplayText(forecast.rationale)}</p>
                  </div>
                {/if}
              </div>

              {#if forecast.source_urls?.length}
                <div class="forecast-sources">
                  <span class="overview-sources-label">Sources</span>
                  {#each forecast.source_urls as url}
                    {#if isExternalUrl(url)}
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="source-chip"
                        title={url}
                      >
                        {sourceHostname(url)}
                        <UiIcon name="external" size="sm" />
                      </a>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <div class="forecast-meta">
            <span>Forecast confidence: {forecast.confidence}</span>
            {#if forecast.generated_at}
              <span
                >Generated: {formatPollDate(forecast.generated_at) ||
                  "date unavailable"}</span
              >
            {/if}
          </div>
        </Card>
      </section>
    {/if}

    <!-- Detailed Polls Section -->
    {#if polls.length > 0}
      <section id="polls" class="page-section scroll-mt-24" tabindex="-1">
        <div
          class="section-title flex flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <h2 class="h-section">Polling</h2>
          <span class="text-sm text-content-subtle"
            >{polls.length} poll{polls.length === 1 ? "" : "s"}, newest first</span
          >
        </div>
        <div class="polls-grid">
          {#each visiblePolls as poll, pollIndex (`${poll.pollster}|${poll.date ?? ""}|${pollIndex}`)}
            <div class="poll-card">
              <div class="poll-card-header">
                <div>
                  <span class="poll-card-pollster">{poll.pollster}</span>
                  {#if pollDateLabel(poll.date)}
                    <span class="poll-card-date"
                      >{pollDateLabel(poll.date)}{pollAgeLabel(poll.date)
                        ? ` · ${pollAgeLabel(poll.date)}`
                        : ""}</span
                    >
                  {/if}
                  {#if isPreviousCyclePoll(poll.date, race.election_date)}
                    <span class="poll-card-cycle">Previous cycle</span>
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
                  aria-label="Source: {poll.pollster}{pollDateLabel(poll.date)
                    ? `, ${pollDateLabel(poll.date)}`
                    : ''} (opens in a new tab)"
                >
                  Source
                  <UiIcon name="external" size="sm" />
                </a>
              {/if}
            </div>
          {/each}
        </div>
        {#if polls.length > POLL_PREVIEW_COUNT}
          <div class="mt-4 text-center">
            <button
              type="button"
              class="btn-secondary"
              aria-expanded={pollsExpanded}
              on:click={() => (pollsExpanded = !pollsExpanded)}
            >
              {pollsExpanded
                ? "Show fewer polls"
                : `Show all ${polls.length} polls`}
            </button>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Data Note -->
    <div class="alert-info page-section mb-6">
      <p class="font-semibold text-content">
        {usingFallbackData ? "Sample Data Information" : "About this research"}
      </p>
      <p class="mt-1">
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
    <ReviewPanel
      reviews={race.reviews ?? []}
      candidateNames={(race.candidates ?? []).map((c) => c.name)}
      models={researchModels}
    />

    <SupportNote class="mt-8" />

    <!-- Back to Top -->
    <div class="back-to-top">
      <button
        type="button"
        class="btn-ghost"
        on:click={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
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
            d="M5 10l7-7m0 0l7 7m-7-7v18"
          />
        </svg>
        Back to top
      </button>
    </div>

    <!-- Announces selection changes; always rendered so updates are heard. -->
    <p class="sr-only" role="status" aria-live="polite">
      {#if selectedCandidates.size === 1}
        1 candidate selected. Select at least one more to compare.
      {:else if selectedCandidates.size > 1}
        {selectedCandidates.size} candidates selected to compare.
      {/if}
    </p>

    <!-- Compare sticky drawer -->
    {#if selectedCandidates.size > 0}
      <div
        transition:fade={{ duration: motionDuration(200) }}
        class="fixed bottom-6 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-stroke bg-surface/95 px-5 py-3 shadow-2xl backdrop-blur-md"
      >
        <div class="flex items-center gap-3">
          <span
            class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-700 text-xs font-bold text-white dark:bg-primary-600"
            >{selectedCandidates.size}</span
          >
          <span class="text-sm font-semibold text-content"
            >Selected to compare</span
          >
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            on:click={clearSelection}
            class="btn-ghost min-h-10 px-3 text-xs text-content-muted"
            >Clear</button
          >
          {#if selectedCandidates.size >= 2}
            <a
              href="/races/{race.id}/compare/?candidates={[
                ...selectedCandidates,
              ].join(',')}{isDraftPreview ? '&draft=true' : ''}"
              class="btn-primary min-h-10 px-4 text-xs"
            >
              Compare Now &rarr;
            </a>
          {:else}
            <span class="text-xs text-content-subtle"
              >Select 1 more to compare</span
            >
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style lang="postcss">
  @reference "../../../app.css";

  /* Scoped `dark:` variants inside <style> never match: Svelte scopes the
     `.dark` ancestor to this component. Dark overrides use :global(.dark). */
  .loading-wrapper {
    @apply flex items-center justify-center py-20;
  }

  .spinner {
    @apply h-12 w-12 animate-spin rounded-full border-b-2 border-primary-600;
  }

  .loading-text {
    @apply ml-3 text-lg text-content-muted;
  }

  .inline-link {
    @apply font-medium text-primary underline hover:no-underline;
  }

  .link-button {
    @apply inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline;
  }

  /* Header */
  :global(.race-header) {
    @apply mb-6 p-5 sm:p-6 lg:p-8;
  }

  .header-top {
    @apply flex flex-wrap items-start justify-between gap-3;
  }

  .header-meta {
    @apply mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-content-muted;
  }

  .info-row {
    @apply inline-flex items-center gap-1.5;
  }

  .header-actions {
    @apply mt-5 flex flex-col gap-3 sm:flex-row sm:items-center;
  }

  /* Overview + sidebar layout */
  .race-layout {
    @apply grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8;
  }

  .race-main {
    @apply min-w-0 lg:col-start-1;
  }

  .race-aside {
    @apply flex min-w-0 flex-col gap-4 lg:sticky lg:col-start-2 lg:top-[calc(var(--site-header-height)+1rem)];
  }

  /* Tablets: the glance card and voting resources sit side by side. */
  .race-aside.has-glance {
    @apply md:grid md:grid-cols-2 md:items-start lg:flex lg:items-stretch;
  }

  @media (min-width: 1024px) {
    .race-aside {
      grid-row: 1 / span var(--aside-rows, 2);
    }
  }

  .overview-card {
    @apply p-5 sm:p-6;
  }

  .overview-text {
    @apply mt-3 space-y-3 text-sm leading-relaxed text-content-muted sm:text-base sm:leading-6;
  }

  @media (max-width: 639px) {
    .overview-extra {
      display: none;
    }
  }

  .overview-sources {
    @apply mt-4 flex flex-wrap items-center gap-2;
  }

  .overview-sources-label {
    @apply mr-1 text-xs font-semibold uppercase tracking-wider text-content-subtle;
  }

  .source-chip {
    @apply inline-flex min-h-8 items-center gap-1 rounded-full border border-stroke bg-page px-3 py-1 text-xs font-medium text-primary no-underline transition-colors hover:border-primary-300 hover:bg-surface-alt;
  }

  .overview-candidates {
    @apply mt-5 hidden flex-wrap gap-2 border-t border-stroke pt-4 sm:flex;
  }

  .overview-candidate-chip {
    @apply flex min-h-10 items-center gap-1.5 rounded-full border border-stroke bg-surface px-3 py-1.5 text-sm text-content-muted no-underline transition-colors duration-200 hover:border-primary-300 hover:bg-surface-alt;
  }

  .chip-name {
    @apply text-sm font-medium text-content;
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
    @apply rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-800;
  }
  :global(.dark) .chip-incumbent {
    @apply bg-green-900/60 text-green-200;
  }

  /* At-a-glance card */
  .glance-card {
    @apply p-5;
  }

  .glance-block {
    @apply mt-3;
  }

  .glance-divider {
    @apply mt-4 border-t border-stroke pt-4;
  }

  .glance-title {
    @apply text-base font-semibold leading-snug text-content;
  }

  .glance-subtitle {
    @apply text-sm font-semibold text-content;
  }

  .glance-text {
    @apply mt-1 text-sm leading-snug text-content-muted;
  }

  .glance-link {
    @apply mt-1 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary no-underline hover:underline;
  }

  .poll-snapshot-meta {
    @apply mt-0.5 text-xs text-content-subtle;
  }

  .poll-snapshot-bars {
    @apply my-2 space-y-1.5;
  }

  .poll-snap-row {
    @apply flex items-center gap-2;
  }

  .poll-snap-name {
    @apply w-20 shrink-0 truncate text-xs font-medium text-content-muted;
  }

  .poll-snap-bar-wrap {
    @apply h-2 flex-1 overflow-hidden rounded-full bg-surface-alt;
  }

  .poll-snap-bar {
    @apply h-full rounded-full bg-slate-500;
  }

  .poll-snap-pct {
    @apply w-10 shrink-0 text-right text-xs font-bold tabular-nums text-content;
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

  /* Candidates */
  .candidates-heading {
    @apply mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1;
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
    @apply grid items-start gap-4 sm:gap-5 md:grid-cols-2;
    /* An expanded right-column card jumps to its own row; dense packing pulls
       the next card up so the left cell it vacated is not left empty. */
    grid-auto-flow: row dense;
  }

  /* An expanded card shows the full issue table, which needs the whole row. */
  .candidate-grid > :global(.candidate-card--expanded) {
    grid-column: 1 / -1;
  }

  .candidate-grid.single-column {
    @apply md:grid-cols-1;
  }

  .withdrawn-grid {
    @apply opacity-75;
  }

  /* Lower page sections */
  .page-section {
    @apply mt-10 sm:mt-12;
  }

  .section-title {
    @apply mb-4;
  }

  /* Forecast */
  :global(.forecast-card) {
    @apply p-5 sm:p-6;
  }

  .forecast-header {
    @apply mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between;
  }

  .forecast-title {
    @apply text-lg font-semibold text-content sm:text-xl;
  }

  .forecast-summary {
    @apply mt-1 text-sm leading-snug text-content-muted;
  }

  .forecast-rating {
    @apply inline-flex self-start rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide;
  }

  .expanded-content {
    @apply border-t border-stroke pt-4 sm:pt-6;
  }

  /* Two or three metrics (win probability only shows with a named leader). */
  .forecast-grid {
    @apply grid grid-cols-1 gap-2 sm:auto-cols-fr sm:grid-flow-col sm:gap-3;
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

  .forecast-metric-note {
    @apply mt-0.5 block text-sm leading-5 text-content-muted;
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
    @apply inline-block h-2.5 w-2.5 rounded-xs;
  }

  .forecast-body {
    @apply space-y-4;
  }

  .forecast-takeaway {
    @apply text-sm font-medium leading-relaxed text-content sm:text-base sm:leading-6;
  }

  .forecast-detail-block {
    @apply rounded-xl border border-stroke bg-page p-4;
  }

  .forecast-detail-block h4,
  .forecast-market-header h4 {
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

  .forecast-market-header h4 {
    @apply mb-0;
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
    @apply font-semibold text-primary hover:underline;
  }

  .forecast-meta {
    @apply mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-stroke pt-3 text-xs text-content-subtle;
  }

  .forecast-sources {
    @apply mt-4 flex flex-wrap items-center gap-2;
  }

  /* Detailed polls */
  .polls-grid {
    @apply grid gap-4 sm:grid-cols-2 lg:grid-cols-3;
  }

  .poll-card {
    @apply flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-4 shadow-xs;
  }

  .poll-card-header {
    @apply flex items-start justify-between gap-2;
  }

  .poll-card-pollster {
    @apply block text-sm font-semibold text-content;
  }

  .poll-card-date {
    @apply mt-0.5 block text-xs text-content-subtle;
  }

  .poll-card-cycle {
    @apply mt-1 inline-block rounded-sm border border-stroke bg-surface-alt px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-content-subtle;
  }

  .poll-card-sample {
    @apply shrink-0 text-xs text-content-subtle;
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
    @apply w-28 shrink-0 truncate text-xs font-medium text-content-muted;
  }

  .poll-bar-track {
    @apply h-3 flex-1 overflow-hidden rounded-full bg-surface-alt;
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
    @apply text-xs italic text-content-muted;
  }

  .poll-card-source {
    @apply mt-auto inline-flex min-h-8 items-center gap-1 self-start py-1 text-xs font-medium text-primary hover:underline;
  }

  .stage-notice {
    @apply mt-3;
  }

  /* Anchor targets take programmatic focus only (tabindex="-1"). */
  section[tabindex="-1"]:focus {
    outline: none;
  }

  .back-to-top {
    @apply mt-8 text-center;
  }
</style>
