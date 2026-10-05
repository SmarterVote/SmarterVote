<script lang="ts">
  import { replaceState } from "$app/navigation";
  import { createEventDispatcher, onMount, tick } from "svelte";
  import BallotExplorer from "$lib/components/ballot/BallotExplorer.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { RaceSummary } from "$lib/types";
  import {
    lookupElectionGeography,
    matchingNationalRaces,
    normalizeDistrictCode,
  } from "$lib/services/electionLookup";
  import {
    abandonAddressSession,
    suggestUsAddresses,
    type AddressSuggestion,
  } from "$lib/services/googlePlaces";
  import { debounce } from "$lib/utils/debounce";
  import { canonicalStateName } from "$lib/utils/states";
  import { scrollBehavior } from "$lib/utils/motion";

  export let races: RaceSummary[] = [];
  /** True when the published race list could not be loaded at all. */
  export let loadError = false;
  const dispatch = createEventDispatcher<{ exploring: boolean }>();

  let address = "";
  let loading = false;
  let submitted = false;
  let state = "";
  let district = "";
  let results: RaceSummary[] = [];
  let error = "";
  let suggestions: AddressSuggestion[] = [];
  let suggestionsOpen = false;
  let activeSuggestionIndex = -1;
  let suggestionRequest = 0;

  const SESSION_KEY = "smarterVote.ballot";

  let addressInput: HTMLInputElement | undefined;
  let resultsHeading: HTMLHeadingElement | undefined;
  // Persistent polite live region: its text changes, the element never does,
  // so screen readers reliably announce lookup outcomes.
  let announcement = "";

  // sessionStorage can throw (privacy modes, blocked site data); the ballot
  // must keep working without it.
  function readSession(): string | null {
    try {
      return sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  function writeSession(value: string) {
    try {
      sessionStorage.setItem(SESSION_KEY, value);
    } catch {
      // Ignore: restoring the ballot on reload is a convenience.
    }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore.
    }
  }

  function resultsAnnouncement(count: number): string {
    if (loadError && races.length === 0)
      return "We couldn’t load the published election guides.";
    return count === 0
      ? "No matching Smarter.Vote guides are available yet for your district."
      : `Found ${count} ${count === 1 ? "race" : "races"} for your district.`;
  }

  const updateSuggestions = debounce(async (query: string, request: number) => {
    try {
      const matches = await suggestUsAddresses(query);
      if (request !== suggestionRequest) return;
      suggestions = matches;
      suggestionsOpen = matches.length > 0;
      activeSuggestionIndex = -1;
    } catch {
      if (request === suggestionRequest) {
        suggestions = [];
        suggestionsOpen = false;
        activeSuggestionIndex = -1;
      }
    }
  }, 600);

  $: isDistrictOfColumbia =
    (canonicalStateName(state) ?? state) === "District of Columbia";

  /**
   * On a phone the on-screen keyboard covers the lower half of the screen,
   * so bring the field (and the suggestions under it) to the top.
   */
  function handleAddressFocus() {
    suggestionsOpen = suggestions.length > 0;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 639px)").matches
    ) {
      addressInput?.scrollIntoView({
        behavior: scrollBehavior(),
        block: "start",
      });
    }
  }

  function handleAddressInput() {
    const request = ++suggestionRequest;
    if (address.trim().length < 5) {
      suggestions = [];
      suggestionsOpen = false;
      activeSuggestionIndex = -1;
      return;
    }
    updateSuggestions(address, request);
  }

  async function selectSuggestion(suggestion: AddressSuggestion) {
    suggestionsOpen = false;
    activeSuggestionIndex = -1;
    try {
      address = await suggestion.resolveAddress();
    } catch {
      address = suggestion.text;
      abandonAddressSession();
    }
    suggestions = [];
  }

  function handleAddressKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (!suggestionsOpen) return;
      event.preventDefault();
      suggestionsOpen = false;
      activeSuggestionIndex = -1;
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      suggestionsOpen = true;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      activeSuggestionIndex =
        (activeSuggestionIndex + direction + suggestions.length) %
        suggestions.length;
      return;
    }

    if (
      event.key === "Enter" &&
      suggestionsOpen &&
      activeSuggestionIndex >= 0
    ) {
      event.preventDefault();
      void selectSuggestion(suggestions[activeSuggestionIndex]);
    }
  }

  function restoreFromGeography(savedState: string, savedDistrict: string) {
    // Shared links may carry a postal code or any case (`?state=AK`).
    const normalizedState = canonicalStateName(savedState) ?? savedState.trim();
    // Accept every form earlier links used: "8", "08", "98" (D.C.), "al",
    // or the Census at-large text.
    const normalizedDistrict = normalizeDistrictCode(savedDistrict);
    if (!normalizedState || !normalizedDistrict) return false;

    state = normalizedState;
    district = normalizedDistrict;
    results = matchingNationalRaces(races, {
      state,
      congressionalDistrict: district,
    });
    submitted = true;
    dispatch("exploring", true);
    return true;
  }

  function updateShareableUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("state", state);
    url.searchParams.set("district", district);
    replaceState(url, {});
  }

  function districtLabel(value: string, dc: boolean): string {
    if (dc) return "Non-voting delegate district";
    return value === "00"
      ? "At-large congressional district"
      : `U.S. House District ${Number(value)}`;
  }

  onMount(() => {
    const url = new URL(window.location.href);
    const urlState = url.searchParams.get("state");
    const urlDistrict = url.searchParams.get("district");
    if (urlState && urlDistrict) {
      if (restoreFromGeography(urlState, urlDistrict)) return;
      // Unrecognised link: drop the stale parameters instead of leaving them
      // in a URL that would be shared on.
      url.searchParams.delete("state");
      url.searchParams.delete("district");
      replaceState(url, {});
    }

    try {
      const saved = JSON.parse(readSession() ?? "null") as {
        state?: string;
        district?: string;
        raceIds?: string[];
      } | null;
      if (!saved?.state || !saved.district || !Array.isArray(saved.raceIds))
        return;
      const restored = saved.raceIds
        .map((id) => races.find((race) => race.id === id))
        .filter((race): race is RaceSummary => Boolean(race));
      if (!restored.length) return;
      state = saved.state;
      district = saved.district;
      results = restored;
      submitted = true;
      dispatch("exploring", true);
      // SvelteKit initializes its router immediately after component mount.
      window.setTimeout(updateShareableUrl);
    } catch {
      clearSession();
    }
  });

  async function findElections() {
    const query = address.trim();
    if (!query || loading) return;
    loading = true;
    // Drop any pending or in-flight suggestion lookup so it cannot reopen the
    // listbox after the voter has submitted.
    updateSuggestions.cancel();
    suggestionRequest += 1;
    suggestions = [];
    suggestionsOpen = false;
    activeSuggestionIndex = -1;
    abandonAddressSession();
    submitted = false;
    error = "";
    results = [];
    announcement = "Looking up your district…";
    let found = false;
    try {
      const geography = await lookupElectionGeography(query);
      state = geography.state;
      district = geography.congressionalDistrict;
      results = matchingNationalRaces(races, geography);
      submitted = true;
      dispatch("exploring", true);
      writeSession(
        JSON.stringify({
          state,
          district,
          raceIds: results.map((race) => race.id),
        }),
      );
      updateShareableUrl();
      address = "";
      announcement = resultsAnnouncement(results.length);
      found = true;
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : "We could not look up that address.";
      announcement = "";
    } finally {
      loading = false;
    }
    if (found) {
      // Move focus to the new results so keyboard and screen-reader users are
      // not left on <body> after the form disappears.
      await tick();
      resultsHeading?.focus();
    }
  }

  async function searchAnotherAddress() {
    submitted = false;
    results = [];
    state = "";
    district = "";
    error = "";
    announcement = "";
    clearSession();
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("district");
    url.searchParams.delete("race");
    replaceState(url, {});
    dispatch("exploring", false);
    await tick();
    addressInput?.focus();
  }
