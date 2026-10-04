<script lang="ts">
  import type { RaceSummary } from "$lib/types";
  import USMap, { RACE_COUNT_BUCKETS } from "$lib/components/USMap.svelte";
  import RaceCard from "$lib/components/RaceCard.svelte";
  import { page } from "$app/stores";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { afterNavigate, replaceState } from "$app/navigation";
  import { canonicalRaceState, canonicalStateName } from "$lib/utils/states";
  import {
    getSearchTokens,
    matchesSearchDoc,
    prepareSearchDoc,
    type SearchDoc,
  } from "$lib/utils/search";
  import { debounce } from "$lib/utils/debounce";

  export let races: RaceSummary[] = [];
  /** True when the published race list could not be loaded at all. */
  export let loadError = false;

  const PAGE_SIZE = 24;
  let loading = false;
  let visibleRaceCount = PAGE_SIZE;
  let previousFilterSignature = "";

  // Filter state
  let selectedState: string | null = null;
  let selectedOffice: string | null = null;
  // `searchQuery` tracks the box keystroke by keystroke; the grid and map
  // filter on `debouncedSearchQuery` so re-rendering never blocks typing.
  let searchQuery = "";
  let debouncedSearchQuery = "";
  let mapExpanded = false;

  // Below `sm` the map is collapsed behind a toggle, and USMap downloads a
  // 224 KB topology the moment it mounts — so on phones mount it only once the
  // visitor asks for it. Read the breakpoint synchronously on the client so a
  // wide screen mounts the map during hydration, with no flash of the skeleton
  // the prerendered page already shows. Without matchMedia (tests, very old
  // browsers) assume the map is visible, which is the previous behaviour.
  const SM_QUERY = "(min-width: 640px)";
  const wideQuery =
    browser && typeof window.matchMedia === "function"
      ? window.matchMedia(SM_QUERY)
      : null;
  let isWideViewport = wideQuery ? wideQuery.matches : true;
  let mapMounted = false;
  // Sticky: once loaded, collapsing or narrowing the window keeps it mounted.
  $: mapMounted = mapMounted || mapExpanded || isWideViewport;

  onMount(() => {
    if (!wideQuery) return;
    const update = (event: MediaQueryListEvent) => {
      isWideViewport = event.matches;
    };
    wideQuery.addEventListener("change", update);
    return () => wideQuery.removeEventListener("change", update);
  });

  // Adopt `?q=`, `?state=`, and `?office=` only on real navigations (load,
  // back/forward, header search). Typing writes the URL shallowly, so it can
  // never echo back into the box and overwrite characters typed while an older
  // write was in flight.
  afterNavigate(({ to }) => {
    const params = to?.url.searchParams;
    // Shared links use postal codes or any case (`?state=TX`, `texas`);
    // canonicalize to the full name the race list is keyed by.
    const stateParam = params?.get("state")?.trim() || null;
    selectedState = canonicalStateName(stateParam) ?? stateParam;
    selectedOffice = params?.get("office") || null;
    const q = params?.get("q") || "";
    if (q === debouncedSearchQuery) return;
    applySearch.cancel();
    searchQuery = q;
    debouncedSearchQuery = q;
  });

  function setParam(url: URL, key: string, value: string | null) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }

  function writeQueryToUrl(q: string) {
    const url = new URL(window.location.href);
    setParam(url, "q", q);
    replaceState(url, $page.state);
  }

  function writeFiltersToUrl() {
    const url = new URL(window.location.href);
    setParam(url, "state", selectedState);
    setParam(url, "office", selectedOffice);
    replaceState(url, $page.state);
  }

  function setStateFilter(state: string | null) {
    selectedState = state;
    writeFiltersToUrl();
  }

  function setOfficeFilter(office: string | null) {
    selectedOffice = office;
    writeFiltersToUrl();
  }

  const applySearch = debounce((q: string) => {
    debouncedSearchQuery = q;
    writeQueryToUrl(q);
  }, 150);

  function handleHeroSearchInput() {
    applySearch(searchQuery.trim());
  }

  function clearHeroSearch() {
    applySearch.cancel();
    searchQuery = "";
    debouncedSearchQuery = "";
    writeQueryToUrl("");
  }

  // Normalize each race's searchable text once per catalog, not per query.
  $: searchIndex = new Map<
    RaceSummary,
    { doc: SearchDoc; candidates: Array<{ name: string; doc: SearchDoc }> }
  >(
    races.map((race) => [
      race,
      {
        doc: prepareSearchDoc(
          race.title,
          race.office,
          race.jurisdiction,
          canonicalRaceState(race),
          ...race.candidates.flatMap((c) => [c.name, c.party]),
        ),
        candidates: race.candidates.map((c) => ({
          name: c.name,
          doc: prepareSearchDoc(c.name),
        })),
      },
    ]),
  );
  $: searchTerms = getSearchTokens(debouncedSearchQuery);

  // Races passing the office and text filters; the state filter is applied on
  // top for the grid, while the map shows every state that still has matches.
  $: officeAndQueryRaces = races.filter((race) => {
    if (selectedOffice && officeShort(race.office) !== selectedOffice)
      return false;
    return (
      !searchTerms.length ||
      matchesSearchDoc(searchTerms, searchIndex.get(race)!.doc)
    );
  });

  // States that have races — prefer explicit `state` field, fall back to `jurisdiction` for
  // older records where jurisdiction is already a plain state name.
  // Dynamically filtered by search query and office filters so the map highlights update.
  $: activeStates = new Set(
    officeAndQueryRaces.map(canonicalRaceState).filter(Boolean) as string[],
  );

  // Compute matching candidates per state to show in map tooltips
  $: matchingCandidatesByState = (() => {
    const map: Record<string, string[]> = {};
    if (!searchTerms.length) return map;

    races.forEach((race) => {
      const stateKey = canonicalRaceState(race);
      if (!stateKey) return;
      for (const { name, doc } of searchIndex.get(race)!.candidates) {
        if (!matchesSearchDoc(searchTerms, doc)) continue;
        map[stateKey] ??= [];
        if (!map[stateKey].includes(name)) map[stateKey].push(name);
      }
    });
    return map;
  })();

  // Compute filtered race counts for active states to show in tooltips
  $: filteredRaceCounts = officeAndQueryRaces.reduce<Record<string, number>>(
    (acc, r) => {
      const stateKey = canonicalRaceState(r);
      if (stateKey) acc[stateKey] = (acc[stateKey] ?? 0) + 1;
      return acc;
    },
    {},
  );

  // unique short office names for filter chips - raising the bar
  function officeShort(office: string | null | undefined): string {
    if (!office) return "Other";
    const o = office.toLowerCase();
    if (o.includes("senate")) return "Senate";
    if (o.includes("governor") || o.includes("gubernatorial"))
      return "Governor";
    if (o.includes("house") || o.includes("representative")) return "House";
    if (o.includes("secretary")) return "Sec. of State";
    if (o.includes("attorney")) return "Atty. General";
    return "Other";
  }

  $: officeTypes = (() => {
    const mapped = races.map((r) => officeShort(r.office));
    const types = [...new Set(mapped)].filter((x) => x !== "Other").sort();
    if (mapped.includes("Other")) {
      types.push("Other");
    }
    return types;
  })();

  // filtering chain: state > office > text
  $: filteredRaces = officeAndQueryRaces
    .filter(
      (race) => !selectedState || canonicalRaceState(race) === selectedState,
    )
    .sort((a, b) => {
      const stateOrder = (canonicalRaceState(a) ?? "").localeCompare(
        canonicalRaceState(b) ?? "",
      );
      return stateOrder || (a.title ?? "").localeCompare(b.title ?? "");
    });

  $: filterSignature = JSON.stringify([
    selectedState,
    selectedOffice,
    debouncedSearchQuery.trim(),
  ]);
  $: if (filterSignature !== previousFilterSignature) {
    previousFilterSignature = filterSignature;
    visibleRaceCount = PAGE_SIZE;
  }
  $: visibleRaces = filteredRaces.slice(0, visibleRaceCount);

  function handleStateClick(e: CustomEvent<string>) {
    const state = e.detail;
    // Toggle the state only; the office filter is independent.
    setStateFilter(selectedState === state ? null : state);
  }

  $: hasActiveFilters =
    selectedState || selectedOffice || debouncedSearchQuery.trim();

  function clearFilters() {
    selectedState = null;
    selectedOffice = null;
    writeFiltersToUrl();
    clearHeroSearch();
  }

  // Keep the currently selected state as an option even when the search no
  // longer matches it, so the <select> never silently desyncs.
  $: stateOptions = [
    ...new Set([...activeStates, ...(selectedState ? [selectedState] : [])]),
  ].sort();

  $: resultAnnouncement = loadError
    ? ""
    : hasActiveFilters
      ? `${filteredRaces.length} ${filteredRaces.length === 1 ? "race" : "races"} found`
      : `Showing ${visibleRaces.length} of ${races.length} races`;
