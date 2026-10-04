<script lang="ts">
  import ElectionLookup from "$lib/components/home/ElectionLookup.svelte";
  import type { PageData } from "./$types";
  export let data: PageData;
  let exploring = false;
</script>

<svelte:head>
  <title>Find My Elections | Smarter.Vote</title>
  <meta
    name="description"
    content="Use your address to find the national election guides that apply to you. Smarter.Vote does not store your address."
  />
  <link rel="canonical" href="https://smarter.vote/my-ballot/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Smarter.Vote" />
  <meta property="og:url" content="https://smarter.vote/my-ballot/" />
  <meta property="og:title" content="Find My Elections | Smarter.Vote" />
  <meta
    property="og:description"
    content="Use your address to find the national election guides that apply to you. Smarter.Vote does not store your address."
  />
  <meta property="og:image" content="https://smarter.vote/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="https://smarter.vote/my-ballot/" />
  <meta name="twitter:title" content="Find My Elections | Smarter.Vote" />
  <meta
    name="twitter:description"
    content="Use your address to find the national election guides that apply to you. Smarter.Vote does not store your address."
  />
  <meta name="twitter:image" content="https://smarter.vote/og-image.png" />
</svelte:head>

<div class="relative isolate overflow-hidden bg-page">
  <div
    class="pointer-events-none absolute inset-0 -z-10 opacity-70 dark:opacity-30"
    aria-hidden="true"
  >
    <div
      class="absolute -left-40 top-8 h-96 w-96 rounded-full bg-primary-100 blur-3xl dark:bg-primary-950"
    ></div>
    <div
      class="absolute -right-32 bottom-0 h-80 w-80 rounded-full bg-primary-50 blur-3xl dark:bg-primary-950"
    ></div>
    <svg
      aria-hidden="true"
      class="absolute inset-0 h-full w-full text-primary-900/[0.035] dark:text-primary-100/[0.035]"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
    >
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        d="M-80 590C120 480 205 655 380 526S650 345 822 428s282-34 460-182M-60 312C142 218 282 376 446 248S715 84 902 170s255 8 390-73"
      />
    </svg>
  </div>

  <div
    class="page-container grid items-start gap-5 py-5 sm:gap-8 sm:py-12 {exploring
      ? ''
      : 'lg:grid-cols-[0.8fr_1.2fr] lg:py-16'}"
  >
    {#if !exploring}
      <header class="max-w-xl">
        <p class="eyebrow lg:mt-6">Your election guide</p>
        <h1 class="h-page mt-2 sm:mt-4 lg:text-5xl">
          Find the races that apply to you.
        </h1>
        <!-- Phones skip this paragraph: the search card below says the same,
             and dropping it keeps the address field above the fold. -->
        <p
          class="mt-6 hidden max-w-lg text-lg leading-8 text-content-muted sm:block"
        >
          We use your address only to identify your congressional district, then
          match it with our published House, Senate, and governor research.
        </p>
        <div
          class="mt-10 hidden border-l-2 border-primary-200 pl-5 sm:block dark:border-primary-800"
        >
          <p class="font-semibold text-content">Private by design</p>
          <p class="mt-1 text-sm leading-6 text-content-muted">
            Optional suggestions come directly from Google, and your completed
            address goes directly to the U.S. Census Geocoder. Smarter.Vote does
            not receive, save, or add it to the page URL.
          </p>
        </div>
      </header>
    {/if}
    <ElectionLookup
      races={data.races ?? []}
      loadError={data.loadError}
      on:exploring={(event) => (exploring = event.detail)}
    />
  </div>
</div>
