<script lang="ts">
  import { browser } from "$app/env";
  import { goto } from "$app/navigation";
  import { page } from "$lib/stores/page.svelte";
  import { onMount } from "svelte";
  import ArchiveNotice from "$lib/components/ArchiveNotice.svelte";
  import ForecastElectoralMap from "$lib/components/forecast/ForecastElectoralMap.svelte";
  import ForecastHoldovers from "$lib/components/forecast/ForecastHoldovers.svelte";
  import ForecastKeyRaces from "$lib/components/forecast/ForecastKeyRaces.svelte";
  import ForecastLiveProjection from "$lib/components/forecast/ForecastLiveProjection.svelte";
  import ForecastMissingRaces from "$lib/components/forecast/ForecastMissingRaces.svelte";
  import ForecastOutlookAnalysis from "$lib/components/forecast/ForecastOutlookAnalysis.svelte";
  import ForecastProjectionSummary from "$lib/components/forecast/ForecastProjectionSummary.svelte";
  import ForecastRaceList from "$lib/components/forecast/ForecastRaceList.svelte";
  import ForecastRatingsBreakdown from "$lib/components/forecast/ForecastRatingsBreakdown.svelte";
  import ForecastSeatOutcomeChart from "$lib/components/forecast/ForecastSeatOutcomeChart.svelte";
  import ForecastSummaryCard from "$lib/components/forecast/ForecastSummaryCard.svelte";
  import ForecastTabNav from "$lib/components/forecast/ForecastTabNav.svelte";
  import ForecastUnavailable from "$lib/components/forecast/ForecastUnavailable.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type {
    ChamberForecasts,
    LiveForecastFile,
    RaceSummary,
  } from "$lib/types";
  import {
    aggregateForecasts,
    electionCycleYear,
    getMostLikelySeatOutcome,
    getRaceState,
    groupSeatDistribution,
    isRaceInForecastTab,
    parseForecastTab,
    resolveControlParty,
    FORECAST_RATING_ORDER,
    type ForecastTab,
  } from "$lib/utils/forecast";
  import {
    buildSeatOutcomeChart,
    buildStateMapData,
  } from "$lib/utils/forecastPresentation";
  import {
    liveChamberProjection,
    liveForecast,
    liveForecastStatus,
  } from "$lib/utils/liveForecast";
  import {
    buildResultMapOverlay,
    hasAnyResults,
    withResultTooltips,
  } from "$lib/utils/forecastResults";
  import { isResultsSeason, liveResults } from "$lib/utils/results";
  import { canonicalStateName } from "$lib/utils/states";
  import { scrollBehavior } from "$lib/utils/motion";

  const tabs: { id: ForecastTab; label: string }[] = [
    { id: "house", label: "House" },
    { id: "senate", label: "Senate" },
    { id: "governors", label: "Governors" },
  ];

  let activeTab: ForecastTab = "house";
  let selectedState: string | null = null;
  // Prerendered HTML cannot know `?tab=` / `?state=`, so tab-specific content
  // waits for hydration instead of flashing the House view and then swapping.
  let hydrated = false;
  onMount(() => {
    hydrated = true;
    // app.html set this flag to hide the prerendered House view on a first
    // load with another ?tab=. Hydration has now rendered the right tab, so
    // drop it rather than leave a page-wide "hide" switch on <html>.
    document.documentElement.removeAttribute("data-forecast-pending-tab");
  });

  $: races = ($page.data.races as RaceSummary[] | undefined) ?? [];
  $: racesLoadError = Boolean($page.data.loadError);
  $: forecastsLoadError = Boolean($page.data.forecastsLoadError);
  $: activeTab = browser
    ? parseForecastTab($page.url.searchParams.get("tab"))
    : "house";
  // A shared link may say `?state=TX` or `texas`; the map and race lists are
  // keyed by the full name.
  $: selectedState = browser
    ? (() => {
        const param = $page.url.searchParams.get("state")?.trim() || null;
        return canonicalStateName(param) ?? param;
      })()
    : null;
  $: aggregate = aggregateForecasts(races, activeTab);

  $: chamberForecasts = ($page.data.chamberForecasts ?? undefined) as
    ChamberForecasts | undefined;
  $: chamberSummary = chamberForecasts?.chambers?.[activeTab];
  $: chamberNarrative =
    chamberSummary?.narrative || chamberForecasts?.[activeTab] || "";

  $: seatBuckets = groupSeatDistribution(
    chamberSummary?.seat_distribution ?? {},
    activeTab,
  );
  $: seatOutcomeChart = buildSeatOutcomeChart(
    chamberSummary?.seat_distribution ?? {},
    chamberSummary?.threshold ?? 51,
  );

  $: projectedSeats = chamberSummary?.projected_seats ?? aggregate.projected;
  $: expectedSeats = chamberSummary?.expected_seats;
  $: outcomeProbabilities = chamberSummary?.outcome_probabilities;
  $: totalSeats = chamberSummary?.total_seats ?? aggregate.totalExpected;
  $: threshold = chamberSummary?.threshold ?? aggregate.threshold;
  $: controlParty = resolveControlParty(activeTab, chamberSummary, aggregate);

  // Active states + per-state race counts for the map click handler
  $: activeStates = new Set(
    races
      .filter((r) => isRaceInForecastTab(r, activeTab))
      .map(getRaceState)
      .filter(Boolean) as string[],
  );
  $: stateRaceCounts = races
    .filter((race) => isRaceInForecastTab(race, activeTab))
    .reduce<Record<string, number>>((counts, race) => {
      const state = getRaceState(race);
      if (state) counts[state] = (counts[state] ?? 0) + 1;
      return counts;
    }, {});

  // "other" sits off the Safe D - Safe R axis, so it only earns a tile when a
  // race actually holds that rating. Without it the tiles silently fail to
  // total the number of forecast races; with it always present, every ordinary
  // page carries a permanent zero.
  $: ratingBreakdownOrder =
    (aggregate.ratingCounts.other ?? 0) > 0
      ? [...FORECAST_RATING_ORDER, "other" as const]
      : FORECAST_RATING_ORDER;

  // The cycle these races belong to, for headings and holdover copy.
  $: cycleYear = electionCycleYear(races);

  // Dynamic colors and tooltips for the map
  $: stateMapData = buildStateMapData(races, activeTab);
  $: stateColors = stateMapData.colors;
  $: stateTooltips = stateMapData.tooltips;

  function handleStateClick(stateName: string) {
    setUrlState(activeTab, selectedState === stateName ? null : stateName);
  }

  function setActiveTab(tab: ForecastTab) {
    setUrlState(tab, null);
  }

  function setUrlState(tab: ForecastTab, state: string | null) {
    if (!browser) return;
    const params = new URLSearchParams($page.url.search);
    if (tab === "house") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    if (state) {
      params.set("state", state);
    } else {
      params.delete("state");
    }
    const query = params.toString();
    goto(`/forecast/${query ? `?${query}` : ""}`, {
      replace: true,
      reset: false,
    });
  }

  $: keyRacesList = races.filter((r) => {
    if (!isRaceInForecastTab(r, activeTab)) return false;
    const title = r.title || "";
    const id = r.id || "";
    return chamberSummary?.competitive_races?.some(
      (t) => t === title || title.includes(t) || id.includes(t),
    );
  });

  $: filteredMissingRaces = selectedState
    ? aggregate.missingForecasts.filter(
        (r) => getRaceState(r) === selectedState,
      )
    : aggregate.missingForecasts;

  function clearStateFilter() {
    setUrlState(activeTab, null);
  }

  const RACE_LIST_ID = "forecast-race-list";
  function scrollToRaceList() {
    const list = document.getElementById(RACE_LIST_ID);
    if (!list) return;
    list.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    list.focus({ preventScroll: true });
  }

  $: mostLikelyOutcome = getMostLikelySeatOutcome(
    chamberSummary?.seat_distribution ?? {},
  );

  // Election night: shown only once a race in this chamber is called. Until
  // then, or if the live file fails to load, the page is the forecast alone.
  // The build bakes in a snapshot of the live file, so the block is already
  // in the prerendered page (no layout shift when the browser copy lands);
  // the browser's copy, refreshed each minute, replaces it. Before hydration
  // activeTab is "house", which is the tab the prerendered HTML shows.
  $: liveSnapshot = ($page.data.liveForecastSnapshot ??
    null) as LiveForecastFile | null;
  $: liveFile = $liveForecast ?? liveSnapshot;
  $: liveProjection = liveChamberProjection(liveFile, activeTab);

  // Election night: per-race results for the cards, lists and map. Before
  // hydration (and before the first load) the map stays empty, so the
  // prerendered page is the forecast alone.
  $: results = hydrated ? $liveResults : new Map();
  $: anyResults = hasAnyResults(results);
  $: tabHasResults = hasAnyResults(
    results,
    races.filter((r) => isRaceInForecastTab(r, activeTab)).map((r) => r.id),
  );
  $: resultOverlay = tabHasResults
    ? buildResultMapOverlay(races, activeTab, results)
    : null;
  $: resultTooltips = resultOverlay
    ? withResultTooltips(stateTooltips, resultOverlay)
    : null;
  // In the prerendered HTML from Election Day on; in the browser, also once
  // the results file has any votes (a reader whose clock is a day behind).
  let resultsSeason = isResultsSeason();
  onMount(() => {
    resultsSeason = isResultsSeason();
  });
  $: showResultsCallout = resultsSeason || anyResults;
  // Without a build snapshot, hold the live block's space while the first
  // browser fetch is in flight, so the page does not jump when it arrives.
  $: reserveLiveSpace =
    !liveProjection && resultsSeason && $liveForecastStatus === "loading";
  $: updatedLabel = (() => {
    const value = chamberForecasts?.updated_at;
    if (!value) return "";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ""
      : parsed.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  })();
