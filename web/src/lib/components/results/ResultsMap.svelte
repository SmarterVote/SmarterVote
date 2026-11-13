<script lang="ts" context="module">
  import type { PublicRaceResult } from "$lib/types";
  import { partyAbbr, partyKey } from "$lib/utils/party";
  import {
    formatPctReporting,
    resultGroup,
    sortResultRows,
    type ResultDirectoryRace,
  } from "$lib/utils/results";

  export type MapOffice = "senate" | "governor" | "house";
  export type MapRace = ResultDirectoryRace & {
    result: PublicRaceResult | null;
  };
  /** "D" / "R" get party colors; any other party shares one neutral hue. */
  export type MapSide = "D" | "R" | "O";
  /** "rcv": first choices are in but the ranked-choice count is not, so no party leads. */
  export type MapStage = "called" | "leading" | "rcv" | "awaiting";

  export interface MapCall {
    stage: MapStage;
    side: MapSide | null;
    /** Called winner or current leader, e.g. "Jane Doe (D)". */
    who: string;
    /** Lead in percentage points, when two candidates have shares. */
    margin: number | null;
    counted: string;
  }

  function sideOf(party: string | null | undefined): MapSide {
    const key = partyKey(party);
    return key === "dem" ? "D" : key === "rep" ? "R" : "O";
  }

  function named(name: string, party: string | null | undefined): string {
    return party ? `${name} (${partyAbbr(party)})` : name;
  }

  /** Where one race stands for the map: called, someone leading, or awaiting. */
  export function mapCall(result: PublicRaceResult | null): MapCall {
    const counted = formatPctReporting(result?.pct_reporting);
    const group = resultGroup(result?.status);
    const sorted = sortResultRows(result?.candidates ?? []);
    const top = sorted[0];
    if (group === "called") {
      const winner =
        sorted.find((c) => c.name === result?.winner_name) ?? top ?? null;
      const name = result?.winner_name ?? winner?.name;
      const party = result?.winner_party ?? winner?.party;
      if (name || party)
        return {
          stage: "called",
          side: sideOf(party),
          who: name ? named(name, party) : (party ?? ""),
          margin: null,
          counted,
        };
    }
    if (
      group !== "awaiting" &&
      top &&
      ((top.pct ?? 0) > 0 || (top.votes ?? 0) > 0)
    ) {
      const second = sorted[1];
      const margin =
        typeof top.pct === "number" && typeof second?.pct === "number"
          ? Math.max(0, top.pct - second.pct)
          : null;
      if (result?.status === "rcv_pending")
        return {
          stage: "rcv",
          side: null,
          who: named(top.name, top.party),
          margin,
          counted,
        };
      return {
        stage: "leading",
        side: sideOf(top.party),
        who: named(top.name, top.party),
        margin,
        counted,
      };
    }
    return { stage: "awaiting", side: null, who: "", margin: null, counted };
  }

  export const MAP_FILLS: Record<MapStage, Record<MapSide, string>> = {
    called: {
      D: "var(--color-safe-d)",
      R: "var(--color-safe-r)",
      O: "var(--results-map-o)",
    },
    leading: {
      D: "var(--color-lean-d)",
      R: "var(--color-lean-r)",
      O: "var(--results-map-o-lead)",
    },
    rcv: { D: "", R: "", O: "" },
    awaiting: { D: "", R: "", O: "" },
  };
  /** The hatch USMap already defines for "nothing to show yet". */
  export const AWAITING_FILL = "url(#map-no-forecast)";
  /** One neutral shade for a ranked-choice count still to come: no party's color. */
  export const RCV_FILL = "var(--results-map-rcv)";

  export function fillFor(call: MapCall): string {
    if (call.stage === "rcv") return RCV_FILL;
    return call.stage === "awaiting" || !call.side
      ? AWAITING_FILL
      : MAP_FILLS[call.stage][call.side];
  }

  export function describeCall(call: MapCall): string {
    if (call.stage === "called") return `Winner: ${call.who}`;
    if (call.stage === "rcv")
      return `First choices: ${call.who}${
        call.margin === null ? " ahead" : ` +${call.margin.toFixed(1)}`
      }, ranked-choice count pending`;
    if (call.stage === "leading")
      return call.margin === null
        ? `${call.who} leads`
        : `${call.who} leads by ${call.margin.toFixed(1)} pts`;
    return "Awaiting results";
  }

  const BADGE: Record<MapStage, Record<MapSide, string>> = {
    called: {
      D: "bg-blue-700! text-white!",
      R: "bg-red-700! text-white!",
      O: "bg-purple-700! text-white!",
    },
    leading: {
      D: "bg-blue-500! text-white!",
      R: "bg-red-500! text-white!",
      O: "bg-purple-500! text-white!",
    },
    rcv: { D: "", R: "", O: "" },
    awaiting: { D: "", R: "", O: "" },
  };

  function badgeFor(call: MapCall): { badge: string; badgeClass: string } {
    if (call.stage === "rcv")
      return {
        badge: "Ranked-choice pending",
        badgeClass: "bg-stone-600! text-white!",
      };
    if (call.stage === "awaiting" || !call.side)
      return {
        badge: "Awaiting results",
        badgeClass: "bg-slate-500! text-white!",
      };
    const side = call.side === "O" ? "Other" : call.side;
    return {
      badge: call.stage === "called" ? `Called: ${side}` : `${side} leading`,
      badgeClass: BADGE[call.stage][call.side],
    };
  }

  export interface MapCounts {
    called: Record<MapSide, number>;
    leading: Record<MapSide, number>;
    /** Ranked-choice counts still to come: counted as no party's lead. */
    rcv: number;
    awaiting: number;
  }

  export interface ResultsMapData {
    activeStates: Set<string>;
    colors: Record<string, string>;
    tooltips: Record<
      string,
      {
        title: string;
        subtitle?: string;
        badge?: string;
        badgeClass?: string;
        details?: string[];
      }
    >;
    /** The race a click on each state opens (its main race for this office). */
    hrefs: Record<string, string>;
    /** Races for this office per state, for the map's accessible labels. */
    raceCounts: Record<string, number>;
    rows: { race: MapRace; call: MapCall }[];
    counts: MapCounts;
    /** House only: one row per state with its delegation tally. */
    stateRows: { state: string; tally: string; href: string }[];
  }

  /** Hatched in the leader's color: counts still coming in (USMap patterns). */
  export const HOUSE_LEAD_FILLS: Record<MapSide, string> = {
    D: "url(#map-result-lead-d)",
    R: "url(#map-result-lead-r)",
    O: "url(#map-result-lead-other)",
  };
  /** Two parties level in called-plus-leading seats. */
  export const HOUSE_SPLIT_FILL = "url(#map-split-holdover)";

  export interface HouseTally {
    called: Record<MapSide, number>;
    leading: Record<MapSide, number>;
    rcv?: number;
    awaiting: number;
    total: number;
  }

  const SIDES: MapSide[] = ["D", "R", "O"];

  /**
   * One state's House delegation shade: solid when every seat is called for
   * one party; the lighter Lean shade when every seat is called but split;
   * hatched in the party called or leading in more seats while counts
   * continue; the split pattern on a tie; grey hatch before any report.
   */
  export function houseFill(tally: HouseTally): string {
    if (tally.awaiting >= tally.total) return AWAITING_FILL;
    if ((tally.rcv ?? 0) + tally.awaiting >= tally.total) return RCV_FILL;
    const calledTotal = SIDES.reduce((n, side) => n + tally.called[side], 0);
    const sweep = SIDES.find((side) => tally.called[side] === tally.total);
    if (sweep) return MAP_FILLS.called[sweep];
    const seats = SIDES.map((side) => ({
      side,
      n: tally.called[side] + tally.leading[side],
    })).sort((a, b) => b.n - a.n);
    if (seats[0].n === 0) return AWAITING_FILL;
    if (seats[0].n === seats[1].n) return HOUSE_SPLIT_FILL;
    return calledTotal === tally.total
      ? MAP_FILLS.leading[seats[0].side]
      : HOUSE_LEAD_FILLS[seats[0].side];
  }

  /** "D 12 called · 8 leading; R 3 called · 2 leading; 27 awaiting" */
  export function houseTallyLine(tally: HouseTally): string {
    const parts: string[] = [];
    for (const side of SIDES) {
      const called = tally.called[side];
      const leading = tally.leading[side];
      if (!called && !leading) continue;
      const label = side === "O" ? "Other" : side;
      const bits = [
        ...(called ? [`${called} called`] : []),
        ...(leading ? [`${leading} leading`] : []),
      ];
      parts.push(`${label} ${bits.join(" · ")}`);
    }
    if (tally.rcv) parts.push(`${tally.rcv} ranked-choice pending`);
    if (tally.awaiting) parts.push(`${tally.awaiting} awaiting`);
    return parts.join("; ");
  }

  function houseBadge(tally: HouseTally): {
    badge: string;
    badgeClass: string;
  } {
    if (tally.awaiting >= tally.total)
      return {
        badge: "Awaiting results",
        badgeClass: "bg-slate-500! text-white!",
      };
    const called = SIDES.reduce((n, side) => n + tally.called[side], 0);
    return {
      badge: `${called} of ${tally.total} called`,
      badgeClass: "bg-slate-700! text-white!",
    };
  }

  /** The results page's race list, narrowed to one state's House races. */
  export function houseStateHref(state: string): string {
    return `/results/?${new URLSearchParams({ state, office: "house" })}#results-list`;
  }

  /** Each state shaded by its House delegation: seats called and leading. */
  export function buildHouseMap(races: MapRace[]): ResultsMapData {
    const data = emptyMapData();
    const tallies = new Map<string, HouseTally>();
    data.rows = races
      .filter((race) => race.office === "house" && race.state !== "Other")
      .map((race) => ({ race, call: mapCall(race.result) }))
      .sort(
        (a, b) =>
          a.race.state.localeCompare(b.race.state) ||
          a.race.id.localeCompare(b.race.id, undefined, { numeric: true }),
      );
    for (const { race, call } of data.rows) {
      const tally = tallies.get(race.state) ?? {
        called: { D: 0, R: 0, O: 0 },
        leading: { D: 0, R: 0, O: 0 },
        awaiting: 0,
        total: 0,
      };
      tally.total += 1;
      if (call.stage === "rcv") {
        tally.rcv = (tally.rcv ?? 0) + 1;
        data.counts.rcv += 1;
      } else if (call.stage === "awaiting" || !call.side) {
        tally.awaiting += 1;
        data.counts.awaiting += 1;
      } else {
        tally[call.stage][call.side] += 1;
        data.counts[call.stage][call.side] += 1;
      }
      tallies.set(race.state, tally);
    }
    for (const [state, tally] of tallies) {
      const line = houseTallyLine(tally);
      const href = houseStateHref(state);
      data.activeStates.add(state);
      data.colors[state] = houseFill(tally);
      data.hrefs[state] = href;
      data.raceCounts[state] = tally.total;
      data.tooltips[state] = {
        title: state,
        subtitle: `${tally.total} House ${tally.total === 1 ? "seat" : "seats"}`,
        ...houseBadge(tally),
        details: [line],
      };
      data.stateRows.push({ state, tally: line, href });
    }
    return data;
  }

  function emptyMapData(): ResultsMapData {
    return {
      activeStates: new Set(),
      colors: {},
      tooltips: {},
      hrefs: {},
      raceCounts: {},
      rows: [],
      counts: {
        called: { D: 0, R: 0, O: 0 },
        leading: { D: 0, R: 0, O: 0 },
        rcv: 0,
        awaiting: 0,
      },
      stateRows: [],
    };
  }

  export function raceHref(id: string): string {
    return `/races/${encodeURIComponent(id)}/`;
  }

  /** Per-state fills, tooltips and links for one office's races. */
  export function buildResultsMap(
    races: MapRace[],
    office: MapOffice,
  ): ResultsMapData {
    if (office === "house") return buildHouseMap(races);
    const rows = races
      .filter((race) => race.office === office && race.state !== "Other")
      .map((race) => ({ race, call: mapCall(race.result) }))
      // A state's regular race leads its special, so it sets the color.
      .sort(
        (a, b) =>
          a.race.state.localeCompare(b.race.state) ||
          Number(/special/i.test(a.race.id)) -
            Number(/special/i.test(b.race.id)) ||
          a.race.id.localeCompare(b.race.id),
      );
    const data: ResultsMapData = { ...emptyMapData(), rows };
    for (const { race, call } of rows) {
      if (call.stage === "rcv") data.counts.rcv += 1;
      else if (call.stage === "awaiting" || !call.side)
        data.counts.awaiting += 1;
      else data.counts[call.stage][call.side] += 1;

      const state = race.state;
      const lines = [
        describeCall(call),
        ...(call.counted ? [`${call.counted} counted`] : []),
      ];
      data.raceCounts[state] = (data.raceCounts[state] ?? 0) + 1;
      const existing = data.tooltips[state];
      if (existing) {
        existing.details = [
          ...(existing.details ?? []),
          `${race.title}: ${lines.join(", ")}`,
        ];
        continue;
      }
      data.activeStates.add(state);
      data.colors[state] = fillFor(call);
      data.hrefs[state] = raceHref(race.id);
      data.tooltips[state] = {
        title: race.title,
        ...badgeFor(call),
        details: lines,
      };
    }
    return data;
  }

  /** "Called D 3 · R 2 · Leading D 7 · R 5 · Ranked-choice pending 1 · Awaiting 10" */
  export function legendSummary(counts: MapCounts): string {
    const part = (label: string, by: Record<MapSide, number>) =>
      `${label} D ${by.D} · R ${by.R}${by.O ? ` · Other ${by.O}` : ""}`;
    return [
      part("Called", counts.called),
      part("Leading", counts.leading),
      ...(counts.rcv ? [`Ranked-choice pending ${counts.rcv}`] : []),
      `Awaiting ${counts.awaiting}`,
    ].join(" · ");
  }
