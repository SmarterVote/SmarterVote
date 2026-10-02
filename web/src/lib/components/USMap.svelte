<script lang="ts" context="module">
  /**
   * Race-count buckets for the elections directory map. A neutral slate ramp
   * (not party blue) says "more races here" without reading as a result map.
   * The directory legend renders these same buckets and variables.
   */
  export const RACE_COUNT_BUCKETS = [
    { min: 1, max: 1, label: "1", fill: "var(--map-count-1)" },
    { min: 2, max: 4, label: "2–4", fill: "var(--map-count-2)" },
    { min: 5, max: 9, label: "5–9", fill: "var(--map-count-3)" },
    { min: 10, max: Infinity, label: "10+", fill: "var(--map-count-4)" },
  ] as const;

  export function raceCountFill(count: number): string | null {
    if (count <= 0) return null;
    const bucket = RACE_COUNT_BUCKETS.find(
      (b) => count >= b.min && count <= b.max,
    );
    return bucket?.fill ?? null;
  }
</script>

<script lang="ts">
  import { onMount, createEventDispatcher } from "svelte";
  import { geoAlbersUsa, geoPath } from "d3-geo";
  import type { GeoPermissibleObjects } from "d3-geo";
  import { feature } from "topojson-client";
  import type { Topology } from "topojson-specification";
  // A hashed, immutable asset URL (long-cached), and the minified copy of the
  // same us-atlas topology.
  import statesTopologyUrl from "us-atlas/states-10m.json?url";

  export let activeStates: Set<string> = new Set();
  export let selectedState: string | null = null;
  export let raceCounts: Record<string, number> = {};
  export let matchingCandidatesByState: Record<string, string[]> = {};
  /** Shade active states by how many races they hold (elections directory). */
  export let shadeByCount = false;
  export let stateColors: Record<string, string> = {};
  export let stateTooltips: Record<
    string,
    {
      title: string;
      subtitle?: string;
      badge?: string;
      badgeClass?: string;
      details?: string[];
    }
  > = {};

  const dispatch = createEventDispatcher<{ stateClick: string }>();

  const FIPS_TO_STATE: Record<string, string> = {
    "01": "Alabama",
    "02": "Alaska",
    "04": "Arizona",
    "05": "Arkansas",
    "06": "California",
    "08": "Colorado",
    "09": "Connecticut",
    "10": "Delaware",
    "11": "District of Columbia",
    "12": "Florida",
    "13": "Georgia",
    "15": "Hawaii",
    "16": "Idaho",
    "17": "Illinois",
    "18": "Indiana",
    "19": "Iowa",
    "20": "Kansas",
    "21": "Kentucky",
    "22": "Louisiana",
    "23": "Maine",
    "24": "Maryland",
    "25": "Massachusetts",
    "26": "Michigan",
    "27": "Minnesota",
    "28": "Mississippi",
    "29": "Missouri",
    "30": "Montana",
    "31": "Nebraska",
    "32": "Nevada",
    "33": "New Hampshire",
    "34": "New Jersey",
    "35": "New Mexico",
    "36": "New York",
    "37": "North Carolina",
    "38": "North Dakota",
    "39": "Ohio",
    "40": "Oklahoma",
    "41": "Oregon",
    "42": "Pennsylvania",
    "44": "Rhode Island",
    "45": "South Carolina",
    "46": "South Dakota",
    "47": "Tennessee",
    "48": "Texas",
    "49": "Utah",
    "50": "Vermont",
    "51": "Virginia",
    "53": "Washington",
    "54": "West Virginia",
    "55": "Wisconsin",
    "56": "Wyoming",
  };

  interface StateFeature {
    id: string;
    name: string;
    pathData: string;
  }

  type StateGeometry = GeoPermissibleObjects & { id: string | number };

  let stateFeatures: StateFeature[] = [];
  let hoveredStateName: string | null = null;
  let hoveredStateCount = 0;
  let tooltipX = 0;
  let tooltipY = 0;
  let loaded = false;
  let loadError = false;
  let svgEl: SVGSVGElement;
  let containerWidth = 0;
  let tooltipWidth = 0;
  let tooltipHeight = 0;
  /** State whose keyboard focus ring is drawn (only for :focus-visible). */
  let focusRingName: string | null = null;
  /**
   * The state that holds the map's single Tab stop (roving tabindex); arrow
   * keys move it. Defaults to the selection, else the first state A-Z.
   */
  let rovingName: string | null = null;
  /** Last pointer type, so touch taps never leave a hover tooltip behind. */
  let lastPointerType = "mouse";
  const mapId = `us-map-${Math.random().toString(36).slice(2, 9)}`;

  const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const pathFn = geoPath(projection);

  async function loadMap() {
    loadError = false;
    try {
      const res = await fetch(statesTopologyUrl);
      if (!res.ok) throw new Error(`Map data request failed (${res.status})`);
      const topology = (await res.json()) as Topology;
      const geojson = feature(topology, topology.objects.states) as {
        features: StateGeometry[];
      };
      stateFeatures = geojson.features
        .map((f) => {
          const fips = String(f.id).padStart(2, "0");
          const name = FIPS_TO_STATE[fips] ?? fips;
          return { id: fips, name, pathData: pathFn(f) ?? "" };
        })
        .filter((f: StateFeature) => f.pathData);
      loaded = true;
    } catch {
      loadError = true;
    }
  }

  onMount(() => {
    void loadMap();
  });

  function stateLabel(name: string, count: number, canClick: boolean): string {
    const tip = stateTooltips[name];
    const parts = [name];
    if (canClick) parts.push(`${count} race${count !== 1 ? "s" : ""}`);
    if (tip?.subtitle) parts.push(tip.subtitle);
    if (tip?.badge) parts.push(tip.badge);
    if (tip?.details?.length) {
      // Keep the accessible name concise: skip pointer-only hints.
      parts.push(
        ...tip.details.filter((detail) => !/^Click state/i.test(detail)),
      );
    }
    return parts.join(", ");
  }

  function handleClick(name: string) {
    dispatch("stateClick", name);
  }

  function focusState(name: string) {
    rovingName = name;
    const target = Array.from(
      svgEl?.querySelectorAll<SVGElement>("path[data-state]") ?? [],
    ).find((path) => path.getAttribute("data-state") === name);
    target?.focus();
  }

  function handleKeydown(e: KeyboardEvent, name: string) {
    if (e.key === "Enter" || e.key === " ") {
      if (!activeStates.has(name)) return;
      e.preventDefault();
      dispatch("stateClick", name);
      return;
    }
    // One Tab stop for the whole map; arrows walk the states A-Z.
    const index = focusOrder.indexOf(name);
    if (index < 0 || focusOrder.length === 0) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      next = (index + 1) % focusOrder.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (index - 1 + focusOrder.length) % focusOrder.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = focusOrder.length - 1;
    if (next < 0) return;
    e.preventDefault();
    focusState(focusOrder[next]);
  }

  function handlePointerDown(e: PointerEvent) {
    lastPointerType = e.pointerType || "mouse";
  }

  function handlePointerUp(e: PointerEvent) {
    // A tap selects the state; the page shows the result, so a hover tooltip
    // left behind by the emulated mouse events would only cover the map.
    if (e.pointerType && e.pointerType !== "mouse") hideTooltip();
  }

  function handlePointerMove(e: PointerEvent) {
    if (e.pointerType === "mouse") lastPointerType = "mouse";
  }

  /** Size the tooltip once rendered so it can be clamped inside the map. */
  function measureTooltip(node: HTMLElement, _key: string | null) {
    const measure = () => {
      tooltipWidth = node.offsetWidth;
      tooltipHeight = node.offsetHeight;
      containerWidth = svgEl?.getBoundingClientRect().width ?? 0;
    };
    measure();
    return { update: measure };
  }

  function hideTooltip() {
    hoveredStateName = null;
    hoveredStateCount = 0;
  }

  function isFocusVisible(element: Element): boolean {
    try {
      return element.matches(":focus-visible");
    } catch {
      // Environments without :focus-visible support (jsdom): assume keyboard.
      return true;
    }
  }

  function handleMouseEnter(e: MouseEvent, name: string, count: number) {
    if (lastPointerType !== "mouse") return;
    hoveredStateName = name;
    hoveredStateCount = count;
    if (svgEl) {
      const rect = svgEl.getBoundingClientRect();
      tooltipX = e.clientX - rect.left;
      tooltipY = e.clientY - rect.top;
    }
  }

  function handleMouseLeave() {
    hoveredStateName = null;
    hoveredStateCount = 0;
  }

  function handleFocus(e: FocusEvent, name: string, count: number) {
    rovingName = name;
    const target = e.currentTarget as SVGGraphicsElement;
    // A tap or click also focuses the path; only keyboard focus (focus-visible)
    // gets the ring and the tooltip, so touch never leaves one stuck on screen.
    if (!isFocusVisible(target)) return;
    focusRingName = name;
    hoveredStateName = name;
    hoveredStateCount = count;
    if (target && svgEl) {
      const svgRect = svgEl.getBoundingClientRect();
      const elemRect = target.getBoundingClientRect();

      tooltipX = elemRect.left - svgRect.left + elemRect.width / 2;
      tooltipY = elemRect.top - svgRect.top;
    }
  }

  function handleBlur() {
    focusRingName = null;
    hideTooltip();
  }

  function skipMap(event: MouseEvent) {
    // In-page anchors do not move focus by themselves in every browser.
    event.preventDefault();
    document.getElementById(`${mapId}-end`)?.focus();
  }

  // Keyboard-reachable states, alphabetical, for the arrow-key order.
  $: focusOrder = stateFeatures
    .map((feature) => feature.name)
    .filter((name) => activeStates.has(name) || !!stateTooltips[name])
    .sort((a, b) => a.localeCompare(b));
  $: tabStop =
    rovingName && focusOrder.includes(rovingName)
      ? rovingName
      : selectedState && focusOrder.includes(selectedState)
        ? selectedState
        : (focusOrder[0] ?? null);
  $: focusRingFeature = focusRingName
    ? (stateFeatures.find((f) => f.name === focusRingName) ?? null)
    : null;

  // Keep the tooltip inside the map: clamp its center so neither edge spills
  // past the container, and flip it below the pointer near the top edge.
  $: tooltipLeft = (() => {
    if (!containerWidth || !tooltipWidth) return tooltipX;
    const half = tooltipWidth / 2;
    if (tooltipWidth >= containerWidth) return containerWidth / 2;
    return Math.min(Math.max(tooltipX, half + 4), containerWidth - half - 4);
  })();
  $: tooltipBelow = tooltipHeight > 0 && tooltipY < tooltipHeight + 14;
  $: tooltipTransform = `translate3d(${tooltipLeft}px, ${tooltipY}px, 0) translate(-50%, ${
    tooltipBelow ? "14px" : "calc(-100% - 10px)"
  })`;

  // Reactive so the SVG `fill={getFill(...)}` attribute re-evaluates whenever the
  // colors change. A plain function would only re-run when `state` changes, so
  // switching tabs (which updates stateColors but not the feature list) would
  // otherwise leave the map painted with the previous tab's colors.
  $: getFill = (name: string): string => {
    if (stateColors[name]) return stateColors[name];
    if (name === selectedState) return "var(--map-selected)";
    if (activeStates.has(name)) {
      if (shadeByCount) {
        return raceCountFill(raceCounts[name] ?? 0) ?? "var(--map-count-1)";
      }
      return "var(--map-active)";
    }
    return "var(--map-inactive)";
  };

  // One keyed list keeps every path (and therefore keyboard focus) stable
  // when the selection changes; the selected outline is a decorative overlay
  // drawn last so its stroke is never clipped by neighbors.
  $: selectedFeature =
    stateFeatures.find((s) => s.name === selectedState) ?? null;
