<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import ForecastElectoralMap from "$lib/components/forecast/ForecastElectoralMap.svelte";
  import ForecastHoldovers from "$lib/components/forecast/ForecastHoldovers.svelte";
  import ForecastKeyRaces from "$lib/components/forecast/ForecastKeyRaces.svelte";
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
  import type { ChamberForecasts, RaceSummary } from "$lib/types";
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
    const params = new URLSearchParams($page.url.searchParams);
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
      replaceState: true,
      keepFocus: true,
      noScroll: true,
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
          {#if chamberForecasts?.updated_at}
            <span aria-hidden="true">·</span>
            <span
              >Updated {new Date(
                chamberForecasts.updated_at,
              ).toLocaleDateString()}</span
            >
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
        />

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
            onStateClick={handleStateClick}
            onClearFilter={clearStateFilter}
            onViewResults={scrollToRaceList}
          />

          <!-- Stats Panel Column -->
          <div class="space-y-6 h-full flex flex-col">
            <ForecastProjectionSummary
              label={aggregate.label}
              {controlParty}
              {threshold}
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
              />
            {/if}
          </div>
        </section>

        <ForecastRatingsBreakdown
          ratingOrder={ratingBreakdownOrder}
          ratingCounts={aggregate.ratingCounts}
        />

        <ForecastKeyRaces races={keyRacesList} />

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