</script>

<div class="min-w-0">
  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {announcement}
  </p>
  {#if !submitted}
    <div
      data-address-search-card
      class="card relative rounded-2xl p-5 shadow-lg sm:p-10"
    >
      <p class="eyebrow hidden sm:block">Address search</p>
      <h2
        class="text-xl font-bold tracking-tight text-content sm:mt-2 sm:text-3xl"
      >
        Where are you registered to vote?
      </h2>
      <p class="mt-2 text-sm leading-6 text-content-muted sm:hidden">
        Enter your full home address to see your House, Senate, and governor
        races.
      </p>
      <p class="mt-4 hidden max-w-xl leading-7 text-content-muted sm:block">
        Enter the full residential address where you are registered. We’ll
        identify your district and show the U.S. House, Senate, and governor
        research available for it.
      </p>

      <form class="mt-4 sm:mt-7" on:submit|preventDefault={findElections}>
        <label for="home-address" class="text-sm font-semibold text-content"
          >Home address</label
        >
        <div class="relative">
          <input
            id="home-address"
            bind:this={addressInput}
            bind:value={address}
            on:input={handleAddressInput}
            on:keydown={handleAddressKeydown}
            on:focus={handleAddressFocus}
            required
            autocomplete="street-address"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={suggestionsOpen ? "address-suggestions" : undefined}
            aria-expanded={suggestionsOpen}
            aria-activedescendant={suggestionsOpen && activeSuggestionIndex >= 0
              ? `address-suggestion-${suggestions[activeSuggestionIndex].id}`
              : undefined}
            placeholder="301 W 2nd St, Austin, TX 78701"
            class="mt-2 min-h-[60px] scroll-mt-24 w-full rounded-xl border border-stroke bg-surface px-5 text-base text-content shadow-xs transition placeholder:text-content-subtle hover:border-primary-300 focus:border-primary-500 focus:outline-hidden focus:ring-4 focus:ring-primary-500/15"
          />
          {#if suggestionsOpen}
            <div
              id="address-suggestions"
              role="listbox"
              class="relative z-20 mt-1 w-full overflow-hidden rounded-xl border border-stroke bg-surface py-1 shadow-xl"
            >
              {#each suggestions as suggestion, index}
                <button
                  id="address-suggestion-{suggestion.id}"
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestionIndex}
                  on:mouseenter={() => (activeSuggestionIndex = index)}
                  on:click={() => selectSuggestion(suggestion)}
                  class:bg-surface-alt={index === activeSuggestionIndex}
                  class="block min-h-11 w-full px-4 py-3 text-left text-sm text-content hover:bg-surface-alt focus:bg-surface-alt focus:outline-hidden"
                  >{suggestion.text}</button
                >
              {/each}
              <p
                class="border-t border-stroke px-4 py-1.5 text-right text-xs font-semibold text-content-subtle"
              >
                Powered by Google
              </p>
            </div>
          {/if}
        </div>
        <button
          type="submit"
          disabled={loading || !address.trim()}
          class="btn-primary mt-4 min-h-[56px] w-full rounded-xl text-base"
          >{loading ? "Finding your district…" : "Show my elections"}</button
        >
      </form>

      <p class="mt-4 flex gap-2 text-xs leading-5 text-content-subtle">
        <span aria-hidden="true">⌁</span>
        <span
          >Optional suggestions come directly from Google; completed addresses
          go directly to the U.S. Census Geocoder. Smarter.Vote does not save
          them.</span
        >
      </p>
      <div class="mt-4 border-t border-stroke pt-4 text-sm text-content-muted">
        <strong class="text-content">Coverage today:</strong> U.S. House,
        Senate, and governor research. This is not yet a complete local ballot.
        <a
          href="/elections/"
          class="ml-1 font-semibold text-primary-700 hover:underline dark:text-primary-300"
          >Browse national elections</a
        >
      </div>

      {#if loadError && races.length === 0}
        <div role="alert" class="alert-warn mt-5">
          <p class="font-semibold">
            We couldn’t load the published election guides.
          </p>
          <p class="mt-1">
            Address matching needs them. Please check your connection and
            <a
              href="/my-ballot/"
              class="font-semibold underline"
              data-sveltekit-reload>try again</a
            >.
          </p>
        </div>
      {/if}

      {#if error}
        <div role="alert" class="alert-warn mt-5">
          <p class="font-semibold">We couldn’t complete the lookup.</p>
          <p class="mt-1">
            {error} Check the full street, city, state, and ZIP, or browse by state.
          </p>
        </div>
      {/if}
    </div>
  {/if}

  {#if submitted}
    <section class="py-2 sm:py-4" aria-labelledby="ballot-results-heading">
      <div
        class="flex flex-col gap-5 border-b border-stroke pb-6 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <p class="eyebrow">
            {state} · {districtLabel(district, isDistrictOfColumbia)}
          </p>
          <h1
            id="ballot-results-heading"
            bind:this={resultsHeading}
            tabindex="-1"
            class="h-page mt-2 focus:outline-hidden"
          >
            Your election guide
          </h1>
          <p
            class="mt-2 max-w-3xl text-sm leading-6 text-content-muted sm:text-base"
          >
            Explore every published race we matched to your district. This is
            not a complete official ballot; confirm voting information with your
            election authority.
          </p>
          <p class="mt-3 text-sm leading-6 text-content-muted">
            Save or share this page's URL to return to this district.
            <a
              href="https://www.vote411.org/ballot"
              target="_blank"
              rel="noopener noreferrer"
              class="ml-1 font-semibold text-primary-700 hover:underline dark:text-primary-300"
              >See what's on your full ballot at VOTE411<span class="sr-only">
                (opens in a new tab)</span
              ></a
            >.
          </p>
        </div>
        <button
          type="button"
          on:click={searchAnotherAddress}
          class="btn-secondary shrink-0"
        >
          <UiIcon name="arrow-left" size="sm" /> Search another address
        </button>
      </div>
      {#if results.length}
        <BallotExplorer races={results} />
      {:else}
        <div
          class="mt-5 rounded-xl bg-surface-alt p-4 text-sm text-content-muted"
        >
          {#if loadError && races.length === 0}
            We identified your district, but the published election guides
            couldn’t be loaded. Please try again shortly.
          {:else if isDistrictOfColumbia}
            D.C. elects a non-voting delegate to the U.S. House; Smarter.Vote
            doesn’t cover that race yet.
          {:else}
            We identified your district, but no matching Smarter.Vote guide is
            available yet. This does not mean you have no elections.
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>
