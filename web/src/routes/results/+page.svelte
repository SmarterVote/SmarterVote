<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { afterNavigate, replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import ResultRaceCard from "$lib/components/results/ResultRaceCard.svelte";
  import ResultsBalanceOfPower from "$lib/components/results/ResultsBalanceOfPower.svelte";
  import ResultsKeyRaces from "$lib/components/results/ResultsKeyRaces.svelte";
  import ResultsLatestCalls from "$lib/components/results/ResultsLatestCalls.svelte";
  import ResultsMap from "$lib/components/results/ResultsMap.svelte";
  import ResultsStats from "$lib/components/results/ResultsStats.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { PublicRaceResult } from "$lib/types";
  import { debounce } from "$lib/utils/debounce";
  import { liveForecast } from "$lib/utils/liveForecast";
  import { canonicalRaceState } from "$lib/utils/states";
  import {
    PRIORITY_RESULT_RACES,
    liveResults,
    liveResultsState,
    resultGroup,
    resultOffice,
    type ResultDirectoryRace,
    type ResultGroup,
  } from "$lib/utils/results";
  import {
    RESULT_SORTS,
    capSection,
    formatAgo,
    isStale,
    keyRaces,
    latestCalls,
    limitAwaiting,
    nextStep,
    parseResultsQuery,
    resultsQueryString,
    showMoreLabel,
    sortResultsRows,
    type OfficeFilter,
    type ResultSort,
    type StatusFilter,
  } from "$lib/utils/resultsPage";
  import type { PageData } from "./$types";

  export let data: PageData;

  type Row = ResultDirectoryRace & { result: PublicRaceResult | null };

  const DESCRIPTION =
    "Unofficial 2026 election results with sources, linked to where each candidate stands on the issues.";
  const TILES: { id: ResultGroup; label: string }[] = [
    { id: "called", label: "Called" },
    { id: "counting", label: "Still counting" },
    { id: "pending", label: "Runoff or ranked-choice" },
    { id: "awaiting", label: "No results collected yet" },
  ];
  const FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All races" },
    ...TILES,
  ];
  const OFFICES: { id: OfficeFilter; label: string }[] = [
    { id: "all", label: "All offices" },
    { id: "governor", label: "Governor" },
    { id: "senate", label: "Senate" },
    { id: "house", label: "House" },
  ];
  // Not "Key races": the strip at the top is "Key Senate and governor races".
  const KEY_RACES = "Priority races";
  const REPORTING = "Results coming in";
  /** Awaiting-results cards drawn up front; the rest wait behind a button. */
  const AWAITING_FIRST = 24;
  const AWAITING_STEP = 96;
  /**
   * Cards per list section drawn up front. "Results coming in" alone held
   * about 370 cards (55k px at desktop width, far more on a phone), so every
   * section starts short and grows behind its own "Show more" button.
   */
  const SECTION_FIRST = 24;
  const SECTION_STEP = 48;
  const priorityIds = new Set(PRIORITY_RESULT_RACES.map((race) => race.id));
  const isPriority = (id: string) => priorityIds.has(id);
  const pill = (active: boolean) =>
    `min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
      active
        ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200"
        : "border-stroke bg-surface text-content-muted hover:bg-surface-alt"
    }`;

  let filter: StatusFilter = "all";
  let office: OfficeFilter = "all";
  let stateFilter = "all";
  let competitiveOnly = false;
  let query = "";
  let sort: ResultSort = "default";
  let awaitingLimit = AWAITING_FIRST;
  let sectionLimits: Record<string, number> = {};
  let now = Date.now();
  let urlReady = false;
  let clock: ReturnType<typeof setInterval> | undefined;

  // The prerendered list names every race on the ballot; the live feed fills in
  // results and adds any race the list missed (a build before it was published).
  $: directory = new Map<string, ResultDirectoryRace>(
    [
      ...PRIORITY_RESULT_RACES.map((race) => ({
        ...race,
        office: resultOffice(race.title, race.id),
        competitive: true,
      })),
      ...data.races,
    ].map((race) => [race.id, race]),
  );
  $: rows = [
    ...[...directory.values()].map((race): Row => ({
      ...race,
      result: $liveResults.get(race.id) ?? null,
    })),
    ...[...$liveResults.values()]
      .filter((row) => !directory.has(row.id))
      .map((row): Row => ({
        id: row.id,
        title: row.title ?? row.id,
        state: canonicalRaceState({ id: row.id }) ?? "Other",
        office: resultOffice(row.title, row.id),
        competitive: false,
        result: row,
      })),
  ];
  $: states = [...new Set(rows.map((row) => row.state))].sort();
  $: counts = rows.reduce<Record<ResultGroup, number>>(
    (totals, row) => {
      totals[resultGroup(row.result?.status)] += 1;
      return totals;
    },
    { called: 0, counting: 0, pending: 0, awaiting: 0 },
  );
  // Call times past the feed's own clock are data errors (see latestCalls).
  $: calls = latestCalls(
    rows,
    8,
    $liveResultsState.generatedAt ?? $liveResultsState.updatedAt ?? now,
  );
  $: keyRaceRows = keyRaces(rows, isPriority, 12);
  $: needle = query.trim().toLocaleLowerCase();
  $: narrowed =
    office !== "all" ||
    stateFilter !== "all" ||
    competitiveOnly ||
    needle !== "";
  // Filters always run over every race; only drawing the cards is capped.
  $: visible = rows.filter(
    (row) =>
      (filter === "all" || resultGroup(row.result?.status) === filter) &&
      (office === "all" || row.office === office) &&
      (stateFilter === "all" || row.state === stateFilter) &&
      (!competitiveOnly || row.competitive || priorityIds.has(row.id)) &&
      (needle === "" ||
        `${row.title} ${row.state} ${(row.result?.candidates ?? [])
          .map((c) => c.name)
          .join(" ")}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const hasCount = (row: Row) => resultGroup(row.result?.status) !== "awaiting";
  const newestFirst = (a: Row, b: Row) =>
    String(b.result?.as_of ?? "").localeCompare(String(a.result?.as_of ?? ""));
  const sortLabel = (id: ResultSort) =>
    RESULT_SORTS.find((option) => option.id === id)?.label ?? "";
  // Default order: key races lead the unfiltered page, then every race
  // already reporting (newest first) so counts are not buried among hundreds
  // of empty cards; any narrowing shows plain state groups with reporting
  // races first. Any other sort is one flat list.
  $: sections =
    sort !== "default"
      ? [
          {
            state: `Sorted by ${sortLabel(sort).toLocaleLowerCase()}`,
            rows: sortResultsRows(visible, sort),
          },
        ]
      : [
          ...(narrowed
            ? []
            : [
                {
                  state: KEY_RACES,
                  rows: visible.filter((row) => priorityIds.has(row.id)),
                },
                {
                  state: REPORTING,
                  rows: visible
                    .filter((row) => !priorityIds.has(row.id) && hasCount(row))
                    .sort(newestFirst),
                },
              ]),
          ...states.map((state) => ({
            state,
            rows: visible
              .filter(
                (row) =>
                  row.state === state &&
                  (narrowed || (!priorityIds.has(row.id) && !hasCount(row))),
              )
              .sort((a, b) => Number(hasCount(b)) - Number(hasCount(a))),
          })),
        ];
  // Every reporting race is drawn; awaiting cards past the limit wait behind
  // "Show more" so first paint stays light on phones.
  $: capped = limitAwaiting(
    sections.flatMap((section) =>
      section.rows.map((row) => ({
        section: section.state,
        row,
        result: row.result,
      })),
    ),
    awaitingLimit,
  );
  $: groups = sections
    .map((section) => {
      const all = capped.rows
        .filter((item) => item.section === section.state)
        .map((item) => item.row);
      // The priority list is ten races; every other section is capped.
      const shown =
        section.state === KEY_RACES
          ? { rows: all, hidden: 0 }
          : capSection(all, sectionLimits[section.state] ?? SECTION_FIRST);
      return { state: section.state, ...shown };
    })
    .filter((group) => group.rows.length > 0);
  $: hiddenCount = capped.hidden;
  // A new filter or sort starts the awaiting list short again.
  $: resetAwaiting(filter, office, stateFilter, competitiveOnly, needle, sort);

  $: updatedAt = $liveResultsState.updatedAt?.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  // The feed's own timestamp goes stale when the pipeline stalls, even while
  // this tab keeps fetching the same file each minute.
  $: feedTime = $liveResultsState.generatedAt ?? $liveResultsState.updatedAt;
  $: feedAgo = formatAgo(feedTime, now);
  $: stale = isStale(feedTime, now);

  const writeUrl = debounce((search: string) => {
    if (search === window.location.search) return;
    const url = new URL(window.location.href);
    url.search = search;
    replaceState(url, $page.state);
  }, 250);
  $: if (urlReady)
    writeUrl(
      resultsQueryString({
        status: filter,
        office,
        state: stateFilter,
        competitive: competitiveOnly,
        q: query,
        sort,
      }),
    );

  function resetAwaiting(..._deps: unknown[]) {
    awaitingLimit = AWAITING_FIRST;
    sectionLimits = {};
  }

  function showMoreIn(section: string, hidden: number) {
    sectionLimits = {
      ...sectionLimits,
      [section]:
        (sectionLimits[section] ?? SECTION_FIRST) +
        nextStep(hidden, SECTION_STEP),
    };
  }

  // Read the query in the browser (the page is prerendered without one), on
  // load and on in-page links such as a House map state. Typing only writes
  // the URL shallowly, which is not a navigation, so it never echoes back.
  afterNavigate(({ to }) => {
    writeUrl.cancel();
    const initial = parseResultsQuery(
      to?.url.searchParams ?? new URLSearchParams(window.location.search),
      states,
    );
    filter = initial.status;
    office = initial.office;
    stateFilter = initial.state;
    competitiveOnly = initial.competitive;
    query = initial.q;
    sort = initial.sort;
    urlReady = true;
  });

  onMount(() => {
    now = Date.now();
    clock = setInterval(() => (now = Date.now()), 30_000);
  });
  onDestroy(() => {
    if (clock) clearInterval(clock);
    writeUrl.cancel();
  });

  function reset() {
    filter = "all";
    office = "all";
    stateFilter = "all";
    competitiveOnly = false;
    query = "";
    sort = "default";
  }
</script>

<svelte:head>
  <title>2026 Election Results | Smarter.Vote</title>
  <meta name="description" content={DESCRIPTION} />
  <link rel="canonical" href="https://smarter.vote/results/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Smarter.Vote" />
  <meta property="og:url" content="https://smarter.vote/results/" />
  <meta property="og:title" content="2026 Election Results | Smarter.Vote" />
  <meta property="og:description" content={DESCRIPTION} />
  <meta property="og:image" content="https://smarter.vote/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="2026 Election Results | Smarter.Vote" />
  <meta name="twitter:description" content={DESCRIPTION} />
  <meta name="twitter:image" content="https://smarter.vote/og-image.png" />
</svelte:head>

<div class="page-container space-y-8 py-8 sm:py-10">
  <header>
    <h1 class="h-page">2026 Election Results</h1>
    <p class="mt-2 max-w-3xl text-base text-content-muted">
      Follow the count, then see where the candidates stand. Results stay
      unofficial until each state certifies them, and we name a winner only when
      a named organization has called the race and two independent sources
      report it.
    </p>
    <!-- Only the state (live, behind, unavailable) is announced; the
         "N min ago" text re-renders every 30 seconds, so it sits outside
         the live region. -->
    <div
      class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-content-subtle"
    >
      <span class="sr-only" aria-live="polite"
        >{$liveResultsState.status === "error"
          ? "Live updates are unavailable right now."
          : stale
            ? ""
            : updatedAt
              ? "Live results."
              : ""}</span
      >
      {#if $liveResultsState.status === "error"}
        <span class="text-amber-700 dark:text-amber-300"
          >Live updates are unavailable right now{updatedAt
            ? `. Last updated ${updatedAt}`
            : ""}</span
        >
      {:else if stale}
        <span data-testid="results-updated">Updated {feedAgo}</span>
      {:else if updatedAt}
        <span
          class="inline-flex items-center gap-1.5"
          data-testid="results-live"
        >
          <span
            class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
            aria-hidden="true"
          ></span>
          Live · updated {feedAgo || updatedAt}, checked each minute
        </span>
      {:else}
        <span>Checking for results…</span>
      {/if}
      <span aria-hidden="true">·</span>
      <a
        href="/corrections/"
        class="inline-flex items-center gap-1.5 text-primary-700 hover:underline dark:text-primary-300"
        >Report an error <UiIcon name="arrow-right" size="sm" /></a
      >
    </div>
  </header>

  <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {#each TILES as tile (tile.id)}
      <div class="card p-4">
        <dt class="text-xs font-semibold text-content-subtle">{tile.label}</dt>
        <dd class="mt-1 text-3xl font-bold tabular-nums text-content">
          {counts[tile.id]}
        </dd>
      </div>
    {/each}
  </dl>

  <div class="grid gap-6 lg:grid-cols-3">
    <div class="lg:col-span-2">
      <ResultsKeyRaces races={keyRaceRows} />
    </div>
    <ResultsLatestCalls {calls} {now} />
  </div>

  <ResultsStats {rows} forecast={$liveForecast} {now} />

  <ResultsBalanceOfPower file={$liveForecast} />
  <ResultsMap races={rows} />

  <div class="scroll-mt-20 space-y-3" id="results-list">
    <div
      class="flex flex-wrap gap-2"
      role="group"
      aria-label="Filter by status"
    >
      {#each FILTERS as option (option.id)}
        <button
          type="button"
          class={pill(filter === option.id)}
          aria-pressed={filter === option.id}
          on:click={() => (filter = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
    <div
      class="flex flex-wrap gap-2"
      role="group"
      aria-label="Filter by office"
    >
      {#each OFFICES as option (option.id)}
        <button
          type="button"
          class={pill(office === option.id)}
          aria-pressed={office === option.id}
          on:click={() => (office = option.id)}
        >
          {option.label}
        </button>
      {/each}
      <button
        type="button"
        class={pill(competitiveOnly)}
        aria-pressed={competitiveOnly}
        on:click={() => (competitiveOnly = !competitiveOnly)}
      >
        Competitive only
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <label class="sr-only" for="results-state">State</label>
      <select
        id="results-state"
        class="min-h-11 rounded-lg border border-stroke bg-surface px-3 text-sm text-content"
        bind:value={stateFilter}
      >
        <option value="all">All states</option>
        {#each states as state (state)}
          <option value={state}>{state}</option>
        {/each}
      </select>
      <label class="sr-only" for="results-search">Search races</label>
      <input
        id="results-search"
        type="search"
        placeholder="Search a race or candidate"
        class="min-h-11 w-full max-w-xs rounded-lg border border-stroke bg-surface px-3 text-sm text-content"
        bind:value={query}
      />
      <label class="sr-only" for="results-sort">Sort races</label>
      <select
        id="results-sort"
        class="min-h-11 rounded-lg border border-stroke bg-surface px-3 text-sm text-content"
        bind:value={sort}
      >
        {#each RESULT_SORTS as option (option.id)}
          <option value={option.id}>Sort: {option.label}</option>
        {/each}
      </select>
      <span class="text-sm text-content-subtle" aria-live="polite"
        >{visible.length} of {rows.length} races</span
      >
      {#if narrowed || filter !== "all" || sort !== "default"}
        <button
          type="button"
          class="min-h-11 px-2 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"
          on:click={reset}>Clear filters</button
        >
      {/if}
    </div>
  </div>

  {#each groups as group (group.state)}
    <section aria-label={group.state}>
      <h2 class="h-section mb-4">{group.state}</h2>
      <div class="grid gap-4 md:grid-cols-2">
        {#each group.rows as row (row.id)}
          <ResultRaceCard
            id={row.id}
            title={row.title}
            result={row.result}
            {now}
          />
        {/each}
      </div>
      {#if group.hidden > 0}
        <div class="mt-4 flex justify-center">
          <button
            type="button"
            class={pill(false)}
            data-testid="section-show-more"
            on:click={() => showMoreIn(group.state, group.hidden)}
          >
            {showMoreLabel(group.hidden, SECTION_STEP)}
            <span class="sr-only"> in {group.state}</span>
          </button>
        </div>
      {/if}
    </section>
  {:else}
    <p class="alert-info">No races match these filters.</p>
  {/each}

  {#if hiddenCount > 0}
    <div class="flex flex-col items-center gap-2 text-center">
      <p class="text-sm text-content-muted">
        {hiddenCount} more {hiddenCount === 1 ? "race has" : "races have"} no results
        collected yet. Search and filters cover every race.
      </p>
      <button
        type="button"
        class={pill(false)}
        on:click={() => (awaitingLimit += nextStep(hiddenCount, AWAITING_STEP))}
      >
        {showMoreLabel(hiddenCount, AWAITING_STEP)}
      </button>
    </div>
  {/if}
</div>
