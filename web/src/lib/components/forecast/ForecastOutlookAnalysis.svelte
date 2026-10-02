<script lang="ts">
  import type { ChamberForecastDetails } from "$lib/types";
  import type { ForecastTab } from "$lib/utils/forecast";

  export let activeTab: ForecastTab;
  export let chamberSummary: ChamberForecastDetails | undefined;
  export let chamberNarrative: string;

  let expanded = false;
  $: hasAdditionalAnalysis = Boolean(
    chamberSummary?.why_party_favored ||
    chamberSummary?.opposing_party_path ||
    chamberSummary?.key_uncertainty,
  );
  // Never invent an outlook: with no bottom line or narrative, say so.
  $: summary = chamberSummary?.bottom_line || chamberNarrative || "";

  const PARTY_TEXT_CLASS = {
    Democratic: "text-blue-700 dark:text-blue-400",
    Republican: "text-red-700 dark:text-red-400",
    neutral: "text-content",
  } as const;

  let controlParty: "Democratic" | "Republican" | null = null;
  $: controlParty =
    chamberSummary?.control_party === "Democratic" ||
    chamberSummary?.control_party === "Republican"
      ? chamberSummary.control_party
      : null;
  let opposingParty: "Democratic" | "Republican" | null = null;
  $: opposingParty =
    controlParty === "Democratic"
      ? "Republican"
      : controlParty === "Republican"
        ? "Democratic"
        : null;
  $: favoredHeading =
    controlParty === "Democratic"
      ? "Why Democrats Are Favored"
      : controlParty === "Republican"
        ? "Why Republicans Are Favored"
        : "Why the Projected Leader Is Favored";
  $: opposingHeading = opposingParty
    ? `${opposingParty} Path to Control`
    : "Trailing Side's Path to Control";
  $: favoredClass = PARTY_TEXT_CLASS[controlParty ?? "neutral"];
  $: opposingClass = PARTY_TEXT_CLASS[opposingParty ?? "neutral"];
  $: panelId = `forecast-outlook-${activeTab}`;
</script>

<section class="card overflow-hidden">
  <div
    class="flex flex-col gap-3 border-b border-stroke/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
  >
    <div>
      <h3 class="h-card">Outlook &amp; analysis</h3>
      <p class="mt-1 text-sm text-content-subtle">
        Structured assessment of the {activeTab === "house"
          ? "House"
          : activeTab === "senate"
            ? "Senate"
            : "Governor"} map
      </p>
    </div>
    {#if hasAdditionalAnalysis}
      <button
        type="button"
        on:click={() => (expanded = !expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        class="btn-secondary shrink-0"
      >
        {expanded ? "Hide full analysis" : "Show full analysis"}
      </button>
    {/if}
  </div>

  <div class="px-5 py-4">
    {#if summary}
      <p class="max-w-prose text-base font-normal leading-7 text-content-muted">
        {summary}
      </p>
    {:else}
      <p class="text-sm leading-relaxed text-content-muted">
        No outlook analysis is available yet for this chamber.
      </p>
    {/if}
  </div>

  {#if hasAdditionalAnalysis}
    <div
      id={panelId}
      class:hidden={!expanded}
      class="grid grid-cols-1 gap-4 border-t border-stroke/40 bg-surface-alt/30 p-5 md:grid-cols-3"
    >
      {#if chamberSummary?.why_party_favored}
        <article class="rounded-xl border border-stroke bg-surface p-4">
          <h4 class="text-xs font-bold uppercase tracking-wider {favoredClass}">
            {favoredHeading}
          </h4>
          <p
            class="mt-2 max-w-prose text-sm font-normal leading-7 text-content-muted"
          >
            {chamberSummary.why_party_favored}
          </p>
        </article>
      {/if}

      {#if chamberSummary?.opposing_party_path}
        <article class="rounded-xl border border-stroke bg-surface p-4">
          <h4
            class="text-xs font-bold uppercase tracking-wider {opposingClass}"
          >
            {opposingHeading}
          </h4>
          <p
            class="mt-2 max-w-prose text-sm font-normal leading-7 text-content-muted"
          >
            {chamberSummary.opposing_party_path}
          </p>
        </article>
      {/if}

      {#if chamberSummary?.key_uncertainty}
        <article class="rounded-xl border border-stroke bg-surface p-4">
          <h4
            class="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-yellow-400"
          >
            Key Risk & Uncertainty
          </h4>
          <p
            class="mt-2 max-w-prose text-sm font-normal leading-7 text-content-muted"
          >
            {chamberSummary.key_uncertainty}
          </p>
        </article>
      {/if}
    </div>
  {/if}
</section>
