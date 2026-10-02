<script lang="ts">
  import { browser } from "$app/environment";
  import type { RaceSummary } from "$lib/types";
  import {
    formatRating,
    getRaceState,
    isUncontestedForecastRace,
    raceHref,
  } from "$lib/utils/forecast";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import {
    cleanDisplayText,
    probability,
    raceShortLabel,
    ratingClass,
  } from "$lib/utils/forecastPresentation";
  import { scrollBehavior } from "$lib/utils/motion";

  export let races: RaceSummary[];

  /**
   * Card label: a House seat needs its district ("AZ-01 · Arizona"), or two
   * cards in one state read as duplicates; statewide races keep the state.
   */
  function keyRaceLabel(race: RaceSummary): string {
    const state = getRaceState(race);
    const short = raceShortLabel(race);
    if (short && short.includes("-")) {
      return state ? `${short} · ${state}` : short;
    }
    return state || race.title || race.id;
  }

  let keyRacesContainer: HTMLDivElement;
  function scrollKeyRaces(dir: number) {
    keyRacesContainer?.scrollBy({
      left: dir * 320,
      behavior: scrollBehavior(),
    });
  }
</script>

{#if races.length > 0}
  <section class="space-y-4">
    <div
      class="flex items-end justify-between gap-4 border-b border-stroke pb-3"
    >
      <div>
        <h3 class="h-section">Races That Matter Most</h3>
        <p class="mt-1 hidden text-sm text-content-subtle sm:block">
          Competitive races with the greatest modeled implications for chamber
          control
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          on:click={() => scrollKeyRaces(-1)}
          type="button"
          class="h-11 w-11 rounded-lg border border-stroke bg-surface hover:bg-surface-alt flex items-center justify-center text-content-subtle hover:text-content transition-colors"
          aria-label="Scroll left"
        >
          <svg
            aria-hidden="true"
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <button
          on:click={() => scrollKeyRaces(1)}
          type="button"
          class="h-11 w-11 rounded-lg border border-stroke bg-surface hover:bg-surface-alt flex items-center justify-center text-content-subtle hover:text-content transition-colors"
          aria-label="Scroll right"
        >
          <svg
            aria-hidden="true"
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    </div>

    <div
      bind:this={keyRacesContainer}
      class="flex gap-4 overflow-x-auto pb-3 motion-safe:scroll-smooth snap-x snap-mandatory hide-scrollbar"
      style="-ms-overflow-style: none; scrollbar-width: none;"
    >
      {#each races as race}
        {@const uncontested = isUncontestedForecastRace(race)}
        {@const rating = race.forecast?.rating}
        {@const ratingBorderColor = rating
          ? rating.endsWith("_d")
            ? "border-l-blue-500"
            : rating.endsWith("_r")
              ? "border-l-red-500"
              : "border-l-yellow-500"
          : "border-l-slate-400"}
        <div
          class={`card snap-start shrink-0 w-[min(300px,85vw)] flex flex-col p-4 hover:shadow-md transition-all border-l-[3px] ${ratingBorderColor}`}
        >
          <div class="flex items-center justify-between mb-2">
            <a
              href={browser ? raceHref(race.id) : undefined}
              class="inline-flex min-h-11 min-w-0 items-center font-bold text-sm text-content hover:text-primary-700 dark:hover:text-primary-300"
            >
              <span class="truncate">{keyRaceLabel(race)}</span>
            </a>
            {#if rating}
              <span
                class={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ml-2 ${ratingClass(
                  uncontested ? "other" : rating,
                )}`}
              >
                {uncontested ? "Uncontested" : formatRating(rating)}
              </span>
            {/if}
          </div>

          {#if race.forecast && !uncontested}
            <div class="flex items-center gap-3 mb-2">
              <span class="text-xs font-bold text-content tabular-nums">
                {probability(race.forecast.win_probability)} win
              </span>
              {#if race.forecast.margin_estimate !== undefined && race.forecast.margin_estimate !== null}
                <span
                  class="text-xs text-content-subtle font-semibold tabular-nums"
                >
                  {race.forecast.margin_estimate > 0
                    ? "+"
                    : ""}{race.forecast.margin_estimate.toFixed(1)} pts margin
                </span>
              {/if}
            </div>
          {/if}

          <p class="mb-3 text-sm text-content-muted leading-6 line-clamp-2">
            {cleanDisplayText(
              race.forecast?.takeaway ||
                (race.forecast?.rationale
                  ? race.forecast.rationale.split(/[.!?]/)[0] + "."
                  : "No takeaway available."),
            )}
          </p>

          <div class="mt-auto pt-2 border-t border-stroke">
            <a
              href={browser ? raceHref(race.id) : undefined}
              class="inline-flex min-h-11 items-center gap-1.5 text-xs text-primary-700 dark:text-primary-300 font-bold hover:underline"
            >
              View details<span class="sr-only"> for {keyRaceLabel(race)}</span>
              <UiIcon name="arrow-right" size="sm" />
            </a>
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}
