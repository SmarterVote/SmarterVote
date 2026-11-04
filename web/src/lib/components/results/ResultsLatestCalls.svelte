<script lang="ts">
  import { partyAbbr, partyBadgeClass } from "$lib/utils/party";
  import { formatAgo, type LatestCall } from "$lib/utils/resultsPage";

  export let calls: LatestCall[] = [];
  /** The page's clock, so "N min ago" ticks without a refetch. */
  export let now: number = Date.now();

  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
</script>

<section class="card p-4" aria-labelledby="latest-calls-heading">
  <h2 id="latest-calls-heading" class="text-sm font-bold text-content">
    Latest calls
  </h2>
  {#if calls.length}
    <ol class="mt-2 divide-y divide-stroke/60" data-testid="latest-calls">
      {#each calls as call (call.id)}
        <li class="py-2">
          <a
            href={`/races/${call.id}/`}
            class="group flex items-start justify-between gap-3"
          >
            <span class="min-w-0">
              <span
                class="block text-sm font-semibold text-content group-hover:text-primary-700 group-hover:underline dark:group-hover:text-primary-300"
                >{call.title}</span
              >
              <span class="block text-xs text-content-muted">
                {call.winner} wins{call.calledBy
                  ? `, called by ${call.calledBy}`
                  : ""}
                ·
                <time datetime={call.calledAt} title={clock(call.calledAt)}
                  >{formatAgo(call.calledAt, now)}</time
                >
              </span>
            </span>
            <span class="flex shrink-0 items-center gap-1.5">
              {#if call.flip}
                <span
                  class="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-bold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
                  title="The winner's party differs from the incumbent's"
                  >Flip</span
                >
              {/if}
              <span
                class="rounded-md px-1.5 py-0.5 text-xs font-bold {partyBadgeClass(
                  call.party ?? undefined,
                )}"
                ><span class="sr-only">Party: </span>{partyAbbr(
                  call.party ?? undefined,
                )}</span
              >
            </span>
          </a>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="mt-2 text-sm text-content-muted">
      No race has been called yet. Calls appear here as news organizations make
      them.
    </p>
  {/if}
</section>