</script>

<div class="page-container py-8 sm:py-10">
  <!-- Hero -->
  <header class="text-center mb-8 sm:mb-10 flex flex-col items-center">
    <h1 class="h-page mb-3">Explore elections.</h1>
    <p class="text-base sm:text-lg text-content-muted max-w-xl mx-auto mb-6">
      Browse sourced candidate research for U.S. House, Senate, and governor
      races by state, office, or candidate.
    </p>

    <!-- Hero Search Bar -->
    <div
      class="relative w-full max-w-lg shadow-sm hover:shadow-md transition-shadow duration-300 rounded-full"
    >
      <label for="election-directory-search" class="sr-only">
        Search elections and candidates
      </label>
      <div
        class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"
      >
        <svg
          aria-hidden="true"
          class="h-5 w-5 text-content-subtle"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        id="election-directory-search"
        type="text"
        bind:value={searchQuery}
        on:input={handleHeroSearchInput}
        placeholder="Search by candidate name, office, or state..."
        class="block w-full pl-11 pr-10 py-3 border border-stroke rounded-full text-base bg-surface placeholder-content-subtle focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-content transition-all duration-300"
      />
      {#if searchQuery.trim()}
        <button
          on:click={clearHeroSearch}
          class="absolute inset-y-0 right-0 pr-4 flex items-center text-content-subtle hover:text-content transition-colors"
          aria-label="Clear search query"
        >
          <svg
            aria-hidden="true"
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      {/if}
    </div>
  </header>

  <!-- Primary filters stay ahead of the optional map so results are reachable quickly. -->
  <div
    class="mb-6 flex flex-wrap items-center gap-2"
    role="group"
    aria-label="Filter elections by office"
  >
    {#if selectedState}
      <button
        type="button"
        on:click={() => setStateFilter(null)}
        class="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-content bg-content pl-4 pr-3 text-sm font-medium text-surface"
        aria-label="Clear state filter: {selectedState}"
      >
        {selectedState}
        <svg
          aria-hidden="true"
          class="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    {/if}

    {#each officeTypes as office}
      <button
        type="button"
        on:click={() =>
          setOfficeFilter(selectedOffice === office ? null : office)}
        aria-pressed={selectedOffice === office}
        class="min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors
          {selectedOffice === office
          ? 'border-content bg-content text-surface'
          : 'border-stroke bg-surface text-content-muted hover:border-content-muted hover:text-content'}"
      >
        {office}
      </button>
    {/each}
  </div>

  <!-- Map section -->
  <section class="card p-4 sm:p-6 mb-6" aria-labelledby="election-map-heading">
    <div class="flex items-center justify-between mb-3">
      <h2 id="election-map-heading" class="h-card">
        {selectedState
          ? `${selectedState} · ${filteredRaceCounts[selectedState] ?? 0} race${
              (filteredRaceCounts[selectedState] ?? 0) !== 1 ? "s" : ""
            }`
          : "Races by state"}
      </h2>
      {#if selectedState}
        <button
          type="button"
          on:click={() => setStateFilter(null)}
          class="min-h-11 text-xs text-content-subtle hover:text-content underline underline-offset-2 transition-colors"
        >
          Clear selection
        </button>
      {/if}
    </div>

    <!-- Mobile dropdown select, visible only on small viewports -->
    <div class="block sm:hidden mb-4">
      <label
        for="mobile-state-select"
        class="block text-xs font-semibold text-content-subtle mb-1"
      >
        State
      </label>
      <select
        id="mobile-state-select"
        value={selectedState || ""}
        on:change={(e) => setStateFilter(e.currentTarget.value || null)}
        class="block min-h-11 w-full px-3 py-2 border border-stroke rounded-lg text-sm bg-surface text-content focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all"
      >
        <option value="">All States</option>
        {#each stateOptions as state}
          <option value={state}>
            {state} ({filteredRaceCounts[state] ?? 0} race{(filteredRaceCounts[
              state
            ] ?? 0) !== 1
              ? "s"
              : ""})
          </option>
        {/each}
      </select>
    </div>

    <button
      type="button"
      class="mb-3 inline-flex min-h-11 w-full items-center justify-between rounded-lg border border-stroke bg-surface-alt px-3 py-2 text-sm font-semibold text-content sm:hidden"
      aria-expanded={mapExpanded}
      aria-controls="election-state-map"
      on:click={() => (mapExpanded = !mapExpanded)}
    >
      {mapExpanded ? "Hide interactive map" : "Show interactive map"}
      <span aria-hidden="true">{mapExpanded ? "−" : "+"}</span>
    </button>
    <div
      id="election-state-map"
      class:hidden={!mapExpanded}
      class="mx-auto max-w-3xl sm:block"
    >
      {#if mapMounted}
        <USMap
          {activeStates}
          {selectedState}
          raceCounts={filteredRaceCounts}
          {matchingCandidatesByState}
          shadeByCount
          on:stateClick={handleStateClick}
        />
      {/if}
      <div
        class="mt-3 flex flex-col items-center justify-between gap-2 text-xs text-content-muted sm:flex-row"
      >
        <p class="hidden sm:block">Select a state to filter the races below.</p>
        <ul class="flex items-center gap-3" aria-label="Races per state">
          <li class="font-semibold text-content-subtle">Races</li>
          {#each RACE_COUNT_BUCKETS as bucket (bucket.label)}
            <li class="flex items-center gap-1.5">
              <span
                class="block h-3 w-3 rounded-sm border border-stroke"
                style="background: {bucket.fill};"
                aria-hidden="true"
              ></span>
              {bucket.label}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </section>

  <!-- Results grid -->
  <section>
    <div class="flex items-center justify-between mb-4">
      <p class="text-sm text-content-muted">
        {#if hasActiveFilters}
          <span class="font-medium text-content">{filteredRaces.length}</span>
          {filteredRaces.length === 1 ? "race" : "races"} found
          <button
            type="button"
            on:click={clearFilters}
            class="ml-2 underline underline-offset-2 hover:text-content transition-colors"
            >clear filters</button
          >
        {:else if !loading}
          Showing <span class="font-medium text-content"
            >{visibleRaces.length}</span
          >
          of <span class="font-medium text-content">{races.length}</span>
          races
        {/if}
      </p>
    </div>

    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {resultAnnouncement}
    </p>
    {#if loading}
      <!-- Loading spinner + skeleton grid -->
      <div class="flex justify-center items-center py-6">
        <svg
          class="animate-spin h-10 w-10 text-primary"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span class="ml-3 text-content-muted text-sm">Loading races…</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each Array(6) as _}
          <div class="card h-40 animate-pulse"></div>
        {/each}
      </div>
    {:else if loadError && races.length === 0}
      <div
        class="text-center py-16 text-content-subtle"
        role="alert"
        data-testid="races-load-error"
      >
        <p class="text-lg font-medium text-content">
          We couldn’t load the election guides
        </p>
        <p class="mt-1 text-sm">
          Please check your connection and
          <a
            href="/elections/"
            class="text-primary underline underline-offset-2"
            data-sveltekit-reload>try again</a
          >.
        </p>
      </div>
    {:else if filteredRaces.length === 0}
      <div class="text-center py-16 text-content-subtle">
        <svg
          aria-hidden="true"
          class="mx-auto h-12 w-12 text-content-faint mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.47-.881-6.08-2.329C7.76 10.22 9.77 8 12.16 8c1.311 0 2.52.375 3.546 1.022M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p class="text-lg font-medium text-content">No races found</p>
        <p class="mt-1 text-sm">
          {hasActiveFilters
            ? "Try adjusting your filters."
            : "No races have been published yet."}
        </p>
        {#if hasActiveFilters}
          <button
            type="button"
            on:click={clearFilters}
            class="btn-ghost mt-3 underline underline-offset-2"
          >
            Clear all filters
          </button>
        {/if}
      </div>
    {:else}
      <div
        id="election-results-grid"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {#each visibleRaces as race (race.id)}
          <RaceCard {race} />
        {/each}
      </div>
      {#if visibleRaces.length < filteredRaces.length}
        <div class="mt-8 flex justify-center">
          <button
            type="button"
            class="btn-secondary"
            aria-controls="election-results-grid"
            on:click={() => (visibleRaceCount += PAGE_SIZE)}
          >
            Show more races ({filteredRaces.length - visibleRaces.length}
            remaining)
          </button>
        </div>
      {/if}
    {/if}
  </section>
</div>
