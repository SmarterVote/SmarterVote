<script lang="ts">
  export let title: string;
  export let description: string;
  export let path: string;
  export let eyebrow = "Smarter.Vote";
  /** Transactional pages (e.g. checkout results) should stay out of search. */
  export let noindex = false;

  const ogImage = "https://smarter.vote/og-image.png";
  $: url = `https://smarter.vote${path}`;
  $: fullTitle = `${title} | Smarter.Vote`;
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

<div class="mx-auto max-w-4xl px-4 py-10 sm:py-16 min-h-[calc(100vh-16rem)]">
  <header class="mb-10 max-w-3xl">
    <p class="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">
      {eyebrow}
    </p>
    <h1 class="text-3xl font-bold tracking-tight text-content sm:text-4xl">
      {title}
    </h1>
    <p class="mt-4 text-lg leading-8 text-content-muted">{description}</p>
  </header>
  <div class="space-y-6 text-content-muted">
    <slot />
  </div>
</div>