</script>

<svelte:head>
  <title>2026 Election Forecasts — Smarter.Vote</title>
  <meta
    name="description"
    content="Explore 2026 House, Senate, and governor forecasts with win probabilities, chamber-control projections, polling, and prediction-market signals."
  />
  <link rel="canonical" href="https://smarter.vote/forecast/" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://smarter.vote/forecast/" />
  <meta property="og:title" content="2026 Election Forecasts — Smarter.Vote" />
  <meta
    property="og:description"
    content="Explore 2026 House, Senate, and governor forecasts with win probabilities, chamber-control projections, polling, and prediction-market signals."
  />
  <meta property="og:image" content="https://smarter.vote/og-image.png" />
  <meta property="og:site_name" content="Smarter.Vote" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="https://smarter.vote/forecast/" />
  <meta name="twitter:title" content="2026 Election Forecasts — Smarter.Vote" />
  <meta
    name="twitter:description"
    content="Explore 2026 House, Senate, and governor forecasts with win probabilities, chamber-control projections, polling, and prediction-market signals."
  />
  <meta name="twitter:image" content="https://smarter.vote/og-image.png" />
</svelte:head>

<div class="forecast-page page-container py-8 sm:py-10 space-y-8">
  <header>
    <div
      class="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
    >
      <div>
        <h1 class="h-page">2026 Election Forecast</h1>
        <p class="mt-2 text-base text-content-muted max-w-3xl">
          See who’s favored, what could decide control, and where the model sees
          the most uncertainty across the 2026 House, Senate, and governor
          races.
        </p>
        <div
          class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-content-subtle"
        >
          <span class:forecast-prerendered={!hydrated}
            >{aggregate.races.length}
            {activeTab === "house"
              ? "House"
              : activeTab === "senate"
                ? "Senate"
                : "governor"} race{aggregate.races.length === 1 ? "" : "s"} modeled</span
          >
          {#if updatedLabel}
            <span aria-hidden="true">·</span>
            <span>Forecast updated {updatedLabel}</span>
          {/if}
          <span aria-hidden="true">·</span>
          <a
            href="/about/#forecast-methodology"
            class="inline-flex items-center gap-1.5 text-primary-700 hover:underline dark:text-primary-300"
            >How the forecast works <UiIcon name="arrow-right" size="sm" /></a
          >
        </div>
      </div>
    </div>
  </header>

  <!-- Labels the pre-election forecast only; the live projection and results
       below keep updating. -->
  <ArchiveNotice year={cycleYear} />

  {#if showResultsCallout}
    <a
      href="/results/"
      class="card flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-primary-200 px-4 py-3 text-sm transition-colors hover:border-primary-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 sm:px-5 dark:border-primary-800/60 dark:hover:border-primary-600"
      data-testid="forecast-results-callout"
    >
      <span class="flex min-w-0 items-center gap-2.5">
        <span class="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
          <span
            class="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping"
          ></span>
          <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600"
          ></span>
        </span>
        <span class="font-semibold text-content"
          >Results are coming in.
          <span class="font-normal text-content-muted"
            >This page is the pre-election forecast, with live results marked on
            each race.</span
          ></span
        >
      </span>
      <span
        class="inline-flex shrink-0 items-center gap-1.5 font-bold text-primary-700 dark:text-primary-300"
        >See live results <UiIcon name="arrow-right" size="sm" /></span
      >
    </a>
  {/if}

  {#if (!races || races.length === 0) && (!chamberForecasts || !chamberForecasts.chambers)}
    <ForecastUnavailable loadError={racesLoadError || forecastsLoadError} />
  {:else}
    <!-- Prerendered HTML is the House view (crawlers index it). A visit with a
         different ?tab= hides it until hydration via the data-forecast-pending-tab
         flag app.html sets, so the House view never flashes. -->
    <div class="space-y-8" class:forecast-prerendered={!hydrated}>
      <ForecastTabNav
        {tabs}
        {activeTab}
        onSelect={setActiveTab}
        panelId="forecast-tabpanel"
      />

      <div
        id="forecast-tabpanel"
        role="tabpanel"
        aria-labelledby="forecast-tab-{activeTab}"
        class="space-y-8"
      >
        {#if liveProjection}
          <ForecastLiveProjection
            projection={liveProjection}
            resultsUpdatedAt={liveFile?.results_updated_at ?? null}
            {activeTab}
            preElectionProbability={chamberSummary?.control_probability}
            preElectionParty={chamberSummary ? controlParty : null}
            swingPosterior={liveFile?.swing_posterior}
          />
        {:else if reserveLiveSpace}
          <div
            class="card flex min-h-[22rem] items-center justify-center p-4 text-sm text-content-subtle sm:min-h-[19rem] sm:p-6 motion-safe:animate-pulse"
            data-testid="forecast-live-placeholder"
          >
            Loading the live projection…
          </div>
        {/if}

        <!-- The heading and card share a wrapper so the tab panel's space-y
             gap sits above the heading, not between it and the card. -->
        <div>
          {#if liveProjection || reserveLiveSpace}
            <h2 class="h-section mb-3">Pre-election forecast</h2>
          {/if}
          <ForecastSummaryCard
            {activeTab}
            {controlParty}
            controlProbability={chamberSummary?.control_probability}
            vpTiebreakParty={chamberSummary?.vp_tiebreak_party}
            {mostLikelyOutcome}
            tossupCount={chamberSummary?.tossup_count ?? 0}
            competitiveRaceCount={chamberSummary?.competitive_race_count ?? 0}
            {cycleYear}
            {outcomeProbabilities}
            {projectedSeats}
            {totalSeats}
            {threshold}
            narrative={chamberNarrative}
            updatedAt={chamberForecasts?.updated_at}
            preElection={Boolean(liveProjection)}
          />
        </div>

        <!-- Interactive Map & Statistics Dashboard Grid -->
        <section
          class="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] gap-6 items-stretch"
        >
          <ForecastElectoralMap
            {activeTab}
            {activeStates}
            {selectedState}
            {stateRaceCounts}
            {stateColors}
            {stateTooltips}
            resultColors={resultOverlay?.colors ?? null}
            {resultTooltips}
            onStateClick={handleStateClick}
            onClearFilter={clearStateFilter}
            onViewResults={scrollToRaceList}
          />

          <!-- Stats Panel Column -->
          <div class="space-y-6 h-full flex flex-col">
            <ForecastProjectionSummary
              label={liveProjection
                ? `Pre-election ${aggregate.label}`
                : aggregate.label}
              {controlParty}
              {threshold}
              {activeTab}
              {projectedSeats}
              totalExpected={aggregate.totalExpected}
              {expectedSeats}
              netChange={aggregate.netChange}
            />

            {#if chamberSummary?.seat_distribution && Object.keys(chamberSummary.seat_distribution).length > 0}
              <ForecastSeatOutcomeChart
                {seatBuckets}
                sortedOutcomes={seatOutcomeChart.outcomes}
                maxProbability={seatOutcomeChart.maxProbability}
                svgData={seatOutcomeChart.svgData}
                threshold={chamberSummary?.threshold ?? threshold}
              />
            {/if}
          </div>
        </section>

        <ForecastRatingsBreakdown
          ratingOrder={ratingBreakdownOrder}
          ratingCounts={aggregate.ratingCounts}
        />

        <ForecastKeyRaces races={keyRacesList} {results} />

        <ForecastOutlookAnalysis
          {activeTab}
          {chamberSummary}
          {chamberNarrative}
        />

        <ForecastRaceList
          races={aggregate.races}
          {activeTab}
          {selectedState}
          {chamberSummary}
          onClearStateFilter={clearStateFilter}
          sectionId={RACE_LIST_ID}
          {results}
        />

        <ForecastMissingRaces races={filteredMissingRaces} {activeTab} />

        <ForecastHoldovers
          {activeTab}
          holdovers={aggregate.holdovers}
          {cycleYear}
        />
      </div>
    </div>
  {/if}
</div>

<style lang="postcss">
  @reference "../../app.css";

  /* app.html flags a first load whose ?tab= is not the prerendered House view;
     hide the prerendered House content until hydration renders the right tab. */
  :global(html[data-forecast-pending-tab]) .forecast-prerendered {
    visibility: hidden;
    /* Safety net: if hydration never happens (a script error, a blocked
       bundle), reveal the prerendered content anyway after a few seconds
       rather than leaving the page blank. Hydration normally removes the
       flag (onMount) long before this fires. */
    animation: forecast-pending-reveal 0s linear 4s forwards;
  }
  @keyframes forecast-pending-reveal {
    to {
      visibility: visible;
    }
  }
  /* :global() is required here: buttons/selects for this page now live inside
     child components (forecast/*.svelte), so a plain scoped selector would no
     longer match them. */
  .forecast-page :global(button),
  .forecast-page :global(select) {
    @apply min-h-11;
  }
</style>
