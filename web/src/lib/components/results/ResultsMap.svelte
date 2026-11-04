<script lang="ts" context="module">
  import type { PublicRaceResult } from "$lib/types";
  import { partyAbbr, partyKey } from "$lib/utils/party";
  import {
    formatPctReporting,
    resultGroup,
    sortResultRows,
    type ResultDirectoryRace,
  } from "$lib/utils/results";

  export type MapOffice = "senate" | "governor";
  export type MapRace = ResultDirectoryRace & {
    result: PublicRaceResult | null;
  };
  /** "D" / "R" get party colors; any other party shares one neutral hue. */
  export type MapSide = "D" | "R" | "O";
  export type MapStage = "called" | "leading" | "awaiting";

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
    awaiting: { D: "", R: "", O: "" },
  };
  /** The hatch USMap already defines for "nothing to show yet". */
  export const AWAITING_FILL = "url(#map-no-forecast)";

  export function fillFor(call: MapCall): string {
    return call.stage === "awaiting" || !call.side
      ? AWAITING_FILL
      : MAP_FILLS[call.stage][call.side];
  }

  export function describeCall(call: MapCall): string {
    if (call.stage === "called") return `Winner: ${call.who}`;
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
    awaiting: { D: "", R: "", O: "" },
  };

  function badgeFor(call: MapCall): { badge: string; badgeClass: string } {
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
  }

  export function raceHref(id: string): string {
    return `/races/${encodeURIComponent(id)}/`;
  }

  /** Per-state fills, tooltips and links for one office's races. */
  export function buildResultsMap(
    races: MapRace[],
    office: MapOffice,
  ): ResultsMapData {
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
    const data: ResultsMapData = {
      activeStates: new Set(),
      colors: {},
      tooltips: {},
      hrefs: {},
      raceCounts: {},
      rows,
      counts: {
        called: { D: 0, R: 0, O: 0 },
        leading: { D: 0, R: 0, O: 0 },
        awaiting: 0,
      },
    };
    for (const { race, call } of rows) {
      if (call.stage === "awaiting" || !call.side) data.counts.awaiting += 1;
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

  /** "Called D 3 · R 2 · Leading D 7 · R 5 · Awaiting 10" */
  export function legendSummary(counts: MapCounts): string {
    const part = (label: string, by: Record<MapSide, number>) =>
      `${label} D ${by.D} · R ${by.R}${by.O ? ` · Other ${by.O}` : ""}`;
    return [
      part("Called", counts.called),
      part("Leading", counts.leading),
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
  ];

  let office: MapOffice = "senate";

  $: map = buildResultsMap(races, office);
  $: officeLabel = office === "senate" ? "Senate" : "governor";

  const SWATCHES: { label: string; fill: string; hatch?: boolean }[] = [
    { label: "Called D", fill: "var(--color-safe-d)" },
    { label: "Leading D", fill: "var(--color-lean-d)" },
    { label: "Leading R", fill: "var(--color-lean-r)" },
    { label: "Called R", fill: "var(--color-safe-r)" },
    { label: "Other party", fill: "var(--results-map-o)" },
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
        Each state with a {officeLabel} race on the ballot, shaded by the party that
        won it or is ahead in the count so far. Select a state to open its race.
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
      >{office === "senate" ? "Senate" : "Governor"} races:
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
    {#each SWATCHES as swatch (swatch.label)}
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

  {#if map.rows.length}
    <details class="mt-3">
      <summary
        class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-primary-700 dark:text-primary-300"
        >Show the map as a list ({map.rows.length}
        {map.rows.length === 1 ? "race" : "races"})</summary
      >
      <div class="overflow-x-auto">
        <table class="mt-2 w-full text-left text-sm">
          <caption class="sr-only"
            >{office === "senate" ? "Senate" : "Governor"} results by state</caption
          >
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
  }

  :global(.dark) {
    --results-map-o: #a78bfa;
    --results-map-o-lead: #4c3a7a;
  }
</style>
