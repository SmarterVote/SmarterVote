<script lang="ts">
  import type { LiveForecastFile } from "$lib/types";
  import { partyAbbr, partyBadgeClass } from "$lib/utils/party";
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
    type RaceMargin,
    type ResultStatsRow,
    type SeatCounts,
    type StatsChamber,
  } from "$lib/utils/results";

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

  function margin(value: number): string {
    if (value <= 0) return "Tied";
    if (value < 0.1) return "+<0.1";
    return `+${value.toFixed(1)}`;
  }

  function surname(name: string): string {
    const parts = name.trim().split(/\s+/);
    const last = parts[parts.length - 1] ?? name;
    return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && parts.length > 1
      ? parts[parts.length - 2]
      : last;
  }

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

  function reportingLabel(race: RaceMargin): string {
    const shown = formatPctReporting(race.pctReporting);
    return shown ? `${shown} counted` : "share counted unknown";
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

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div class="card p-4" data-testid="results-progress">
      <h3 class="text-sm font-bold text-content">Counting progress</h3>
      <p class="mt-2 flex items-baseline gap-2">
        <span class="text-3xl font-bold tabular-nums text-content"
          >{progress.averagePct === null
            ? "—"
            : formatPctReporting(progress.averagePct)}</span
        >
        <span class="text-xs text-content-muted"
          >average counted in races still counting</span
        >
      </p>
      <div
        class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-alt"
        role="img"
        aria-label={`${progress.reporting} of ${totalRaces} races reporting, ${progress.awaiting} awaiting results`}
      >
        <div
          class="h-full bg-emerald-600 dark:bg-emerald-500"
          style="width: {pct(progress.reporting, totalRaces)}"
        ></div>
      </div>
      <p
        class="mt-1.5 flex justify-between text-xs font-semibold tabular-nums text-content-subtle"
        aria-hidden="true"
      >
        <span>{progress.reporting} reporting</span>
        <span>{progress.awaiting} awaiting</span>
      </p>
      {#if anyCounting}
        <table class="mt-3 w-full text-xs">
          <caption class="sr-only"
            >Races still counting, by share of the vote counted</caption
          >
          <tbody>
            {#each progress.buckets as bucket (bucket.label)}
              <tr>
                <th
                  scope="row"
                  class="w-20 whitespace-nowrap py-0.5 pr-2 text-left font-medium text-content-muted"
                  >{bucket.label}</th
                >
                <td class="py-0.5">
                  <div class="flex items-center gap-2">
                    <div
                      class="h-2 min-w-0.5 rounded-sm bg-amber-500 dark:bg-amber-400"
                      style="width: {pct(bucket.count, bucketMax)}"
                      aria-hidden="true"
                    ></div>
                    <span class="tabular-nums font-semibold text-content"
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

    {#each [{ id: "closest", title: "Closest races", list: closest, empty: "No contested race is counting yet." }, { id: "leads", title: "Biggest leads", list: leads, empty: "No contested race is counting yet." }] as panel (panel.id)}
      <div class="card p-4" data-testid={`results-${panel.id}`}>
        <h3 class="text-sm font-bold text-content">{panel.title}</h3>
        <p class="text-xs text-content-muted">Still counting, lead in points</p>
        {#if panel.list.length}
          <ol class="mt-2 divide-y divide-stroke/60">
            {#each panel.list as race (race.id)}
              <li class="py-1.5">
                <a
                  href={`/races/${race.id}/`}
                  class="group flex items-start justify-between gap-2"
                >
                  <span class="min-w-0">
                    <span
                      class="block truncate text-sm font-semibold text-content group-hover:text-primary-700 group-hover:underline dark:group-hover:text-primary-300"
                      >{shortRaceTitle(race.title)}</span
                    >
                    <span class="block text-xs text-content-muted"
                      >{race.margin > 0
                        ? `${surname(race.leader)} ahead`
                        : "Even"} · {reportingLabel(race)}</span
                    >
                  </span>
                  <span
                    class="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums {partyBadgeClass(
                      race.party ?? undefined,
                    )}"
                    >{race.margin > 0
                      ? `${partyAbbr(race.party ?? undefined)} ${margin(race.margin)}`
                      : "Tied"}</span
                  >
                </a>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="mt-2 text-sm text-content-muted">{panel.empty}</p>
        {/if}
      </div>
    {/each}

    <div class="card p-4" data-testid="results-upsets">
      <h3 class="text-sm font-bold text-content">Upsets to watch</h3>
      <p class="text-xs text-content-muted">
        Leader differs from our pre-election forecast
      </p>
      {#if upsets.length}
        <ol class="mt-2 divide-y divide-stroke/60">
          {#each upsets as race (race.id)}
            <li class="py-1.5">
              <a href={`/races/${race.id}/`} class="group block">
                <span
                  class="block truncate text-sm font-semibold text-content group-hover:text-primary-700 group-hover:underline dark:group-hover:text-primary-300"
                  >{shortRaceTitle(race.title)}</span
                >
                <span class="block text-xs text-content-muted">
                  <span class="font-semibold text-content"
                    >{race.leader}{race.leaderParty
                      ? ` (${partyAbbr(race.leaderParty)})`
                      : ""}</span
                  >
                  {race.called ? "won" : "leads"} · forecast picked {race.predicted}{race.predictedParty &&
                  race.predicted !== race.predictedParty
                    ? ` (${partyAbbr(race.predictedParty)})`
                    : ""}
                </span>
              </a>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="mt-2 text-sm text-content-muted">
          {anyCounting || progress.reporting
            ? "Every leader so far matches the forecast."
            : "Shows up once votes are counted."}
        </p>
      {/if}
    </div>
  </div>
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