</script>

<script lang="ts">
  import { goto } from "$app/navigation";
  import USMap from "$lib/components/USMap.svelte";

  export let races: MapRace[] = [];

  const OFFICES: { id: MapOffice; label: string }[] = [
    { id: "senate", label: "Senate" },
    { id: "governor", label: "Governor" },
    { id: "house", label: "House" },
  ];
  const OFFICE_NAMES: Record<MapOffice, string> = {
    senate: "Senate",
    governor: "Governor",
    house: "House",
  };

  let office: MapOffice = "senate";

  $: map = buildResultsMap(races, office);
  $: officeName = OFFICE_NAMES[office];

  const SWATCHES: {
    label: string;
    fill: string;
    hatch?: boolean;
    house?: boolean;
  }[] = [
    { label: "Called D", fill: "var(--color-safe-d)" },
    { label: "Leading D", fill: "var(--color-lean-d)" },
    { label: "Leading R", fill: "var(--color-lean-r)" },
    { label: "Called R", fill: "var(--color-safe-r)" },
    { label: "Other party", fill: "var(--results-map-o)" },
    { label: "Ranked-choice count pending", fill: "var(--results-map-rcv)" },
    {
      label: "House: still counting (leader hatched)",
      fill: "repeating-linear-gradient(45deg, var(--color-safe-d) 0 3px, var(--color-holdover-d-solid) 3px 6px)",
      house: true,
    },
    {
      label: "House: even split",
      fill: "repeating-linear-gradient(45deg, var(--color-holdover-d-solid) 0 4px, var(--color-holdover-r-solid) 4px 8px)",
      house: true,
    },
    {
      label: "Awaiting results",
      fill: "repeating-linear-gradient(45deg, var(--color-no-forecast-bg) 0 2px, var(--color-no-forecast-line) 2px 4px)",
      hatch: true,
    },
    { label: "No race", fill: "var(--map-inactive)" },
  ];

  function openState(event: CustomEvent<string>) {
    const href = map.hrefs[event.detail];
    if (href) void goto(href);
  }

  const pill = (active: boolean) =>
    `min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
      active
        ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200"
        : "border-stroke bg-surface text-content-muted hover:bg-surface-alt"
    }`;
