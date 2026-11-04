<script lang="ts">
  import { partyAbbr, partyBadgeClass } from "$lib/utils/party";
  import { formatPctReporting, lastName } from "$lib/utils/results";
  import type { KeyRace } from "$lib/utils/resultsPage";

  export let races: KeyRace[] = [];

  function status(race: KeyRace): string {
    if (race.group === "awaiting") return "Awaiting results";
    if (race.group === "pending") return "Runoff or ranked-choice";
    const counted = formatPctReporting(race.pctReporting);
    const tail = counted ? ` · ${counted} counted` : "";
    if (race.group === "called")
      return `${race.leader ? `${lastName(race.leader)} wins` : "Called"}${tail}`;
    if (!race.leader) return `Counting${tail}`;
    return `${lastName(race.leader)} ahead${tail}`;
  }

  function badge(race: KeyRace): string {
    if (race.group === "called") return partyAbbr(race.party ?? undefined);
    if (race.margin === null) return partyAbbr(race.party ?? undefined);
    if (race.margin <= 0) return "Tied";
    const lead = race.margin < 0.1 ? "<0.1" : race.margin.toFixed(1);
    return `${partyAbbr(race.party ?? undefined)} +${lead}`;
  }
</script>

{#if races.length}
  <section aria-labelledby="key-races-heading">
    <h2 id="key-races-heading" class="text-sm font-bold text-content">
      Key Senate and governor races
    </h2>
    <ul
      class="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-3"
      data-testid="key-races"
    >
      {#each races as race (race.id)}
        <li>
          <a
            href={`/races/${race.id}/`}
            class="card group flex h-full flex-col-reverse items-start justify-end gap-1.5 p-3 sm:flex-row sm:justify-between sm:gap-2 transition-colors hover:border-primary-400/60 dark:hover:border-primary-500/60"
          >
            <span class="min-w-0">
              <span
                class="block text-sm font-semibold text-content group-hover:text-primary-700 dark:group-hover:text-primary-300"
                >{race.title}</span
              >
              <span class="block text-xs text-content-muted"
                >{status(race)}</span
              >
            </span>
            {#if race.group !== "awaiting" && race.party !== null && race.leader}
              <span
                class="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums {partyBadgeClass(
                  race.party ?? undefined,
                )}">{badge(race)}</span
              >
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