</script>

<svelte:window on:scroll|passive={hideTooltip} />

<div class="map-container">
  {#if loadError}
    <div class="map-error" role="alert">
      <p>The map could not be loaded.</p>
      <button type="button" class="map-retry" on:click={loadMap}>
        Try again
      </button>
    </div>
  {:else if !loaded}
    <div class="skeleton" aria-hidden="true"></div>
  {:else}
    {#if focusOrder.length > 0}
      <a href="#{mapId}-end" class="map-skip" on:click={skipMap}>Skip map</a>
    {/if}
    <svg
      bind:this={svgEl}
      viewBox="0 0 975 610"
      role="group"
      aria-label="US States map. Use the arrow keys to move between states."
      on:pointerdown={handlePointerDown}
      on:pointerup={handlePointerUp}
      on:pointercancel={handlePointerUp}
      on:pointermove={handlePointerMove}
    >
      <defs>
        <pattern
          id="map-no-forecast"
          patternUnits="userSpaceOnUse"
          width="8"
          height="8"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill="var(--color-no-forecast-bg)" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke="var(--color-no-forecast-line)"
            stroke-width="3"
          />
        </pattern>
        <pattern
          id="map-split-holdover"
          patternUnits="userSpaceOnUse"
          width="10"
          height="10"
          patternTransform="rotate(45)"
        >
          <rect width="5" height="10" fill="var(--color-holdover-d-solid)" />
          <rect
            x="5"
            width="5"
            height="10"
            fill="var(--color-holdover-r-solid)"
          />
        </pattern>
      </defs>
      {#each stateFeatures as state (state.id)}
        {@const canClick = activeStates.has(state.name)}
        {@const canHover = canClick || !!stateTooltips[state.name]}
        {@const count = raceCounts[state.name] ?? 0}
        {@const isSelected = state.name === selectedState}
        {#if canClick}
          <path
            d={state.pathData}
            data-state={state.name}
            fill={getFill(state.name)}
            stroke="var(--map-stroke)"
            stroke-width="0.6"
            class="state-path clickable"
            role="button"
            tabindex={state.name === tabStop ? 0 : -1}
            aria-pressed={isSelected}
            aria-label={stateLabel(state.name, count, true)}
            on:click={() => handleClick(state.name)}
            on:keydown={(e) => handleKeydown(e, state.name)}
            on:mouseenter={(e) => handleMouseEnter(e, state.name, count)}
            on:mouseleave={handleMouseLeave}
            on:focus={(e) => handleFocus(e, state.name, count)}
            on:blur={handleBlur}
          />
        {:else if canHover}
          <!-- Info-only state (e.g. a holdover): focusable so keyboard and
               screen-reader users get the same details as the hover tooltip. -->
          <!-- Arrow keys on it move the map's single Tab stop (roving tabindex). -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
          <path
            d={state.pathData}
            data-state={state.name}
            fill={getFill(state.name)}
            stroke="var(--map-stroke)"
            stroke-width="0.6"
            class="state-path info"
            role="img"
            tabindex={state.name === tabStop ? 0 : -1}
            aria-label={stateLabel(state.name, count, false)}
            on:keydown={(e) => handleKeydown(e, state.name)}
            on:mouseenter={(e) => handleMouseEnter(e, state.name, count)}
            on:mouseleave={handleMouseLeave}
            on:focus={(e) => handleFocus(e, state.name, count)}
            on:blur={handleBlur}
          />
        {:else}
          <path
            d={state.pathData}
            data-state={state.name}
            fill={getFill(state.name)}
            stroke="var(--map-stroke)"
            stroke-width="0.6"
            class="state-path"
            aria-hidden="true"
          />
        {/if}
      {/each}

      {#if selectedFeature}
        <path
          d={selectedFeature.pathData}
          data-selected-outline={selectedFeature.name}
          fill="none"
          stroke="var(--map-selected-stroke)"
          stroke-width="2.5"
          stroke-linejoin="round"
          pointer-events="none"
          aria-hidden="true"
        />
      {/if}

      {#if focusRingFeature}
        <!-- Keyboard focus ring: a light halo under a dark stroke, so it reads
             on light and dark fills alike. Widths are in screen pixels. -->
        <path
          d={focusRingFeature.pathData}
          class="focus-ring-halo"
          fill="none"
          stroke-width="8"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
          pointer-events="none"
          aria-hidden="true"
        />
        <path
          d={focusRingFeature.pathData}
          class="focus-ring-stroke"
          fill="none"
          stroke-width="2.5"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
          pointer-events="none"
          aria-hidden="true"
        />
      {/if}
    </svg>
    <span id="{mapId}-end" tabindex="-1" class="map-end"></span>

    {#if hoveredStateName && stateTooltips[hoveredStateName]}
      {@const tip = stateTooltips[hoveredStateName]}
      <div
        class="tooltip"
        aria-hidden="true"
        use:measureTooltip={hoveredStateName}
        style="left: 0; top: 0; transform: {tooltipTransform};"
      >
        <span class="tooltip-state">{tip.title}</span>
        {#if tip.subtitle}
          <span class="text-xs text-gray-300 font-medium">{tip.subtitle}</span>
        {/if}
        {#if tip.badge}
          <span class="tooltip-badge {tip.badgeClass ?? ''}">{tip.badge}</span>
        {/if}
        {#if tip.details && tip.details.length > 0}
          <div
            class="mt-1.5 pt-1.5 border-t border-white/10 w-full text-center flex flex-col gap-0.5 animate-fade-in"
          >
            {#each tip.details as detail}
              <span class="text-xs text-white/90 font-medium">{detail}</span>
            {/each}
          </div>
        {/if}
      </div>
    {:else if hoveredStateName}
      <div
        class="tooltip"
        aria-hidden="true"
        use:measureTooltip={hoveredStateName}
        style="left: 0; top: 0; transform: {tooltipTransform};"
      >
        <span class="tooltip-state">{hoveredStateName}</span>
        {#if hoveredStateCount > 0}
          <span class="tooltip-badge"
            >{hoveredStateCount}
            {hoveredStateCount === 1 ? "Race" : "Races"}</span
          >
          {#if matchingCandidatesByState[hoveredStateName] && matchingCandidatesByState[hoveredStateName].length > 0}
            <div
              class="mt-1.5 pt-1.5 border-t border-white/10 w-full text-center"
            >
              <span
                class="text-xs text-gray-300 font-semibold block mb-0.5 tracking-wide uppercase"
                >Matches</span
              >
              <div
                class="text-xs text-white/90 font-medium leading-tight max-w-[160px] mx-auto"
              >
                {matchingCandidatesByState[hoveredStateName].join(", ")}
              </div>
            </div>
          {/if}
        {:else}
          <span class="tooltip-no-races">No active races</span>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  :root {
    /* Teal, not blue: this map marks where research exists, so it must not
       read as a party result map. The --color-*-d / --color-*-r ramps below
       are the forecast's party ratings and stay blue/red on purpose. */
    --map-active: #0d9488;
    /* Selection is UI chrome, so it uses the primary accent. */
    --map-selected: #1d4ed8;
    --map-selected-stroke: #ffffff;
    --map-inactive: #f1f5f9;
    --map-stroke: #d1d5db;
    /* Elections directory: neutral slate ramp, light to dark by race count. */
    --map-count-1: #cbd5e1;
    --map-count-2: #94a3b8;
    --map-count-3: #64748b;
    --map-count-4: #334155;

    --color-safe-d: #1d4ed8;
    --color-likely-d: #3b82f6;
    --color-lean-d: #60a5fa;
    --color-tilt-d: #93c5fd;
    --color-tossup: #cbd5e1;
    --color-tilt-r: #fca5a5;
    --color-lean-r: #f87171;
    --color-likely-r: #ef4444;
    --color-safe-r: #b91c1c;
    --color-other: #94a3b8;
    --color-holdover-d: rgba(59, 130, 246, 0.18);
    --color-holdover-r: rgba(239, 68, 68, 0.18);
    --color-holdover-d-solid: #dbeafe;
    --color-holdover-r-solid: #fee2e2;
    /* Distinct from Toss-up: a hatched neutral for "no forecast yet". */
    --color-no-forecast-bg: #f8fafc;
    --color-no-forecast-line: #cbd5e1;
  }

  :global(.dark) {
    --map-active: #14b8a6;
    --map-selected: #60a5fa;
    --map-selected-stroke: #f8fafc;
    --map-inactive: #1f2937;
    --map-stroke: #374151;
    /* On a dark card more races = brighter, so intensity still climbs. */
    --map-count-1: #475569;
    --map-count-2: #64748b;
    --map-count-3: #94a3b8;
    --map-count-4: #cbd5e1;

    /* On a dark card, intensity climbs with brightness: each step mixes more
       of the party color into the gray-900 surface (45/62/80/100%), so Safe is the most vivid
       and Tilt the most muted, and Toss-up stays a visible mid-gray. */
    --color-safe-d: #3b82f6;
    --color-likely-d: #336dcd;
    --color-lean-d: #2b5aa7;
    --color-tilt-d: #244884;
    --color-tossup: #6b7280;
    --color-tilt-r: #752c34;
    --color-lean-r: #9b3339;
    --color-likely-r: #c33b3e;
    --color-safe-r: #ef4444;
    --color-other: #64748b;
    /* Holdovers stay close to the surface so they never read as a Tilt. */
    --color-holdover-d: rgba(59, 130, 246, 0.12);
    --color-holdover-r: rgba(239, 68, 68, 0.12);
    --color-holdover-d-solid: #1b2c4d;
    --color-holdover-r-solid: #3a1e26;
    --color-no-forecast-bg: #0f172a;
    --color-no-forecast-line: #475569;
  }

  .state-path {
    transition:
      fill 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      filter 0.2s ease,
      stroke-width 0.2s ease,
      transform 0.2s ease;
    cursor: default;
    transform-origin: 487.5px 305px;
  }

  .state-path.clickable {
    cursor: pointer;
  }

  .state-path.clickable:hover {
    filter: brightness(1.15) drop-shadow(0 6px 16px rgba(15, 23, 42, 0.25));
    transform: scale(1.012);
  }

  .state-path:focus {
    outline: none;
  }

  /* The visible focus indicator is the overlay ring drawn last in the SVG
     (see focusRingFeature), so a neighbor never paints over it. */
  .state-path.info:focus-visible,
  .state-path.clickable:focus-visible {
    outline: none;
  }

  .focus-ring-halo {
    stroke: #ffffff;
  }

  .focus-ring-stroke {
    stroke: #0f172a;
  }

  @media (forced-colors: active) {
    .focus-ring-halo {
      stroke: Canvas;
    }
    .focus-ring-stroke {
      stroke: Highlight;
    }
  }

  .map-skip {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 30;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .map-skip:focus {
    width: auto;
    height: auto;
    clip: auto;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: #1d4ed8;
    color: #ffffff;
    font-size: 0.875rem;
    font-weight: 700;
    outline: 2px solid #ffffff;
    outline-offset: -4px;
  }

  .map-end:focus {
    outline: none;
  }

  .map-container {
    position: relative;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
  }

  .tooltip {
    position: absolute;
    pointer-events: none;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #f8fafc;
    padding: 8px 12px;
    border-radius: 8px;
    transform: translate(-50%, calc(-100% - 10px));
    z-index: 20;
    box-shadow:
      0 10px 15px -3px rgba(0, 0, 0, 0.3),
      0 4px 6px -4px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    max-width: min(260px, 100%);
    text-align: center;
  }

  :global(.dark) .tooltip {
    background: rgba(15, 23, 42, 0.85);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .tooltip-state {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.025em;
  }

  .tooltip-badge {
    font-size: 0.7rem;
    background: #3b82f6;
    color: white;
    padding: 2px 8px;
    border-radius: 9999px;
    font-weight: 600;
  }

  .tooltip-no-races {
    font-size: 0.7rem;
    color: #94a3b8;
    font-weight: 500;
  }

  .map-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 280px;
    border-radius: 8px;
    border: 1px dashed var(--map-stroke);
    font-size: 0.875rem;
    text-align: center;
    padding: 1rem;
  }

  .map-retry {
    min-height: 2.75rem;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 700;
    text-decoration: underline;
  }

  .skeleton {
    width: 100%;
    height: 280px;
    border-radius: 8px;
    background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
  }

  :global(.dark) .skeleton {
    background: linear-gradient(90deg, #1f2937 25%, #374151 50%, #1f2937 75%);
    background-size: 200% 100%;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
