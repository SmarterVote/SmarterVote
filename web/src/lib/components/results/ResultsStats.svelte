<script lang="ts">
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import type { LiveForecastFile } from "$lib/types";
  import {
    partyAbbr,
    partyBadgeClass,
    partyBarClass,
    partyRing,
  } from "$lib/utils/party";
  import {
    biggestLeads,
    chamberSeats,
    closestRaces,
    countingProgress,
    formatPctReporting,
    shortRaceTitle,
    sumSeats,
    upsetWatch,
    type ChamberSeats,
    type ResultStatsRow,
    type SeatCounts,
    type StatsChamber,
    type UpsetWatch,
  } from "$lib/utils/results";
  import ResultsCountedBar from "./ResultsCountedBar.svelte";
  import ResultsRaceTile from "./ResultsRaceTile.svelte";

  export let rows: ResultStatsRow[] = [];
  export let forecast: LiveForecastFile | null = null;

  const CHAMBERS: {
    id: StatsChamber;
    key: "senate" | "house" | "governors";
    label: string;
    unit: string;
  }[] = [
    { id: "senate", key: "senate", label: "Senate", unit: "seats" },
    { id: "house", key: "house", label: "House", unit: "seats" },
    { id: "governor", key: "governors", label: "Governors", unit: "states" },
  ];

  $: chambers = CHAMBERS.map((chamber) => ({
    ...chamber,
    seats: chamberSeats(rows, chamber.id, forecast?.chambers?.[chamber.key]),
  }));
  $: progress = countingProgress(rows);
  $: totalRaces = progress.reporting + progress.awaiting;
  $: bucketMax = Math.max(1, ...progress.buckets.map((b) => b.count));
  $: closest = closestRaces(rows);
  $: leads = biggestLeads(rows);
  $: upsets = upsetWatch(rows);
  $: anyCounting = progress.counting > 0;

  const pct = (part: number, whole: number) =>
    whole > 0 ? `${(part / whole) * 100}%` : "0%";

  function partyLine(
    label: string,
    called: number,
    leading: number,
    notUp: number,
  ): string {
    const bits = [`${label} ${called} called`];
    if (leading) bits.push(`${leading} leading`);
    if (notUp) bits.push(`${notUp} not up`);
    return bits.join(" + ");
  }

  function seatSummary(label: string, seats: ChamberSeats): string {
    const up = seats.total - sumSeats(seats.holdovers);
    const line = (party: keyof SeatCounts, name: string) =>
      `${name}: ${seats.called[party]} called, ${seats.leading[party]} leading${
        seats.holdovers[party] ? `, ${seats.holdovers[party]} not up` : ""
      }`;
    return [
      `${label}: ${up} of ${seats.total} up this year, ${seats.threshold} for a majority`,
      line("Democratic", "Democrats"),
      line("Republican", "Republicans"),
      ...(seats.called.Other || seats.leading.Other
        ? [line("Other", "Others")]
        : []),
      ...(seats.holdovers.Other
        ? [`${seats.holdovers.Other} seats not up this year`]
        : []),
      `${seats.open} with no call or lead yet`,
    ].join(". ");
  }

  function segments(seats: ChamberSeats) {
    return [
      { key: "d-hold", n: seats.holdovers.Democratic, cls: "seg-d-hold" },
      { key: "d-called", n: seats.called.Democratic, cls: "seg-d-called" },
      { key: "d-lead", n: seats.leading.Democratic, cls: "seg-d-lead" },
      { key: "o-called", n: seats.called.Other, cls: "seg-o-called" },
      { key: "o-lead", n: seats.leading.Other, cls: "seg-o-lead" },
      { key: "open", n: seats.open, cls: "seg-open" },
      { key: "hold-other", n: seats.holdovers.Other, cls: "seg-hold" },
      { key: "r-lead", n: seats.leading.Republican, cls: "seg-r-lead" },
      { key: "r-called", n: seats.called.Republican, cls: "seg-r-called" },
      { key: "r-hold", n: seats.holdovers.Republican, cls: "seg-r-hold" },
    ].filter((segment) => segment.n > 0);
  }

  const PANELS = [
    {
      id: "closest",
      title: "Closest races",
      note: "Still counting, narrowest lead first",
    },
    {
      id: "leads",
      title: "Biggest leads",
      note: "Still counting, widest lead first",
    },
  ] as const;

  /** The forecast pick and the actual leader, side by side on an upset card. */
  function upsetSides(race: UpsetWatch) {
    return [
      {
        label: "Forecast",
        name: race.predicted,
        party: race.predictedParty,
        image: race.predictedImage ?? null,
        // A forecast that names only a party has no headshot or badge.
        person: !!race.predicted && race.predicted !== race.predictedParty,
        muted: true,
      },
      {
        label: race.called ? "Won" : "Leading",
        name: race.leader,
        party: race.leaderParty,
        image: race.leaderImage ?? null,
        person: true,
        muted: false,
      },
    ];
  }
