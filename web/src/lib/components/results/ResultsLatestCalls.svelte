<script lang="ts">
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import {
    partyAbbr,
    partyBadgeClass,
    partyBarClass,
    partyRing,
  } from "$lib/utils/party";
  import { formatLead, formatPctReporting } from "$lib/utils/results";
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

<section aria-labelledby="latest-calls-heading" class="flex min-w-0 flex-col">
  <h2 id="latest-calls-heading" class="text-sm font-bold text-content">
    Latest calls
  </h2>
  {#if calls.length}
    <!-- On wide screens the list fills the key-races column's height and
         scrolls inside it, so the two columns end together. -->
    <div class="mt-2 lg:relative lg:min-h-80 lg:flex-1">
      <ol
        class="calls flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:absolute lg:-inset-1 lg:grid-cols-1 lg:content-start lg:overflow-y-auto lg:p-1"
        data-testid="latest-calls"
      >
        {#each calls as call (call.id)}
          {@const counted = formatPctReporting(call.pctReporting)}
          {@const shown = formatLead(call.margin, call.voteMargin)}
          <li
            class="w-[82%] max-w-80 shrink-0 snap-start sm:w-auto sm:max-w-none"
          >
            <a
              href={`/races/${call.id}/`}
              class="card group relative flex h-full flex-col gap-2 overflow-hidden p-3 pt-3.5 outline-hidden transition duration-150 hover:-translate-y-0.5 hover:border-primary-400/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-page motion-reduce:transform-none dark:hover:border-primary-500/60"
            >
              <span
                class="absolute inset-x-0 top-0 h-1 {partyBarClass(call.party)}"
                aria-hidden="true"
              ></span>
              <span class="flex flex-wrap items-center gap-1.5">
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold leading-4 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  <svg
                    viewBox="0 0 16 16"
                    class="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg
                  >Called
                </span>
                {#if call.flip}
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-extrabold uppercase leading-4 tracking-wide text-slate-950 shadow-xs dark:bg-amber-400"
                    title="The winner's party differs from the incumbent's"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      class="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                      ><path d="M3 5h9l-2.5-2.5M13 11H4l2.5 2.5" /></svg
                    >Flip
                  </span>
                {/if}
                {#if call.calledAt && formatAgo(call.calledAt, now)}
                  <time
                    class="ml-auto rounded-full bg-surface-alt px-2 py-0.5 text-[11px] font-semibold leading-4 tabular-nums text-content-muted"
                    datetime={call.calledAt}
                    title={clock(call.calledAt)}
                    >{formatAgo(call.calledAt, now)}</time
                  >
                {/if}
              </span>
              <span
                class="text-sm font-semibold leading-snug text-content group-hover:text-primary-700 dark:group-hover:text-primary-300"
                >{call.title}</span
              >
              <span class="flex items-center gap-2.5">
                <CandidateAvatar
                  name={call.winner}
                  imageUrl={call.winnerImage}
                  size={36}
                  class="ring-2 ring-offset-1 ring-offset-surface {partyRing(
                    call.party,
                  )}"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-sm font-semibold text-content"
                      >{call.winner} wins</span
                    >
                    <span
                      class="shrink-0 rounded-sm px-1 py-px text-[11px] font-bold leading-4 {partyBadgeClass(
                        call.party ?? undefined,
                      )}"
                      title={call.party ?? undefined}
                      ><span class="sr-only">Party:&nbsp;</span>{partyAbbr(
                        call.party ?? undefined,
                      )}</span
                    >
                  </span>
                  <span class="block truncate text-[11px] text-content-subtle"
                    >{[
                      call.calledBy ? `called by ${call.calledBy}` : "",
                      counted ? `${counted} counted` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}</span
                  >
                </span>
                {#if shown}
                  <span class="shrink-0 text-right leading-none">
                    <span
                      class="block text-lg font-extrabold tabular-nums text-content"
                      >{shown.value}</span
                    >
                    {#if shown.unit}
                      <span
                        class="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-content-subtle"
                        >{shown.unit}</span
                      >
                    {/if}
                  </span>
                {/if}
              </span>
            </a>
          </li>
        {/each}
      </ol>
    </div>
  {:else}
    <p
      class="mt-2 rounded-xl border border-dashed border-stroke p-4 text-sm text-content-muted"
    >
      No race has been called yet. Calls appear here as news organizations make
      them.
    </p>
  {/if}
</section>

<style>
  /* Phones scroll the calls sideways; keep the bar thin and out of the way. */
  .calls {
    scrollbar-width: thin;
    scroll-padding-inline: 0.25rem;
  }
</style>
