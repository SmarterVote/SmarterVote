<script lang="ts">
  import ResultRaceCard from "$lib/components/results/ResultRaceCard.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { PublicRaceResult } from "$lib/types";
  import {
    PRIORITY_RESULT_RACES,
    liveResults,
    liveResultsState,
    resultGroup,
    type ResultGroup,
  } from "$lib/utils/results";

  type Row = {
    id: string;
    title: string;
    state: string;
    result: PublicRaceResult | null;
  };
  type Filter = "all" | ResultGroup;

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
  const priorityIds = new Set(PRIORITY_RESULT_RACES.map((race) => race.id));

  let filter: Filter = "all";

  $: rows = [
    ...PRIORITY_RESULT_RACES.map((race): Row => ({
      ...race,
      result: $liveResults.get(race.id) ?? null,
    })),
    ...[...$liveResults.values()]
      .filter((row) => !priorityIds.has(row.id))
      .map((row): Row => ({
        id: row.id,
        title: row.title ?? row.id,
        state: "More races",
        result: row,
      })),
  ];
  $: counts = rows.reduce<Record<ResultGroup, number>>(
    (totals, row) => {
      totals[resultGroup(row.result?.status)] += 1;
      return totals;
    },
    { called: 0, counting: 0, pending: 0, awaiting: 0 },
  );
  $: visible = rows.filter(
    (row) => filter === "all" || resultGroup(row.result?.status) === filter,
  );
  $: groups = [...new Set(visible.map((row) => row.state))].map((state) => ({
    state,
    rows: visible.filter((row) => row.state === state),
  }));
  $: updatedAt = $liveResultsState.updatedAt?.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
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

  <div class="flex flex-wrap gap-2" role="group" aria-label="Filter races">
    {#each FILTERS as option (option.id)}
      <button
        type="button"
        class="min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors {filter ===
        option.id
          ? 'border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200'
          : 'border-stroke bg-surface text-content-muted hover:bg-surface-alt'}"
        aria-pressed={filter === option.id}
        on:click={() => (filter = option.id)}
      >
        {option.label}
      </button>
    {/each}
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
    <p class="alert-info">No races match this filter yet.</p>
  {/each}
</div>
