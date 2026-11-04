<script lang="ts">
  import ResultRaceCard from "$lib/components/results/ResultRaceCard.svelte";
  import ResultsBalanceOfPower from "$lib/components/results/ResultsBalanceOfPower.svelte";
  import ResultsMap from "$lib/components/results/ResultsMap.svelte";
  import ResultsStats from "$lib/components/results/ResultsStats.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { PublicRaceResult } from "$lib/types";
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
    type ResultOffice,
  } from "$lib/utils/results";
  import type { PageData } from "./$types";

  export let data: PageData;

  type Row = ResultDirectoryRace & { result: PublicRaceResult | null };
  type Filter = "all" | ResultGroup;
  type OfficeFilter = "all" | ResultOffice;

  const DESCRIPTION =
    "Unofficial 2026 election results with sources, linked to where each candidate stands on the issues.";
  const TILES: { id: ResultGroup; label: string }[] = [
    { id: "called", label: "Called" },
    { id: "counting", label: "Still counting" },
    { id: "pending", label: "Runoff or ranked-choice" },
    { id: "awaiting", label: "Awaiting results" },
  ];
  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All races" },
    ...TILES,
  ];
  const OFFICES: { id: OfficeFilter; label: string }[] = [
    { id: "all", label: "All offices" },
    { id: "governor", label: "Governor" },
    { id: "senate", label: "Senate" },
    { id: "house", label: "House" },
  ];
  const KEY_RACES = "Key races";
  const REPORTING = "Results coming in";
  const priorityIds = new Set(PRIORITY_RESULT_RACES.map((race) => race.id));
  const pill = (active: boolean) =>
    `min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
      active
        ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200"
        : "border-stroke bg-surface text-content-muted hover:bg-surface-alt"
    }`;

  let filter: Filter = "all";
  let office: OfficeFilter = "all";
  let stateFilter = "all";
  let competitiveOnly = false;
  let query = "";

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
  $: needle = query.trim().toLocaleLowerCase();
  $: narrowed =
    office !== "all" ||
    stateFilter !== "all" ||
    competitiveOnly ||
    needle !== "";
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
  // Key races lead the unfiltered page, then every race already reporting
  // (newest first) so counts are not buried among hundreds of empty cards;
  // any narrowing shows plain state groups with reporting races first.
  $: groups = [
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
  ].filter((group) => group.rows.length > 0);
  $: updatedAt = $liveResultsState.updatedAt?.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  function reset() {
    filter = "all";
    office = "all";
    stateFilter = "all";
    competitiveOnly = false;
    query = "";
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
    <div
      class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-content-subtle"
      aria-live="polite"
    >
      {#if $liveResultsState.status === "error"}
        <span class="text-amber-700 dark:text-amber-300"
          >Live updates are unavailable right now{updatedAt
            ? `. Last updated ${updatedAt}`
            : ""}</span
        >
      {:else if updatedAt}
        <span class="inline-flex items-center gap-1.5">
          <span
            class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
            aria-hidden="true"
          ></span>
          Updated {updatedAt}, refreshes each minute
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

  <ResultsStats {rows} forecast={$liveForecast} />

  <ResultsBalanceOfPower file={$liveForecast} />
  <ResultsMap races={rows} />

  <div class="space-y-3">
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
      <span class="text-sm text-content-subtle" aria-live="polite"
        >{visible.length} of {rows.length} races</span
      >
      {#if narrowed || filter !== "all"}
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
          <ResultRaceCard id={row.id} title={row.title} result={row.result} />
        {/each}
      </div>
    </section>
  {:else}
    <p class="alert-info">No races match these filters.</p>
  {/each}
</div>
