<script lang="ts">
  import { browser } from "$app/environment";
  import { afterNavigate, goto, replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import type { RaceSummary } from "$lib/types";
  import { getSearchIndex } from "$lib/api";
  import { candidateSlug } from "$lib/utils/format";
  import { debounce } from "$lib/utils/debounce";
  import {
    buildSearchIndex,
    prepareSearchIndex,
    searchIndex as runSearch,
    type SearchIndex,
  } from "$lib/utils/searchIndex";

  export let races: RaceSummary[] = [];
  export let isAuthenticated = false;
  export let darkMode = false;
  export let onToggleDark: () => void;

  let query = "";
  let lastQuery = "";
  let open = false;
  let activeIndex = -1;
  let searchContainer: HTMLElement;
  let searchInput: HTMLInputElement;
  // Supplied races (tests, pages that already hold the catalog) are indexed
  // locally; otherwise the compact build-time index is fetched on first use.
  let index: SearchIndex = buildSearchIndex(races);
  let searchLoading = false;
  let searchLoaded = races.length > 0;
  $: if (races.length > 0) {
    index = buildSearchIndex(races);
    searchLoaded = true;
  }
  let searchLoadError = false;
  let searchLoadPromise: Promise<void> | null = null;
  let mobileNavOpen = false;
  let mobileSearchOpen = false;
  let siteHeader: HTMLElement;
  let searchToggle: HTMLButtonElement | undefined;
  let navToggle: HTMLButtonElement | undefined;
  const resultsId = "site-search-results";

  onMount(() => {
    const updateHeaderHeight = () => {
      document.documentElement.style.setProperty(
        "--site-header-height",
        `${siteHeader.offsetHeight}px`,
      );
    };

    updateHeaderHeight();
    const resizeObserver = new ResizeObserver(updateHeaderHeight);
    resizeObserver.observe(siteHeader);

    return () => resizeObserver.disconnect();
  });

  async function ensureSearchRaces() {
    if (!browser || searchLoaded || searchLoadPromise) return searchLoadPromise;
    searchLoading = true;
    searchLoadError = false;
    searchLoadPromise = getSearchIndex()
      .then((loadedIndex) => {
        index = loadedIndex;
        searchLoaded = true;
      })
      .catch(() => {
        searchLoadError = true;
      })
      .finally(() => {
        searchLoading = false;
        searchLoadPromise = null;
      });
    return searchLoadPromise;
  }

  const MAX_MATCHES = 5;

  // Normalize every searchable field once per index load; doing it per
  // keystroke across hundreds of races is what made typing stutter.
  $: prepared = prepareSearchIndex(index);
  $: results = runSearch(prepared, query, MAX_MATCHES);
  $: raceMatches = results.races;
  $: candidateMatches = results.candidates;
  $: resultCount = raceMatches.length + candidateMatches.length;
  // Options: races, candidates, then "See all N results" last.
  $: totalMatches = resultCount > 0 ? resultCount + 1 : 0;
  $: seeAllIndex = resultCount;
  $: electionsHref = `/elections/?q=${encodeURIComponent(query.trim())}`;

  // Adopt the homepage `?q=` only on real navigations (load, back/forward,
  // links). Our own URL writes are shallow, so they never echo back into the
  // box and overwrite characters typed since.
  afterNavigate(({ to }) => {
    // Any navigation (link, back/forward, search result) closes the mobile
    // panels and the results dropdown.
    mobileNavOpen = false;
    mobileSearchOpen = false;
    open = false;
    activeIndex = -1;
    if (!to || to.url.pathname !== "/") {
      lastQuery = "";
      return;
    }
    const urlQuery = to.url.searchParams.get("q") || "";
    if (urlQuery === lastQuery) return;
    lastQuery = urlQuery;
    query = urlQuery;
    if (urlQuery) void ensureSearchRaces();
  });

  const updateHomepageQuery = debounce((value: string) => {
    if ($page.url.pathname !== "/") return;
    const url = new URL(window.location.href);
    value ? url.searchParams.set("q", value) : url.searchParams.delete("q");
    replaceState(url, $page.state);
  }, 300);

  function handleInput() {
    activeIndex = -1;
    open = Boolean(query.trim());
    if (open) void ensureSearchRaces();
    if ($page.url.pathname === "/") {
      lastQuery = query.trim();
      updateHomepageQuery(lastQuery);
    }
  }

  function selectRace(id: string) {
    open = false;
    mobileSearchOpen = false;
    query = "";
    goto(`/races/${id}/`);
  }

  function seeAllResults() {
    open = false;
    activeIndex = -1;
    mobileSearchOpen = false;
    goto(electionsHref);
  }

  function selectCandidate(raceId: string, name: string) {
    open = false;
    mobileSearchOpen = false;
    query = "";
    goto(`/races/${raceId}/${candidateSlug(name)}/`);
  }

  function clearSearch() {
    query = "";
    lastQuery = "";
    open = false;
    updateHomepageQuery("");
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" && totalMatches) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % totalMatches;
    } else if (event.key === "ArrowUp" && totalMatches) {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + totalMatches) % totalMatches;
    } else if (event.key === "Escape") {
      if (open) {
        // First Escape only closes the results; keep the panel open.
        event.stopPropagation();
        open = false;
        activeIndex = -1;
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < raceMatches.length)
        selectRace(raceMatches[activeIndex].i);
      else if (activeIndex >= raceMatches.length && activeIndex < resultCount) {
        const candidate = candidateMatches[activeIndex - raceMatches.length];
        selectCandidate(candidate.raceId, candidate.name);
      } else if (query.trim()) {
        // The "See all" option, or Enter with nothing highlighted.
        seeAllResults();
      }
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && (mobileNavOpen || mobileSearchOpen)) {
      // Return focus to the toggle that opened the panel instead of letting
      // it fall to <body> when the focused element disappears.
      const returnTo = mobileSearchOpen ? searchToggle : navToggle;
      const focusWasInside = siteHeader?.contains(document.activeElement);
      mobileNavOpen = false;
      mobileSearchOpen = false;
      open = false;
      if (focusWasInside) void tick().then(() => returnTo?.focus());
    }
    if (
      event.key === "/" &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || "")
    ) {
      event.preventDefault();
      mobileSearchOpen = true;
      void tick().then(() => {
        searchInput?.focus();
        searchInput?.select();
      });
    }
  }

  async function toggleMobileSearch() {
    mobileSearchOpen = !mobileSearchOpen;
    mobileNavOpen = false;
    if (mobileSearchOpen) {
      await tick();
      searchInput?.focus();
    } else {
      open = false;
    }
  }

  function handleWindowClick(event: MouseEvent) {
    if (searchContainer && !searchContainer.contains(event.target as Node))
      open = false;
  }

  function isCurrent(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(href);
  }

  // One persistent live region whose text changes, so status messages are
  // announced reliably (inserted live regions often are not).
  $: searchStatus = !open
    ? ""
    : resultCount > 0
      ? `${resultCount} result${resultCount === 1 ? "" : "s"} available. Use the up and down arrows to review.`
      : searchLoading
        ? "Loading search results…"
        : searchLoaded && query.trim()
          ? "No matching elections or candidates."
          : searchLoadError
            ? "Search is temporarily unavailable. Press Enter to browse elections."
            : "";

  const primaryLinks = [
    { href: "/my-ballot/", label: "My Ballot" },
    { href: "/elections/", label: "Elections" },
    { href: "/forecast/", label: "Forecast" },
    { href: "/about/", label: "About" },
    { href: "/support/", label: "Support" },
  ];
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

