<script lang="ts">
  import NoDataFallback from "./NoDataFallback.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import type { Source } from "$lib/types";
  import { isExternalUrl } from "$lib/utils/url";

  export let donorSummary: string = "";
  export let donorSourceUrl: string = "";
  export let donorSources: Source[] = [];
  export let raceId: string = "";
  export let candidateName: string = "";

  type SourceLink = { url: string; title: string };

  function titleForUrl(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function stripInlineSources(summary: string): string {
    const markerIndex = summary.search(/\bSources:\s*https?:\/\//i);
    return (markerIndex >= 0 ? summary.slice(0, markerIndex) : summary).trim();
  }

  function extractInlineSourceUrls(summary: string): string[] {
    return (summary.match(/https?:\/\/[^\s;,]+/g) ?? []).map((url) =>
      url.replace(/[.)\]]+$/, ""),
    );
  }

  function mergeSourceLinks(
    sources: Source[],
    sourceUrl: string,
    legacyUrls: string[],
  ): SourceLink[] {
    const links: SourceLink[] = [];
    const seen = new Set<string>();
    const add = (url: string | undefined, title?: string | null) => {
      if (!isExternalUrl(url)) return;
      const safeUrl = url.trim();
      if (seen.has(safeUrl)) return;
      seen.add(safeUrl);
      links.push({ url: safeUrl, title: title || titleForUrl(safeUrl) });
    };

    for (const source of sources) add(source.url, source.title);
    add(sourceUrl, "Full campaign finance data");
    for (const url of legacyUrls) add(url);
    return links;
  }

  $: cleanDonorSummary = stripInlineSources(donorSummary);
  $: financeSources = mergeSourceLinks(
    donorSources,
    donorSourceUrl,
    extractInlineSourceUrls(donorSummary),
  );
</script>

<div class="donors-container">
  {#if !cleanDonorSummary && financeSources.length === 0}
    <NoDataFallback dataType="donors" {raceId} {candidateName} />
  {:else}
    {#if cleanDonorSummary}
      <div class="donor-summary">
        <p class="summary-text">{cleanDonorSummary}</p>
      </div>
    {/if}

    {#if financeSources.length > 0}
      <div class="source-list" aria-label="Campaign finance sources">
        <p class="source-list-title">Sources</p>
        <div class="source-links">
          {#each financeSources as source}
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              class="source-link-btn"
            >
              <span>{source.title}</span>
              <UiIcon name="external" size="sm" />
              <span class="sr-only">(opens in a new tab)</span>
            </a>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style lang="postcss">
  .donors-container {
    @apply space-y-4;
  }

  .donor-summary {
    background-color: rgb(var(--sv-surface-alt));
    border: 1px solid rgb(var(--sv-border));
    @apply rounded-lg p-4;
  }

  .summary-text {
    color: rgb(var(--sv-text));
    @apply text-sm leading-relaxed;
  }

  .source-list {
    @apply space-y-2;
  }

  .source-list-title {
    color: rgb(var(--sv-text-muted));
    @apply text-xs font-semibold uppercase tracking-wide;
  }

  .source-links {
    @apply flex flex-wrap gap-2;
  }

  .source-link-btn {
    @apply inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-100;
  }

  /* Svelte scopes styles, so dark overrides target the global .dark root.
     blue-700 on blue-50 (light) and blue-400 on the tinted gray-900 surface
     (dark) both clear WCAG AA 4.5:1. */
  :global(.dark) .source-link-btn {
    color: rgb(var(--sv-primary));
    background-color: rgb(var(--sv-primary) / 0.1);
    border-color: rgb(var(--sv-primary) / 0.3);
  }

  :global(.dark) .source-link-btn:hover {
    background-color: rgb(var(--sv-primary) / 0.2);
  }
</style>
