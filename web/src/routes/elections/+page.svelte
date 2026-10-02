<script lang="ts">
  import ElectionDirectory from "$lib/components/ElectionDirectory.svelte";
  import type { PageData } from "./$types";

  export let data: PageData;
</script>

<svelte:head>
  <title>Election Guides | Smarter.Vote</title>
  <meta
    name="description"
    content="Browse sourced, nonpartisan candidate research for U.S. House, Senate, and governor elections."
  />
  <link rel="canonical" href="https://smarter.vote/elections/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Smarter.Vote" />
  <meta property="og:url" content="https://smarter.vote/elections/" />
  <meta property="og:title" content="Election Guides | Smarter.Vote" />
  <meta
    property="og:description"
    content="Browse sourced, nonpartisan candidate research for U.S. House, Senate, and governor elections."
  />
  <meta property="og:image" content="https://smarter.vote/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="https://smarter.vote/elections/" />
  <meta name="twitter:title" content="Election Guides | Smarter.Vote" />
  <meta
    name="twitter:description"
    content="Browse sourced, nonpartisan candidate research for U.S. House, Senate, and governor elections."
  />
  <meta name="twitter:image" content="https://smarter.vote/og-image.png" />
</svelte:head>

<ElectionDirectory races={data.races ?? []} loadError={data.loadError} />