<header
  bind:this={siteHeader}
  class="sticky top-0 z-50 bg-surface/90 backdrop-blur-md shadow-xs border-b border-stroke/50"
>
  <div class="page-container py-3">
    <!-- Below lg the header is compact (search icon + menu); from lg up the
         nav and search box sit inline. -->
    <div class="sh-row flex flex-wrap items-center gap-0 min-[360px]:gap-1">
      <a
        href="/"
        class="mr-auto text-lg min-[360px]:text-xl sm:text-2xl font-bold text-primary hover:text-primary/80 whitespace-nowrap"
        aria-label="Smarter.Vote home"
      >
        Smarter.Vote
      </a>

      <button
        type="button"
        bind:this={searchToggle}
        class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-content-muted hover:bg-surface-alt hover:text-content sh-compact-only"
        aria-label={mobileSearchOpen ? undefined : "Open search"}
        aria-controls="site-search"
        aria-expanded={mobileSearchOpen}
        on:click={toggleMobileSearch}
      >
        <!-- Open: one "Cancel" word, so the panel never shows two × buttons
             (the input keeps its own clear control). -->
        {#if mobileSearchOpen}
          Cancel
        {:else}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            class="h-5 w-5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path stroke-linecap="round" d="m16 16 4 4" />
          </svg>
        {/if}
      </button>

      <button
        type="button"
        bind:this={navToggle}
        class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-content-muted hover:bg-surface-alt hover:text-content sh-compact-only"
        aria-label={mobileNavOpen
          ? "Close navigation menu"
          : "Open navigation menu"}
        aria-controls="primary-navigation"
        aria-expanded={mobileNavOpen}
        on:click={() => {
          mobileNavOpen = !mobileNavOpen;
          mobileSearchOpen = false;
          open = false;
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          class="h-5 w-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          {#if mobileNavOpen}
            <path d="M6 6l12 12M18 6L6 18" />
          {:else}
            <path d="M4 7h16M4 12h16M4 17h16" />
          {/if}
        </svg>
      </button>

      <nav
        id="primary-navigation"
        class="order-3 mt-2 w-full flex-col divide-y divide-stroke border-t border-stroke {mobileNavOpen
          ? 'flex'
          : 'hidden'} sh-nav"
        aria-label="Primary navigation"
      >
        {#each primaryLinks as link}
          <a
            href={link.href}
            on:click={() => (mobileNavOpen = false)}
            aria-current={isCurrent($page.url.pathname, link.href)
              ? "page"
              : undefined}
            class:font-semibold={isCurrent($page.url.pathname, link.href)}
            class:text-content={isCurrent($page.url.pathname, link.href)}
            class="inline-flex min-h-11 items-center whitespace-nowrap px-2 py-3 text-base text-content-muted hover:text-content sh-nav-link"
          >
            {link.label}
          </a>
        {/each}
        {#if isAuthenticated}
          <a
            href="/admin/"
            on:click={() => (mobileNavOpen = false)}
            aria-current={isCurrent($page.url.pathname, "/admin/")
              ? "page"
              : undefined}
            class="inline-flex min-h-11 items-center whitespace-nowrap px-2 py-3 text-base text-content-muted hover:text-content sh-nav-link"
            >Admin</a
          >
        {/if}
      </nav>

      <div
        class="relative order-2 mt-2 w-full {mobileSearchOpen
          ? 'block'
          : 'hidden'} sh-search"
        bind:this={searchContainer}
      >
        <label class="sr-only" for="site-search"
          >Search elections and candidates</label
        >
        <div
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {searchStatus}
        </div>
        <input
          id="site-search"
          bind:this={searchInput}
          bind:value={query}
          on:input={handleInput}
          on:focus={() => {
            open = Boolean(query.trim());
            if (open) void ensureSearchRaces();
          }}
          on:keydown={handleKeydown}
          class="min-h-11 w-full rounded-full border border-stroke bg-surface-alt py-2 pl-4 pr-12 text-sm text-content focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary"
          placeholder="Search elections or candidates"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && totalMatches > 0}
          aria-controls={open && totalMatches > 0 ? resultsId : undefined}
          aria-activedescendant={activeIndex >= 0
            ? `site-search-option-${activeIndex}`
            : undefined}
        />
        {#if query}
          <button
            type="button"
            on:click={clearSearch}
            class="absolute inset-y-0 right-0 inline-flex min-h-11 min-w-11 items-center justify-center text-content-subtle hover:text-content"
            aria-label="Clear search"
            ><svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
            ></button
          >
        {/if}

        {#if open && totalMatches > 0}
          <div
            id={resultsId}
            class="absolute left-0 right-0 top-full z-50 mt-2 sh-panel max-h-96 overflow-y-auto rounded-xl border border-stroke bg-surface py-2 shadow-2xl"
            role="listbox"
          >
            {#if raceMatches.length}
              <div role="group" aria-labelledby="site-search-group-elections">
                <div
                  id="site-search-group-elections"
                  role="presentation"
                  class="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-content-subtle"
                >
                  Elections
                </div>
                {#each raceMatches as race, index}
                  <button
                    id={`site-search-option-${index}`}
                    type="button"
                    tabindex="-1"
                    on:click={() => selectRace(race.i)}
                    class:bg-surface-alt={index === activeIndex}
                    class="block min-h-11 w-full px-3 py-2 text-left text-xs text-content hover:bg-surface-alt"
                    role="option"
                    aria-selected={index === activeIndex}
                  >
                    <span class="block truncate font-medium">{race.t}</span>
                    <span class="block truncate text-content-subtle"
                      >{race.s}</span
                    >
                  </button>
                {/each}
              </div>
            {/if}
            {#if candidateMatches.length}
              <div role="group" aria-labelledby="site-search-group-candidates">
                <div
                  id="site-search-group-candidates"
                  role="presentation"
                  class="border-t border-stroke px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-content-subtle"
                >
                  Candidates
                </div>
                {#each candidateMatches as candidate, index}
                  {@const itemIndex = raceMatches.length + index}
                  <button
                    id={`site-search-option-${itemIndex}`}
                    type="button"
                    tabindex="-1"
                    on:click={() =>
                      selectCandidate(candidate.raceId, candidate.name)}
                    class:bg-surface-alt={itemIndex === activeIndex}
                    class="block min-h-11 w-full px-3 py-2 text-left text-xs text-content hover:bg-surface-alt"
                    role="option"
                    aria-selected={itemIndex === activeIndex}
                  >
                    <span class="block truncate font-medium"
                      >{candidate.name}</span
                    >
                    <span class="block truncate text-content-subtle"
                      >{[candidate.party, candidate.raceTitle]
                        .filter(Boolean)
                        .join(" · ")}</span
                    >
                  </button>
                {/each}
              </div>
            {/if}
            <button
              id={`site-search-option-${seeAllIndex}`}
              type="button"
              tabindex="-1"
              on:click={seeAllResults}
              class:bg-surface-alt={seeAllIndex === activeIndex}
              class="mt-1 block min-h-11 w-full border-t border-stroke px-3 py-2 text-left text-xs font-semibold text-primary-700 hover:bg-surface-alt dark:text-primary-300"
              role="option"
              aria-selected={seeAllIndex === activeIndex}
            >
              See all {results.totalRaces}
              {results.totalRaces === 1 ? "result" : "results"} &rarr;
            </button>
          </div>
        {:else if open && searchLoading}
          <div
            class="absolute left-0 right-0 top-full z-50 mt-2 sh-panel rounded-xl border border-stroke bg-surface px-4 py-3 text-xs text-content-subtle shadow-2xl"
            aria-hidden="true"
          >
            Loading search results&hellip;
          </div>
        {:else if open && searchLoaded && query.trim()}
          <!-- Not a dead end: offer the two other ways to find a race. -->
          <div
            class="absolute left-0 right-0 top-full z-50 mt-2 sh-panel rounded-xl border border-stroke bg-surface px-4 py-3 text-xs text-content-subtle shadow-2xl"
          >
            <p aria-hidden="true">No matching elections or candidates.</p>
            <ul class="mt-2 flex flex-wrap gap-x-4">
              <li>
                <a
                  href="/elections/"
                  class="inline-flex min-h-11 items-center font-semibold text-primary-700 hover:underline dark:text-primary-300"
                  >Browse all elections</a
                >
              </li>
              <li>
                <a
                  href="/my-ballot/"
                  class="inline-flex min-h-11 items-center font-semibold text-primary-700 hover:underline dark:text-primary-300"
                  >Find races by address</a
                >
              </li>
            </ul>
          </div>
        {:else if open && searchLoadError}
          <div
            class="absolute left-0 right-0 top-full z-50 mt-2 sh-panel rounded-xl border border-stroke bg-surface px-4 py-3 text-xs text-red-700 shadow-2xl dark:text-red-300"
            aria-hidden="true"
          >
            Search is temporarily unavailable. Press Enter to browse elections.
          </div>
        {/if}
      </div>

      <button
        type="button"
        on:click={onToggleDark}
        class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-content-muted hover:bg-surface-alt hover:text-content"
        aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          class="h-5 w-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          {#if darkMode}
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            />
          {:else}
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          {/if}
        </svg>
      </button>
    </div>
  </div>
</header>

<style>
  /*
   * The full inline header (nav links + search box) needs about 64em of
   * width. An em breakpoint (not Tailwind's px-based lg:) keeps the compact
   * header when the browser's text size is enlarged, so at 200% text the
   * search box and theme toggle no longer run off the right edge.
   * Scoped selectors outrank the mobile `hidden`/`flex` toggles.
   */
  @media (min-width: 64em) {
    .sh-row {
      flex-wrap: nowrap;
      gap: 0.75rem;
    }
    .sh-compact-only {
      display: none;
    }
    .sh-nav {
      order: 0;
      margin-top: 0;
      display: flex;
      width: auto;
      flex-direction: row;
      align-items: center;
      column-gap: 1rem;
      border-top-width: 0;
      font-size: 0.875rem;
      line-height: 1.25rem;
    }
    /* Undo the mobile divide-y separators (Tailwind v4 draws them as a
       border-bottom on every child but the last). */
    .sh-nav > :global(*) {
      border-top-width: 0;
      border-bottom-width: 0;
    }
    .sh-nav-link {
      padding: 0 0.25rem;
      font-size: 0.875rem;
      line-height: 1.25rem;
    }
    .sh-search {
      order: 0;
      margin-top: 0;
      display: block;
      width: 18rem;
    }
    .sh-panel {
      left: auto;
      width: 28rem;
      max-width: calc(100vw - 2rem);
    }
  }
</style>
