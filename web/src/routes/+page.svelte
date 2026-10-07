<script lang="ts">
  import HowItWorks from "$lib/components/home/HowItWorks.svelte";
  import InteractiveRaceCompare from "$lib/components/home/InteractiveRaceCompare.svelte";
  import TrustPrinciples from "$lib/components/home/TrustPrinciples.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import { jsonLdScript } from "$lib/utils/racePage";
  import type { PageData } from "./$types";
  export let data: PageData;

  // Site-level structured data belongs on the home page only, not on every
  // page of the site.
  const websiteJsonLd = jsonLdScript({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Smarter.Vote",
    url: "https://smarter.vote/",
    description:
      "Candidate research tool for informed voting decisions, using publicly available sources",
  });
</script>

<svelte:head>
  <title>Smarter.Vote | Know your candidates</title>
  <meta
    name="description"
    content="Explore sourced, nonpartisan research for national elections. Compare candidates, inspect original sources, and understand the federal races on your ballot."
  />
  <link rel="canonical" href="https://smarter.vote/" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://smarter.vote/" />
  <meta property="og:title" content="Smarter.Vote | Know your candidates" />
  <meta
    property="og:description"
    content="Sourced, nonpartisan candidate research with uncertainty and original evidence kept visible."
  />
  <meta property="og:image" content="https://smarter.vote/og-image.png" />
  <meta property="og:site_name" content="Smarter.Vote" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Smarter.Vote | Know your candidates" />
  <meta
    name="twitter:description"
    content="Sourced, nonpartisan candidate research with uncertainty and original evidence kept visible."
  />
  <meta name="twitter:image" content="https://smarter.vote/og-image.png" />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html websiteJsonLd}
</svelte:head>

<!-- -mb cancels the footer's top margin here so the closing band meets the
     footer with no strip of page background between them. -->
<div class="-mb-12 overflow-hidden sm:-mb-16">
  <section
    class="relative border-b border-stroke bg-surface py-10 sm:py-12 lg:py-14"
  >
    <div
      class="absolute inset-0 opacity-60 bg-[linear-gradient(to_right,var(--color-blue-100)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-blue-100)_1px,transparent_1px)] bg-size-[56px_56px] mask-[linear-gradient(to_right,black,transparent_75%)] dark:opacity-10"
      aria-hidden="true"
    ></div>
    <div
      class="page-container relative grid items-start gap-9 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-10 xl:gap-14"
    >
      <div class="lg:sticky lg:top-32 lg:py-7">
        <div class="flex items-center gap-3">
          <span class="h-px w-9 bg-primary-600 dark:bg-primary-400"></span>
          <p class="eyebrow">Know your candidates</p>
        </div>
        <h1
          class="mt-6 max-w-2xl text-5xl font-extrabold leading-[.98] tracking-[-0.045em] text-content sm:text-6xl sm:leading-none lg:text-6xl xl:text-7xl"
        >
          Understand your ballot.
        </h1>
        <p
          class="mt-6 max-w-xl text-lg leading-8 text-content-muted sm:text-xl sm:leading-7"
        >
          Smarter.Vote turns candidate records, issue positions, and original
          sources into clear, nonpartisan election research you can examine for
          yourself.
        </p>
        <div
          class="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
        >
          <a
            href="/my-ballot/"
            class="group rounded-xl bg-primary-700 px-5 py-4 text-white shadow-xs transition hover:-translate-y-0.5 hover:bg-primary-800 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:bg-primary-600 dark:hover:bg-primary-500"
          >
            <span class="flex items-center justify-between font-bold"
              >Explore my ballot <span
                class="inline-flex transition group-hover:translate-x-1"
                ><UiIcon name="arrow-right" /></span
              ></span
            >
            <span class="mt-1 block text-sm text-white"
              >Find the national races tied to your address</span
            >
          </a>
          <a
            href="/elections/"
            class="group rounded-xl border border-stroke bg-surface px-5 py-4 text-content shadow-xs transition hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
          >
            <span class="flex items-center justify-between font-bold"
              >Browse all elections <span
                class="inline-flex text-primary transition group-hover:translate-x-1"
                ><UiIcon name="arrow-right" /></span
              ></span
            >
            <span class="mt-1 block text-sm text-content-muted"
              >Explore every published candidate guide</span
            >
          </a>
        </div>
      </div>
      <div class="min-w-0 pb-4 lg:pt-2">
        <InteractiveRaceCompare races={data.gradeARaces} />
      </div>
    </div>
  </section>

  <TrustPrinciples />
  <HowItWorks />
  <section
    class="relative overflow-hidden border-t border-stroke bg-primary-700 py-20 text-white sm:py-28 dark:bg-primary-950"
  >
    <div
      class="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] bg-size-[30px_30px]"
      aria-hidden="true"
    ></div>
    <div class="page-container relative text-center">
      <p
        class="text-xs font-semibold uppercase tracking-wider text-primary-100"
      >
        Your ballot deserves a closer look
      </p>
      <h2 class="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
        Know what you’re voting on.
      </h2>
      <p class="mx-auto mt-5 max-w-xl text-lg leading-8 text-primary-50">
        Start with your address. Continue with the evidence.
      </p>
      <a
        href="/my-ballot/"
        class="mt-9 inline-flex min-h-12 items-center gap-2 rounded-lg bg-white px-7 py-3 font-semibold text-primary-800 shadow-xs transition hover:bg-primary-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >Find my elections <UiIcon name="arrow-right" /></a
      >
      <p class="mx-auto mt-10 max-w-lg text-sm leading-6 text-primary-100">
        So far, Smarter.Vote has been funded entirely by its founder. Reader
        support is what will let us cover state and local races and keep going
        into 2028.
        <a
          href="/support/"
          class="font-semibold text-white underline underline-offset-2 hover:no-underline"
          >Support the project</a
        >.
      </p>
    </div>
  </section>
</div>
