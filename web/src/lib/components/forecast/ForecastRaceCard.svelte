<script lang="ts">
  import { browser } from "$app/environment";
  import { isExternalUrl } from "$lib/utils/url";
  import type { ForecastRace } from "$lib/utils/forecast";
  import { raceDisplayTitle } from "$lib/utils/raceTitle";
  import {
    formatRating,
    normalizeForecastParty,
    raceHref,
  } from "$lib/utils/forecast";
  import {
    getHostname,
    marketAsOf,
    marketSignalTarget,
    marketSpread,
    probability,
    probabilityOneDecimal,
    ratingClass,
  } from "$lib/utils/forecastPresentation";
  import { partyAbbr, partyBadgeClass } from "$lib/utils/party";
  import ForecastEvidenceLineage from "./ForecastEvidenceLineage.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";

  export let race: ForecastRace;
  export let isExpanded: boolean;
  export let onToggleExpand: () => void;

  $: party = normalizeForecastParty(
    race.forecast.predicted_winner_party,
    race.forecast.party_probabilities,
    race.candidates,
  );
  $: rating = race.forecast.rating;
  $: title = raceDisplayTitle(race);
  // Drop the location line when it only repeats the title ("Michigan" under
  // "2026 Michigan U.S. Senate Election").
  $: subtitle = (() => {
    const text = (race.jurisdiction ?? race.state ?? race.office ?? "").trim();
    if (!text || title.toLowerCase().includes(text.toLowerCase())) return "";
    return text;
  })();
  $: winnerName = race.forecast.predicted_winner_name || "";
</script>

<article
  class="card p-5 hover:border-primary-400/60 dark:hover:border-primary-500/60 transition-colors flex flex-col justify-between gap-4"