</script>

<section
  aria-labelledby="results-map-heading"
  class="card p-4 sm:p-6"
  data-testid="results-map"
>
  <div
    class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-stroke pb-4"
  >
    <div>
      <h2 id="results-map-heading" class="h-section">Results map</h2>
      <p class="mt-1 max-w-prose text-sm leading-6 text-content-subtle">
        {#if office === "house"}
          Each state shaded by its House delegation: solid when every seat is
          called for one party, hatched in the party called or ahead in more
          seats while counts continue. Select a state to list its races.
        {:else}
          Each state with a {office === "senate" ? "Senate" : "governor"} race on
          the ballot, shaded by the party that won it or is ahead in the count so
          far. Select a state to open its race.
        {/if}
      </p>
    </div>
    <div class="flex gap-2" role="group" aria-label="Map office">
      {#each OFFICES as option (option.id)}
        <button
          type="button"
          class={pill(office === option.id)}
          aria-pressed={office === option.id}
          on:click={() => (office = option.id)}>{option.label}</button
        >
      {/each}
    </div>
  </div>

  <p
    class="mb-3 text-sm font-semibold tabular-nums text-content"
    aria-live="polite"
    data-testid="results-map-counts"
  >
    <span class="sr-only"
      >{office === "house" ? "House seats" : `${officeName} races`}:
    </span>{legendSummary(map.counts)}
  </p>

  <USMap
    activeStates={map.activeStates}
    raceCounts={map.raceCounts}
    stateColors={map.colors}
    stateTooltips={map.tooltips}
    on:stateClick={openState}
  />

  <ul
    class="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-stroke pt-4"
    aria-label="Map colors"
  >
    {#each SWATCHES.filter((swatch) => !swatch.house || office === "house") as swatch (swatch.label)}
      <li class="flex items-center gap-1.5 text-xs text-content-muted">
        <span
          class="block h-3.5 w-3.5 rounded-sm border border-stroke"
          style="background: {swatch.fill};"
          aria-hidden="true"
        ></span>
        {swatch.label}
      </li>
    {/each}
  </ul>
  <p class="mt-2 text-xs text-content-muted">
    A lead is not a call: lighter shades are still counting, and every result
    stays unofficial until the state certifies it.
  </p>

  {#if office === "house" && map.stateRows.length}
    <details class="mt-3">
      <summary
        class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-primary-700 dark:text-primary-300"
        >Show the map as a list ({map.stateRows.length}
        {map.stateRows.length === 1 ? "state" : "states"})</summary
      >
      <table class="mt-2 w-full text-left text-sm">
        <caption class="sr-only">House results by state</caption>
        <thead class="text-xs text-content-subtle">
          <tr>
            <th scope="col" class="py-1.5 pr-3 font-semibold">State</th>
            <th scope="col" class="py-1.5 font-semibold">Seats</th>
          </tr>
        </thead>
        <tbody>
          {#each map.stateRows as row (row.state)}
            <tr class="border-t border-stroke">
              <td class="py-2 pr-3">
                <a
                  href={row.href}
                  class="font-semibold text-primary-700 hover:underline dark:text-primary-300"
                  >{row.state}</a
                >
              </td>
              <td class="py-2 tabular-nums text-content">{row.tally}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </details>
  {:else if map.rows.length}
    <details class="mt-3">
      <summary
        class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-primary-700 dark:text-primary-300"
        >Show the map as a list ({map.rows.length}
        {map.rows.length === 1 ? "race" : "races"})</summary
      >
      <div class="overflow-x-auto">
        <table class="mt-2 w-full text-left text-sm">
          <caption class="sr-only">{officeName} results by state</caption>
          <thead class="text-xs text-content-subtle">
            <tr>
              <th scope="col" class="py-1.5 pr-3 font-semibold">Race</th>
              <th scope="col" class="py-1.5 pr-3 font-semibold">Status</th>
              <th scope="col" class="py-1.5 font-semibold">Counted</th>
            </tr>
          </thead>
          <tbody>
            {#each map.rows as { race, call } (race.id)}
              <tr class="border-t border-stroke">
                <td class="py-2 pr-3">
                  <a
                    href={raceHref(race.id)}
                    class="font-semibold text-primary-700 hover:underline dark:text-primary-300"
                    >{race.title}</a
                  >
                </td>
                <td class="py-2 pr-3 text-content">{describeCall(call)}</td>
                <td class="py-2 tabular-nums text-content-muted"
                  >{call.counted || "–"}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  {/if}
</section>

<style>
  /* Called = the forecast's Safe shade and leading = its Lean shade (both
     defined by USMap), so a lead reads lighter than a call in both themes.
     Other parties get one purple, matching their party badges. */
  :global(:root) {
    --results-map-o: #7c3aed;
    --results-map-o-lead: #c4b5fd;
    --results-map-rcv: #a8a29e;
  }

  :global(.dark) {
    --results-map-o: #a78bfa;
    --results-map-o-lead: #4c3a7a;
    --results-map-rcv: #78716c;
  }
</style>