</script>

<section
  aria-labelledby="results-stats-heading"
  class="space-y-4"
  data-testid="results-stats"
>
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
    <h2 id="results-stats-heading" class="h-section">The night so far</h2>
    <ul
      class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-content-subtle"
      aria-label="Seat bar key"
    >
      <li class="inline-flex items-center gap-1.5">
        <span class="swatch seg-d-called" aria-hidden="true"></span>Called
      </li>
      <li class="inline-flex items-center gap-1.5">
        <span class="swatch seg-d-lead" aria-hidden="true"></span>Leading
      </li>
      <li class="inline-flex items-center gap-1.5">
        <span class="swatch seg-d-hold" aria-hidden="true"></span>Not up this
        year
      </li>
      <li class="inline-flex items-center gap-1.5">
        <span class="swatch seg-open" aria-hidden="true"></span>No result yet
      </li>
    </ul>
  </div>

  <div class="grid gap-3 lg:grid-cols-3">
    {#each chambers as chamber (chamber.id)}
      {@const s = chamber.seats}
      {@const up = s.total - sumSeats(s.holdovers)}
      <div class="card p-4" data-testid={`results-seats-${chamber.id}`}>
        <div class="flex flex-wrap items-baseline justify-between gap-x-2">
          <h3 class="text-sm font-bold text-content">{chamber.label}</h3>
          <span class="text-xs font-semibold text-content-subtle"
            >{up} {chamber.unit} up · {s.threshold} for a majority</span
          >
        </div>
        <div
          class="relative mt-6"
          role="img"
          aria-label={seatSummary(chamber.label, s)}
        >
          <div
            class="flex h-6 overflow-hidden rounded-lg border border-stroke/60 bg-surface-alt"
          >
            {#each segments(s) as segment (segment.key)}
              <div
                class="h-full transition-[width] duration-500 {segment.cls}"
                style="width: {pct(segment.n, s.total)}"
              ></div>
            {/each}
          </div>
          <div
            class="absolute -top-1.5 bottom-[-0.375rem] w-0.5 bg-yellow-500 dark:bg-yellow-400"
            style="left: {pct(s.threshold, s.total)}"
            aria-hidden="true"
          >
            <span
              class="absolute bottom-full mb-0.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-yellow-500 px-1 text-[11px] font-black leading-4 text-slate-950 dark:bg-yellow-400"
              >{s.threshold}</span
            >
          </div>
        </div>
        <div
          class="mt-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs font-semibold tabular-nums"
          aria-hidden="true"
        >
          <span class="text-blue-700 dark:text-blue-300"
            >{partyLine(
              "D",
              s.called.Democratic,
              s.leading.Democratic,
              s.holdovers.Democratic,
            )}</span
          >
          <span class="text-red-700 dark:text-red-300"
            >{partyLine(
              "R",
              s.called.Republican,
              s.leading.Republican,
              s.holdovers.Republican,
            )}</span
          >
        </div>
        {#if s.called.Other || s.leading.Other || s.holdovers.Other}
          <p
            class="mt-1 text-xs text-content-muted tabular-nums"
            aria-hidden="true"
          >
            {#if s.called.Other || s.leading.Other}
              {partyLine("Other", s.called.Other, s.leading.Other, 0)}
            {/if}
            {#if s.holdovers.Other}
              {s.holdovers.Other} not up this year
            {/if}
          </p>
        {/if}
      </div>
    {/each}
  </div>

  <div class="grid gap-3 lg:grid-cols-3">
    <div class="card flex flex-col p-4" data-testid="results-progress">
      <h3 class="text-sm font-bold text-content">Counting progress</h3>
      <p class="mt-2 flex items-baseline gap-2">
        <span class="text-4xl font-extrabold tabular-nums text-content"
          >{progress.averagePct === null
            ? "—"
            : formatPctReporting(progress.averagePct)}</span
        >
        <span class="text-xs leading-snug text-content-muted"
          >average counted in races still counting</span
        >
      </p>
      <div
        class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-alt"
        role="img"
        aria-label={`${progress.reporting} of ${totalRaces} races reporting, ${progress.awaiting} awaiting results`}
      >
        <div
          class="h-full rounded-full bg-emerald-600 transition-[width] duration-500 dark:bg-emerald-500"
          style="width: {pct(progress.reporting, totalRaces)}"
        ></div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2" aria-hidden="true">
        <div class="rounded-lg bg-surface-alt px-3 py-2">
          <p
            class="flex items-center gap-1.5 text-[11px] font-semibold text-content-subtle"
          >
            <span
              class="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-500"
            ></span>Reporting
          </p>
          <p class="text-lg font-bold tabular-nums text-content">
            {progress.reporting}
          </p>
        </div>
        <div class="rounded-lg bg-surface-alt px-3 py-2">
          <p
            class="flex items-center gap-1.5 text-[11px] font-semibold text-content-subtle"
          >
            <span class="h-2 w-2 rounded-full border border-content-subtle"
            ></span>Awaiting
          </p>
          <p class="text-lg font-bold tabular-nums text-content">
            {progress.awaiting}
          </p>
        </div>
      </div>
      {#if anyCounting}
        <table class="mt-4 w-full text-xs">
          <caption
            class="mb-1.5 text-left text-[11px] font-semibold text-content-subtle"
            >Races still counting, by share of the vote counted</caption
          >
          <tbody>
            {#each progress.buckets as bucket (bucket.label)}
              <tr>
                <th
                  scope="row"
                  class="w-20 whitespace-nowrap py-1 pr-2 text-left font-medium tabular-nums text-content-muted"
                  >{bucket.label}</th
                >
                <td class="py-1">
                  <div class="flex items-center gap-2">
                    <div
                      class="h-2 flex-1 overflow-hidden rounded-full bg-surface-alt"
                      aria-hidden="true"
                    >
                      <div
                        class="h-full min-w-0.5 rounded-full bg-amber-500 transition-[width] duration-500 dark:bg-amber-400"
                        style="width: {pct(bucket.count, bucketMax)}"
                      ></div>
                    </div>
                    <span
                      class="w-7 text-right font-semibold tabular-nums text-content"
                      >{bucket.count}</span
                    >
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="min-w-0 lg:col-span-2" data-testid="results-upsets">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 class="text-sm font-bold text-content">Upsets to watch</h3>
        <p class="text-xs text-content-subtle">
          Leader differs from our pre-election forecast
        </p>
      </div>
      {#if upsets.length}
        <ol class="mt-2 grid gap-2.5 sm:grid-cols-2">
          {#each upsets as race (race.id)}
            <li class="min-w-0">
              <a
                href={`/races/${race.id}/`}
                class="card group relative flex h-full flex-col gap-2.5 overflow-hidden p-3 pt-3.5 outline-hidden transition duration-150 hover:-translate-y-0.5 hover:border-primary-400/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-page motion-reduce:transform-none dark:hover:border-primary-500/60"
              >
                <span
                  class="absolute inset-x-0 top-0 flex h-1"
                  aria-hidden="true"
                >
                  <span
                    class="h-full w-1/2 opacity-50 {partyBarClass(
                      race.predictedParty,
                    )}"
                  ></span>
                  <span class="h-full w-1/2 {partyBarClass(race.leaderParty)}"
                  ></span>
                </span>
                <span class="flex items-start justify-between gap-2">
                  <span
                    class="min-w-0 text-sm font-semibold leading-snug text-content group-hover:text-primary-700 dark:group-hover:text-primary-300"
                    >{shortRaceTitle(race.title)}</span
                  >
                  <span
                    class="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 {race.called
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100'}"
                    >{race.called ? "Upset called" : "Possible upset"}</span
                  >
                </span>
                <span class="grid grid-cols-2 gap-2">
                  {#each upsetSides(race) as side (side.label)}
                    <span
                      class="relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg bg-surface-alt py-2 pl-3 pr-2"
                    >
                      <span
                        class="absolute inset-y-0 left-0 w-1 {partyBarClass(
                          side.party,
                        )} {side.muted ? 'opacity-50' : ''}"
                        aria-hidden="true"
                      ></span>
                      <span
                        class="text-[10px] font-bold uppercase tracking-wide text-content-subtle"
                        >{side.label}<span class="sr-only">:</span></span
                      >
                      <span class="flex min-w-0 items-center gap-2">
                        {#if side.person}
                          <CandidateAvatar
                            name={side.name}
                            imageUrl={side.image}
                            size={28}
                            class="ring-2 ring-offset-1 ring-offset-surface {partyRing(
                              side.party,
                            )} {side.muted ? 'opacity-75 grayscale' : ''}"
                          />
                        {/if}
                        <span class="min-w-0">
                          <span
                            class="line-clamp-2 text-xs font-semibold leading-tight break-words {side.muted
                              ? 'text-content-muted'
                              : 'text-content'}"
                            title={side.name}>{side.name}</span
                          >
                          {#if side.party && side.person}
                            <span
                              class="mt-0.5 inline-block rounded-sm px-1 py-px text-[10px] font-bold leading-4 {partyBadgeClass(
                                side.party,
                              )}"
                              title={side.party}
                              ><span class="sr-only">Party:&nbsp;</span
                              >{partyAbbr(side.party)}</span
                            >
                          {/if}
                        </span>
                      </span>
                    </span>
                  {/each}
                </span>
                <div class="mt-auto">
                  <ResultsCountedBar pct={race.pctReporting} />
                </div>
              </a>
            </li>
          {/each}
        </ol>
      {:else}
        <p
          class="mt-2 rounded-xl border border-dashed border-stroke p-4 text-sm text-content-muted"
        >
          {anyCounting || progress.reporting
            ? "Every leader so far matches the forecast."
            : "Shows up once votes are counted."}
        </p>
      {/if}
    </div>
  </div>

  {#each PANELS as panel (panel.id)}
    {@const list = panel.id === "closest" ? closest : leads}
    <div class="min-w-0" data-testid={`results-${panel.id}`}>
      <div class="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 class="text-sm font-bold text-content">{panel.title}</h3>
        <p class="text-xs text-content-subtle">{panel.note}</p>
      </div>
      {#if list.length}
        <ol
          class="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        >
          {#each list as race (race.id)}
            <li class="min-w-0">
              <ResultsRaceTile
                id={race.id}
                title={shortRaceTitle(race.title)}
                group="counting"
                leader={race.leader}
                party={race.party}
                margin={race.margin}
                pctReporting={race.pctReporting}
                contenders={race.contenders}
              />
            </li>
          {/each}
        </ol>
      {:else}
        <p
          class="mt-2 rounded-xl border border-dashed border-stroke p-4 text-sm text-content-muted"
        >
          No contested race is counting yet.
        </p>
      {/if}
    </div>
  {/each}
</section>

<style>
  .swatch {
    display: inline-block;
    height: 0.625rem;
    width: 1rem;
    border-radius: 0.125rem;
  }
  .seg-d-called {
    background: #2563eb;
  }
  .seg-r-called {
    background: #dc2626;
  }
  .seg-o-called {
    background: #64748b;
  }
  .seg-d-lead,
  .seg-r-lead,
  .seg-o-lead {
    background-image: repeating-linear-gradient(
      135deg,
      rgb(255 255 255 / 0.35) 0 3px,
      transparent 3px 6px
    );
  }
  .seg-d-lead {
    background-color: #60a5fa;
  }
  .seg-r-lead {
    background-color: #f87171;
  }
  .seg-o-lead {
    background-color: #94a3b8;
  }
  .seg-d-hold {
    background: #bfdbfe;
  }
  .seg-r-hold {
    background: #fecaca;
  }
  .seg-hold {
    background: #cbd5e1;
  }
  .seg-open {
    background: transparent;
  }
  .swatch.seg-open {
    border: 1px solid rgb(148 163 184 / 0.7);
  }
  :global(.dark) .seg-d-called {
    background: #3b82f6;
  }
  :global(.dark) .seg-r-called {
    background: #ef4444;
  }
  :global(.dark) .seg-d-lead {
    background-color: #1d4ed8;
  }
  :global(.dark) .seg-r-lead {
    background-color: #b91c1c;
  }
  :global(.dark) .seg-o-lead {
    background-color: #475569;
  }
  :global(.dark) .seg-d-hold {
    background: #1e3a8a;
  }
  :global(.dark) .seg-r-hold {
    background: #7f1d1d;
  }
  :global(.dark) .seg-hold {
    background: #334155;
  }
</style>