>
  <div class="space-y-4">
    <!-- Card Header: Title, Rating, and Details Link -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-start justify-between gap-2">
        <a
          href={browser ? raceHref(race.id) : undefined}
          class="text-base font-bold text-content hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
        >
          {title}
        </a>
        <a
          href={browser ? raceHref(race.id) : undefined}
          class="btn-secondary hidden min-h-11 shrink-0 self-start whitespace-nowrap px-3 text-xs xl:inline-flex"
        >
          View race <UiIcon name="arrow-right" size="sm" />
        </a>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        {#if subtitle}
          <span class="text-xs text-content-subtle">{subtitle}</span>
          <span class="text-content-faint" aria-hidden="true">·</span>
        {/if}
        <span
          class={`inline-flex border rounded-full px-2 py-0.5 text-xs font-semibold leading-none ${ratingClass(
            rating,
          )}`}
        >
          {formatRating(rating)}
        </span>
      </div>
    </div>

    <!-- Card Metrics Dashboard -->
    <dl
      class="grid grid-cols-2 gap-3 rounded-xl border border-stroke bg-surface-alt/40 p-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div class="col-span-2 min-w-0 xl:col-span-1">
        <dt class="text-xs text-content-subtle">Projected</dt>
        <dd class="mt-1 flex min-w-0 items-start gap-1.5">
          <span
            class="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold leading-none {partyBadgeClass(
              party,
            )}"
            title={party}>{partyAbbr(party)}</span
          >
          {#if winnerName}
            <span
              class="min-w-0 text-sm font-semibold leading-tight text-content line-clamp-2"
              title={winnerName}
            >
              {winnerName}
            </span>
          {:else}
            <span
              class="min-w-0 break-words text-sm font-semibold leading-tight text-content"
              >{party}</span
            >
          {/if}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-content-subtle">Win probability</dt>
        <dd class="mt-0.5 text-lg font-bold tabular-nums text-content">
          {probability(race.forecast.win_probability)}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-content-subtle">Est. margin</dt>
        <dd class="mt-0.5 text-lg font-bold tabular-nums text-content">
          {race.forecast.margin_estimate === undefined ||
          race.forecast.margin_estimate === null
            ? "n/a"
            : `${
                race.forecast.margin_estimate > 0 ? "+" : ""
              }${race.forecast.margin_estimate.toFixed(1)}%`}
        </dd>
      </div>
    </dl>

    <!-- D vs R Split details -->
    {#if race.forecast.party_probabilities}
      <div class="flex justify-between px-1 text-xs font-semibold tabular-nums">
        <span class="text-blue-700 dark:text-blue-300"
          >Democratic {probability(
            race.forecast.party_probabilities.Democratic,
          )}</span
        >
        <span class="text-red-700 dark:text-red-300"
          >Republican {probability(
            race.forecast.party_probabilities.Republican,
          )}</span
        >
      </div>
    {/if}

    <!-- Takeaway Text -->
    <div class="flex flex-col justify-center border-t border-stroke pt-2.5">
      <span class="mb-1 text-xs font-semibold text-content-subtle"
        >Key takeaway</span
      >
      <p class="text-sm leading-6 text-content-muted">
        {race.forecast.takeaway ||
          (race.forecast.rationale
            ? race.forecast.rationale.split(/[.!?]/)[0] + "."
            : "No summary narrative available.")}
      </p>
    </div>
  </div>

  <!-- Card Accordion Toggle -->
  <div>
    <div class="flex items-center justify-between border-t border-stroke pt-3">
      <button
        type="button"
        on:click={onToggleExpand}
        class="flex min-h-11 items-center gap-1.5 rounded text-xs font-bold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface dark:text-primary-300 dark:hover:text-primary-200"
        aria-expanded={isExpanded}
      >
        <span
          class="inline-flex transition-transform duration-200"
          style={isExpanded ? "transform: rotate(180deg);" : ""}
        >
          <UiIcon name="chevron-down" size="sm" />
        </span>
        {isExpanded ? "Hide analysis" : "Show analysis"}
      </button>

      <span class="text-xs text-content-subtle font-medium">
        {race.forecast.based_on_poll_count} poll{race.forecast
          .based_on_poll_count === 1
          ? ""
          : "s"} analyzed
      </span>
    </div>

    <!-- Expandable Drawer Content -->
    {#if isExpanded}
      <div
        class="mt-3 pt-3 border-t border-stroke flex flex-col gap-3 text-xs bg-surface-alt/10 rounded-xl p-4 shadow-inner"
      >
        <!-- Full Rationale -->
        <div>
          <span
            class="font-bold text-content uppercase tracking-wider text-xs block mb-1"
            >Full assessment</span
          >
          <p
            class="text-content-muted leading-relaxed font-medium whitespace-pre-wrap"
          >
            {race.forecast.rationale}
          </p>
        </div>

        <!-- Key Drivers -->
        {#if race.forecast.key_reasons && race.forecast.key_reasons.length > 0}
          <div class="pt-2 border-t border-stroke">
            <span
              class="font-bold text-content uppercase tracking-wider text-xs block mb-1"
              >Key drivers</span
            >
            <ul
              class="list-disc list-inside space-y-1 text-content-muted font-medium pl-1"
            >
              {#each race.forecast.key_reasons as reason}
                <li>{reason}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Uncertainty -->
        {#if race.forecast.uncertainty}
          <div class="pt-2 border-t border-stroke">
            <span
              class="font-bold text-content uppercase tracking-wider text-xs block mb-1"
              >Uncertainty</span
            >
            <p class="text-content-muted font-medium leading-relaxed">
              {race.forecast.uncertainty}
            </p>
          </div>
        {/if}

        {#if race.forecast.market_signals && race.forecast.market_signals.length > 0}
          <div class="pt-2 border-t border-stroke">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span
                class="font-bold text-content uppercase tracking-wider text-xs block"
                >Kalshi market signals</span
              >
              <span class="text-xs text-content-subtle font-bold"
                >{race.forecast.market_signals.length} market{race.forecast
                  .market_signals.length === 1
                  ? ""
                  : "s"}</span
              >
            </div>
            <div class="grid gap-2">
              {#each race.forecast.market_signals as signal}
                <div
                  class="rounded-lg border border-stroke/60 bg-surface px-3 py-2"
                >
                  <div
                    class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div>
                      <span class="block text-xs font-bold text-content"
                        >{marketSignalTarget(signal)}</span
                      >
                      <span
                        class="block text-xs text-content-subtle leading-snug"
                        >{signal.title}</span
                      >
                    </div>
                    <div
                      class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-subtle sm:justify-end"
                    >
                      <span class="font-bold text-content"
                        >{probabilityOneDecimal(
                          signal.implied_probability,
                        )}</span
                      >
                      {#if marketSpread(signal)}
                        <span>{marketSpread(signal)}</span>
                      {/if}
                      <span class="capitalize"
                        >{signal.confidence} confidence</span
                      >
                      {#if marketAsOf(signal.as_of)}
                        <span>As of {marketAsOf(signal.as_of)}</span>
                      {/if}
                      {#if isExternalUrl(signal.url)}
                        <a
                          href={signal.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="font-bold text-primary-700 hover:underline dark:text-primary-300"
                          >Kalshi</a
                        >
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Per-claim Evidence Attribution -->
        <ForecastEvidenceLineage entries={race.forecast.evidence_lineage} />

        <!-- Source Links -->
        {#if race.forecast.source_urls && race.forecast.source_urls.length > 0}
          <div class="pt-2 border-t border-stroke">
            <span
              class="font-bold text-content uppercase tracking-wider text-xs block mb-1"
              >Forecast sources</span
            >
            <div class="flex flex-wrap gap-1.5">
              {#each race.forecast.source_urls as url}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-xs text-primary-700 dark:text-primary-300 hover:underline bg-surface border border-stroke px-2 py-0.5 rounded-md truncate max-w-[180px]"
                >
                  {getHostname(url)}
                  <UiIcon name="external" size="sm" />
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Metadata -->
        <div
          class="pt-2 border-t border-stroke flex flex-wrap items-center justify-between gap-2 text-xs text-content-subtle font-bold"
        >
          {#if race.forecast.panel && race.forecast.panel.length > 1}
            <span
              >Consensus of {race.forecast.panel.length} models{#if race.forecast.panel_spread !== undefined && race.forecast.panel_spread !== null}
                · {Math.round(race.forecast.panel_spread * 100)}-pt spread{/if}</span
            >
          {:else if race.forecast.model}
            <span>Model {race.forecast.model}</span>
          {/if}
          {#if race.forecast.generated_at}
            <span
              >Generated {new Date(
                race.forecast.generated_at,
              ).toLocaleDateString()}</span
            >
          {/if}
        </div>
      </div>
    {/if}
  </div>
</article>
