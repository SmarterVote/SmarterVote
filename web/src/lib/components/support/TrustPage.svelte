<script lang="ts">
  export let title: string;
  export let description: string;
  export let path: string;
  /** Short section label above the title; omitted when not provided. */
  export let eyebrow = "";
  /** ISO date (YYYY-MM-DD) the page's content last changed, shown as "Last updated". */
  export let updated = "";
  /** Transactional pages (e.g. checkout results) should stay out of search. */
  export let noindex = false;

  const ogImage = "https://smarter.vote/og-image.png";
  $: url = `https://smarter.vote${path}`;
  $: fullTitle = `${title} | Smarter.Vote`;
  // Parse as a calendar date in UTC so the label never shifts a day by timezone.
  $: updatedLabel = updated
    ? new Date(`${updated}T00:00:00Z`).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
</script>

<svelte:head>
  <title>{fullTitle}</title>
  <meta name="description" content={description} />
  {#if noindex}
    <meta name="robots" content="noindex" />
  {:else}
    <link rel="canonical" href={url} />
  {/if}
  <meta property="og:site_name" content="Smarter.Vote" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={url} />
  <meta property="og:title" content={fullTitle} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={ogImage} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={fullTitle} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={ogImage} />
</svelte:head>

<div class="page-narrow min-h-[calc(100vh-16rem)] py-10 sm:py-16">
  <header class="mb-8 sm:mb-10">
    {#if eyebrow}
      <p class="eyebrow mb-3">{eyebrow}</p>
    {/if}
    <h1 class="h-page">{title}</h1>
    <p class="mt-4 max-w-prose text-lg leading-8 text-content-muted">
      {description}
    </p>
    {#if updatedLabel}
      <p class="mt-3 text-sm text-content-subtle">
        Last updated <time datetime={updated}>{updatedLabel}</time>
      </p>
    {/if}
    <slot name="header" />
  </header>
  <div class="space-y-6 text-content-muted">
    <slot />
  </div>
</div>
