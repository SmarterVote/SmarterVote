<script lang="ts">
  /**
   * The compact race card shared by the key-races strip and the closest and
   * biggest-lead lists: a party-colored top strip for the leader or winner,
   * the leader's headshot and party, the lead in points, a two-way margin
   * bar and a counted meter. The whole card is one link to the race page.
   */
  import CandidateAvatar from "$lib/components/CandidateAvatar.svelte";
  import type { ResultGroup, ResultContender } from "$lib/utils/results";
  import {
    partyAbbr,
    partyBadgeClass,
    partyBarClass,
    partyRing,
  } from "$lib/utils/party";
  import ResultsCountedBar from "./ResultsCountedBar.svelte";
  import ResultsMarginBar from "./ResultsMarginBar.svelte";

  export let id: string;
  export let title: string;
  export let group: ResultGroup;
  export let leader: string | null = null;
  export let party: string | null = null;
  export let margin: number | null = null;
  export let pctReporting: number | null = null;
  export let contenders: ResultContender[] = [];

  $: called = group === "called";
  $: hasLeader = group !== "awaiting" && !!leader;
  $: razor = group === "counting" && margin !== null && margin < 1;
  $: leaderImage =
    contenders.find((c) => c.name === leader)?.imageUrl ??
    (contenders[0]?.name === leader ? contenders[0]?.imageUrl : null);
  $: statusText =
    group === "awaiting"
      ? "Awaiting results"
      : group === "pending"
        ? "Runoff or ranked-choice"
        : called
          ? "Called"
          : razor
            ? "Razor-thin"
            : "Counting";
  $: verb = called ? "Wins" : margin !== null && margin <= 0 ? "Tied" : "Ahead";

  function lead(value: number | null): string {
    if (value === null) return "";
    if (value <= 0) return "Tied";
    if (value < 0.1) return "+<0.1";
    return `+${value.toFixed(1)}`;
  }
</script>

<a
  href={`/races/${id}/`}
  class="tile card group relative flex h-full flex-col gap-2.5 overflow-hidden p-3 pt-3.5 outline-hidden transition duration-150 hover:-translate-y-0.5 hover:border-primary-400/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-page motion-reduce:transform-none dark:hover:border-primary-500/60"
  class:razor
>
  <span
    class="absolute inset-x-0 top-0 h-1 {hasLeader
      ? partyBarClass(party)
      : 'bg-stroke'}"
    aria-hidden="true"
  ></span>

  <span class="flex items-start justify-between gap-2">
    <span
      class="min-w-0 text-sm font-semibold leading-snug text-content group-hover:text-primary-700 dark:group-hover:text-primary-300"
      >{title}</span
    >
    <span
      class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 {called
        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200'
        : razor
          ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600/70 dark:bg-amber-950/50 dark:text-amber-100'
          : group === 'counting'
            ? 'border-stroke bg-surface-alt text-content-muted'
            : 'border-stroke bg-surface text-content-subtle'}"
    >
      {#if called}
        <svg
          viewBox="0 0 16 16"
          class="h-3 w-3"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg
        >
      {:else if group === "counting"}
        <span
          class="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
          aria-hidden="true"
        ></span>
      {/if}
      {statusText}
    </span>
  </span>

  {#if hasLeader && leader}
    <span class="flex items-center gap-2.5">
      <CandidateAvatar
        name={leader}
        imageUrl={leaderImage}
        size={34}
        class="ring-2 ring-offset-1 ring-offset-surface {partyRing(party)}"
      />
      <span class="min-w-0 flex-1">
        <span
          class="line-clamp-2 text-sm font-semibold leading-tight break-words text-content"
          title={leader}>{leader}</span
        >
        <span
          class="mt-0.5 flex items-center gap-1.5 text-xs text-content-muted"
        >
          {#if party}
            <span
              class="rounded-sm px-1 py-px text-[11px] font-bold leading-4 {partyBadgeClass(
                party,
              )}"
              title={party}
              ><span class="sr-only">Party:&nbsp;</span>{partyAbbr(party)}</span
            >
          {/if}
          <span>{verb}</span>
        </span>
      </span>
      {#if margin !== null}
        <span class="shrink-0 text-right leading-none">
          <span
            class="block text-xl font-extrabold tabular-nums {razor
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-content'}"
            ><span class="sr-only"
              >{party ? `${partyAbbr(party)} lead ` : ""}</span
            >{lead(margin)}</span
          >
          <span
            class="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-content-subtle"
            >{margin > 0 ? "pts" : ""}</span
          >
        </span>
      {/if}
    </span>
    <ResultsMarginBar {contenders} />
  {:else}
    <span class="text-xs text-content-muted">
      {group === "awaiting"
        ? "No votes reported yet"
        : group === "pending"
          ? "Headed to a runoff or ranked-choice count"
          : "Counting has started"}
    </span>
  {/if}

  {#if group !== "awaiting"}
    <div class="mt-auto"><ResultsCountedBar pct={pctReporting} /></div>
  {/if}
</a>

<style>
  .tile.razor {
    border-color: rgb(245 158 11 / 0.7);
    box-shadow:
      0 0 0 1px rgb(245 158 11 / 0.35),
      0 1px 2px rgb(0 0 0 / 0.05);
  }
</style>
