<script lang="ts">
  import CandidateComparison from "$lib/components/compare/CandidateComparison.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { Race } from "$lib/types";
  import { neutralCandidateOrder } from "$lib/utils/candidates";
  import { candidateSlug } from "$lib/utils/format";
  import { scrollBehavior } from "$lib/utils/motion";
  import {
    cleanDisplayText,
    officeDisplayName,
    raceShortLabel,
  } from "$lib/utils/forecastPresentation";

  /**
   * Some stored stance text still carries JSON escapes (`\"Medicare for
   * Y'all\"`). Clean every string in the featured race before it reaches the
   * shared comparison components, which render text verbatim.
   */
  function cleanStrings<T>(value: T): T {
    if (typeof value === "string") return cleanDisplayText(value) as T;
    if (Array.isArray(value)) return value.map(cleanStrings) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cleanStrings(item)]),
      ) as T;
    }
    return value;
  }

  /** Short chip text: "TX Senate", "OH Governor", or "AZ-01" for a district. */
  function chipLabel(race: Race): string {
    const short = raceShortLabel(race);
    if (short?.includes("-")) return short;
    const office = officeDisplayName(race.office).replace(/^U\.S\.\s+/, "");
    return [short ?? race.jurisdiction, office].filter(Boolean).join(" ");
  }

  export let races: Race[] = [];
  let selectedId = races[0]?.id ?? "";
  let pillList: HTMLDivElement | undefined;
  $: if (races.length && !races.some((race) => race.id === selectedId))
    selectedId = races[0].id;
  $: selectedIndex = races.findIndex((race) => race.id === selectedId);
  $: selectedRace = cleanStrings(races[selectedIndex] ?? races[0]);
  $: candidates = neutralCandidateOrder(
    selectedRace?.candidates.filter((candidate) => !candidate.withdrawn),
  );
  // Keep the active pill visible when the selection changes from either the
  // arrow buttons or a pill click.
  $: centerPill(selectedIndex);

  function centerPill(index: number) {
    const pill = pillList?.children[index] as HTMLElement | undefined;
    if (!pill || !pillList || typeof pillList.scrollTo !== "function") return;
    pillList.scrollTo({
      left: Math.max(
        0,
        pill.offsetLeft - (pillList.clientWidth - pill.offsetWidth) / 2,
      ),
      behavior: scrollBehavior(),
    });
  }

  function moveRace(direction: number) {
    const next = (selectedIndex + direction + races.length) % races.length;
    selectedId = races[next]?.id ?? selectedId;
  }
</script>

{#if selectedRace && candidates.length >= 2}
  <div
    class="flex flex-col overflow-hidden rounded-2xl border border-stroke bg-surface shadow-xl shadow-slate-900/5"
  >
    <div
      class="flex flex-col gap-4 border-b border-stroke bg-surface-alt/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7"
    >
      <div>
        <p class="eyebrow">Featured comparison</p>
        <h2
          class="mt-2 text-xl font-bold tracking-tight text-content sm:text-2xl"
        >
          {selectedRace.title}
        </h2>
      </div>
      <a
        href="/races/{selectedRace.id}/"
        class="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"
        >Open race page <UiIcon name="arrow-right" size="sm" /></a
      >
    </div>

    <div
      class="border-b border-stroke px-4 py-3 sm:px-6"
      role="group"
      aria-label="Choose a featured race"
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          on:click={() => moveRace(-1)}
          class="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-stroke bg-surface text-lg text-content transition hover:border-primary-400 hover:text-primary"
          aria-label="Previous featured race"
          ><UiIcon name="arrow-left" /></button
        >
        <div
          bind:this={pillList}
          class="chip-scroller hide-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto px-3 py-1"
        >
          {#each races as race, index}
            <button
              type="button"
              on:click={() => (selectedId = race.id)}
              aria-pressed={selectedId === race.id}
              class="min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition {selectedId ===
              race.id
                ? 'border-content bg-content text-surface'
                : 'border-stroke bg-surface text-content-muted hover:border-content-subtle hover:text-content'}"
              title="{race.jurisdiction} · {race.office}"
            >
              <span class="mr-1 tabular-nums opacity-70"
                >{String(index + 1).padStart(2, "0")}</span
              >
              {chipLabel(race)}
            </button>
          {/each}
        </div>
        <button
          type="button"
          on:click={() => moveRace(1)}
          class="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-stroke bg-surface text-lg text-content transition hover:border-primary-400 hover:text-primary"
          aria-label="Next featured race"><UiIcon name="arrow-right" /></button
        >
      </div>
    </div>

    <section class="p-3 lg:p-5" aria-label="Featured comparison preview">
      <CandidateComparison
        race={selectedRace}
        {candidates}
        compact
        collapseText
        showQuality
      />
      <div class="mt-4 flex justify-end">
        <a
          href="/races/{selectedRace.id}/compare/?candidates={candidates
            .map((candidate) => candidateSlug(candidate.name))
            .join(',')}"
          class="btn-primary no-underline"
        >
          Compare all {candidates.length} candidates
          <UiIcon name="arrow-right" size="sm" />
        </a>
      </div>
    </section>
  </div>
{/if}

<style>
  /* Fade the chip row's edges so clipped chips read as "scroll for more". */
  .chip-scroller {
    -webkit-mask-image: linear-gradient(
      to right,
      transparent,
      #000 0.75rem,
      #000 calc(100% - 1.5rem),
      transparent
    );
    mask-image: linear-gradient(
      to right,
      transparent,
      #000 0.75rem,
      #000 calc(100% - 1.5rem),
      transparent
    );
  }
</style>
