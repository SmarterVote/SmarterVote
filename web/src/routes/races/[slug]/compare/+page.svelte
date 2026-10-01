<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import CandidateComparison from "$lib/components/compare/CandidateComparison.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import { getDraftRace, getRace } from "$lib/api";
  import type { Race } from "$lib/types";
  import { neutralCandidateOrder } from "$lib/utils/candidates";
  import { candidateSlug, matchesCandidateSlug } from "$lib/utils/format";
  import { onMount } from "svelte";
  import { raceDisplayTitle } from "$lib/utils/raceTitle";
  import {
    isNotFoundError,
    selectComparedCandidates,
  } from "$lib/utils/racePage";

  export let data: { prerenderedRace?: Race | null };

  let race: Race | null = data.prerenderedRace ?? null;
  let loading = !race;
  let error: string | null = null;
  let notFound = false;
  let isDraftPreview = false;

  $: slug = $page.params.slug as string;

  let mounted = false;
  let loadedKey: string | null = null;
  let requestId = 0;

  // `?candidates=` is read only in the browser: prerendering has no query
  // string, so the static page shows every active candidate.
  $: candidatesParam =
    mounted && browser ? $page.url.searchParams.get("candidates") : null;
  $: candidates = selectComparedCandidates(race, candidatesParam);
  $: draftParam =
    mounted && browser && $page.url.searchParams.get("draft") === "true";
  $: if (mounted && `${slug}|${draftParam}` !== loadedKey)
    loadRace(slug, draftParam);

  $: description = `Compare candidates side-by-side on key election issues for ${
    race ? raceDisplayTitle(race) : "this election"
  }.`;
  $: pageTitle = `Compare Candidates | ${
    race ? raceDisplayTitle(race) : "Smarter.Vote"
  }`;
  $: draftQuery = isDraftPreview ? "?draft=true" : "";

  onMount(() => {
    mounted = true;
  });

  // Same policy as the race page: show prerendered data immediately, always
  // refetch the fresh copy after mount, and keep the prerendered copy if that
  // refetch fails.
  async function loadRace(target: string, draft: boolean) {
    const previousSlug = loadedKey?.split("|")[0];
    loadedKey = `${target}|${draft}`;
    const id = ++requestId;
    const prerendered =
      data.prerenderedRace && data.prerenderedRace.id === target
        ? data.prerenderedRace
        : null;
    if (previousSlug !== target) race = prerendered;
    isDraftPreview = draft;
    error = null;
    notFound = false;
    loading = !race;

    try {
      let next: Race;
      if (draft) {
        try {
          next = await getDraftRace(target);
        } catch {
          next = await getRace(target, fetch, false);
          if (id !== requestId) return;
          isDraftPreview = false;
          loadedKey = `${target}|false`;
          const params = new URLSearchParams($page.url.searchParams);
          params.delete("draft");
          const query = params.toString();
          await goto(`/races/${target}/compare/${query ? `?${query}` : ""}`, {
            replaceState: true,
            keepFocus: true,
            noScroll: true,
          }).catch(() => undefined);
        }
      } else {
        next = await getRace(target);
      }
      if (id !== requestId) return;
      race = next;
    } catch (caught) {
      if (id !== requestId) return;
      if (race && race.id === target) {
        if (draft) isDraftPreview = false;
        return;
      }
      try {
        const fallback = await getRace(target, fetch, true);
        if (id !== requestId) return;
        race = fallback;
      } catch {
        if (id !== requestId) return;
        race = null;
        if (isNotFoundError(caught)) notFound = true;
        else
          error =
            caught instanceof Error
              ? caught.message
              : "Failed to load race data";
      }
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function toggleSelection(candidateName: string) {
    if (!race) return;
    const selectedSlug = candidateSlug(candidateName);
    const params = new URLSearchParams($page.url.searchParams);
    const active = neutralCandidateOrder(
      race.candidates.filter((candidate) => !candidate.withdrawn),
    );
    // Normalise whatever is in the URL (including legacy slugs) to the
    // canonical slugs of the currently compared candidates.
    let current = candidates.map((candidate) => candidateSlug(candidate.name));
    if (current.length === 0)
      current = active.map((candidate) => candidateSlug(candidate.name));
    if (current.includes(selectedSlug)) {
      if (current.length > 1)
        current = current.filter((value) => value !== selectedSlug);
    } else current.push(selectedSlug);
    const ordered = active
      .filter((candidate) =>
        current.some((value) => matchesCandidateSlug(candidate.name, value)),
      )
      .map((candidate) => candidateSlug(candidate.name));
    params.set("candidates", ordered.join(","));
    goto(`/races/${slug}/compare/?${params.toString()}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }
</script>

<svelte:head>
  {#if notFound}
    <title>Race not found | Smarter.Vote</title>
    <meta name="robots" content="noindex" />
  {:else}
    <title>{pageTitle}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href="https://smarter.vote/races/{slug}/compare/" />
    <meta property="og:type" content="article" />
    <meta
      property="og:url"
      content="https://smarter.vote/races/{slug}/compare/"
    />
    <meta property="og:title" content={pageTitle} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content="https://smarter.vote/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta
      name="twitter:url"
      content="https://smarter.vote/races/{slug}/compare/"
    />
    <meta name="twitter:title" content={pageTitle} />
    <meta name="twitter:description" content={description} />
    <meta name="twitter:image" content="https://smarter.vote/og-image.png" />
    {#if isDraftPreview}
      <meta name="robots" content="noindex" />
    {/if}
  {/if}
</svelte:head>

<div class="container mx-auto max-w-7xl px-4 py-6 sm:py-8">
  <header class="compare-header">
    <a href="/races/{slug}/{draftQuery}" class="compare-back-link">
      <UiIcon name="arrow-left" size="sm" /> Race overview
    </a>
    <div class="mt-3">
      <p class="compare-eyebrow">Candidate comparison</p>
      <h1
        class="text-2xl font-extrabold tracking-tight text-content sm:text-3xl"
      >
        Compare Candidates
      </h1>
      {#if race}<p class="mt-1 text-sm leading-6 text-content-muted">
          {raceDisplayTitle(race)}
        </p>{/if}
    </div>
  </header>

  {#if loading}
    <div class="space-y-6">
      <div
        class="h-16 animate-pulse rounded-xl border border-stroke bg-surface"
      ></div>
      <div
        class="h-96 animate-pulse rounded-xl border border-stroke bg-surface"
      ></div>
    </div>
  {:else if notFound}
    <div
      class="rounded-2xl border border-stroke bg-surface p-6 text-center shadow-sm sm:p-10"
    >
      <h2 class="text-xl font-bold text-content sm:text-2xl">Race not found</h2>
      <p class="mt-2 text-sm text-content-muted">
        We couldn't find a published race at this address. It may have been
        renamed, retired after the election, or never published.
      </p>
      <a
        href="/elections/"
        class="btn-primary mt-4 inline-flex text-sm font-semibold no-underline"
        >Browse elections</a
      >
    </div>
  {:else if error}
    <div
      class="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30"
      role="alert"
    >
      <h2 class="mb-2 text-xl font-bold text-red-800 dark:text-red-200">
        We couldn't load this comparison
      </h2>
      <p class="text-red-700 dark:text-red-200">
        Something went wrong while loading the race data. Please check your
        connection and try again.
      </p>
      <a
        href="/races/{slug}/{draftQuery}"
        class="mt-4 inline-block font-semibold text-blue-700 underline dark:text-blue-400"
        >Return to Race Overview</a
      >
    </div>
  {:else if race && candidates.length === 0}
    <div
      class="rounded-xl border border-stroke bg-surface p-8 text-center text-content-subtle"
    >
      <p class="text-lg font-semibold text-content">No Candidates Selected</p>
      <p class="mt-2 text-sm">
        Please select candidates from the race detail page to compare them.
      </p>
      <a
        href="/races/{slug}/{draftQuery}"
        class="btn-primary mt-4 inline-flex text-sm font-semibold no-underline"
        >Go Select Candidates</a
      >
    </div>
  {:else if race}
    <CandidateComparison
      {race}
      {candidates}
      {isDraftPreview}
      onToggle={toggleSelection}
    />
  {/if}
</div>

<style lang="postcss">
  /* Scoped `dark:` variants inside <style> never match: Svelte scopes the
     `.dark` ancestor to this component. Dark overrides use :global(.dark). */
  .compare-header {
    @apply mb-5 rounded-2xl border border-stroke bg-surface p-4 shadow-sm sm:mb-6 sm:p-6;
  }

  .compare-back-link {
    @apply inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-blue-700 no-underline transition-colors hover:bg-blue-50 hover:text-blue-900 sm:px-3;
  }

  :global(.dark) .compare-back-link {
    @apply text-blue-400 hover:bg-blue-950/30 hover:text-blue-300;
  }

  .compare-eyebrow {
    @apply mb-1 text-xs font-extrabold uppercase tracking-wider text-blue-600;
  }

  :global(.dark) .compare-eyebrow {
    @apply text-blue-400;
  }
</style>
