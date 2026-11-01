<script lang="ts">
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { PublicRaceResult } from "$lib/types";
  import { compareHref, namesWinner } from "$lib/utils/results";
  import ResultBars from "./ResultBars.svelte";
  import ResultStatusPill from "./ResultStatusPill.svelte";

  export let id: string;
  export let title: string;
  export let result: PublicRaceResult | null = null;

  $: hasRows = !!result?.candidates?.length;
  $: winner =
    result && namesWinner(result.status) ? result.winner_name : undefined;
  $: asOf = result?.as_of
    ? new Date(result.as_of).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
</script>

<article
  class="card flex flex-col gap-4 p-5 transition-colors hover:border-primary-400/60 dark:hover:border-primary-500/60"
>
  <div class="flex flex-col gap-2">
    <a
      href={`/races/${id}/`}
      class="text-base font-bold text-content transition-colors hover:text-primary-700 dark:hover:text-primary-300"
    >
      {title}
    </a>
    <ResultStatusPill status={result?.status ?? null} />
  </div>

  <div class="flex-1">
    {#if hasRows && result}
      <ResultBars
        rows={result.candidates}
        winnerName={winner}
        limit={3}
        compact
      />
    {:else}
      <p
        class="rounded-xl border border-dashed border-stroke bg-surface-alt/40 px-4 py-5 text-center text-sm text-content-subtle"
      >
        Counts appear here after polls close and votes are reported.
      </p>
    {/if}
  </div>

  <div
    class="flex items-center justify-between gap-3 border-t border-stroke pt-3"
  >
    <a
      href={compareHref(id)}
      class="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary-700 hover:underline dark:text-primary-300"
    >
      Compare positions <UiIcon name="arrow-right" size="sm" />
    </a>
    {#if asOf}
      <span class="text-xs text-content-subtle">As of {asOf}</span>
    {/if}
  </div>
</article>
