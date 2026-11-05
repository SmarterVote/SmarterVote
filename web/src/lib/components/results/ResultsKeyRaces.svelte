<script lang="ts">
  import type { KeyRace } from "$lib/utils/resultsPage";
  import ResultsRaceTile from "./ResultsRaceTile.svelte";

  export let races: KeyRace[] = [];
</script>

{#if races.length}
  <section aria-labelledby="key-races-heading" class="min-w-0">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3">
      <h2 id="key-races-heading" class="text-sm font-bold text-content">
        Key Senate and governor races
      </h2>
      <p class="text-xs text-content-subtle">
        Still counting first, closest lead first
      </p>
    </div>
    <ul
      class="mt-2 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
      data-testid="key-races"
    >
      {#each races as race (race.id)}
        <li class="min-w-0">
          <ResultsRaceTile
            id={race.id}
            title={race.title}
            group={race.group}
            leader={race.leader}
            party={race.party}
            margin={race.margin}
            voteMargin={race.voteMargin ?? null}
            status={race.status ?? null}
            pctReporting={race.pctReporting}
            contenders={race.contenders ?? []}
          />
        </li>
      {/each}
    </ul>
  </section>
{/if}
