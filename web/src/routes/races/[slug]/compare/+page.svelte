<script lang="ts">
  import { browser } from "$app/environment";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import CandidateComparison from "$lib/components/compare/CandidateComparison.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";
  import { getDraftRace, getRace } from "$lib/api";
  import type { CanonicalIssue, Race } from "$lib/types";
  import { CANONICAL_ISSUES } from "$lib/types";
  import { neutralCandidateOrder } from "$lib/utils/candidates";
  import { candidateSlug, matchesCandidateSlug } from "$lib/utils/format";
  import { onMount, tick } from "svelte";
  import {
    compareMetaDescription,
    comparePageTitle,
    raceDisplayTitle,
  } from "$lib/utils/raceTitle";
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
  /** Race whose draft fetch failed: its `?draft=true` is ignored from then on. */
  let draftRejectedSlug: string | null = null;

  // `?candidates=` is read only in the browser: prerendering has no query
  // string, so the static page shows every active candidate.
  $: candidatesParam =
    mounted && browser ? $page.url.searchParams.get("candidates") : null;
  $: candidates = selectComparedCandidates(race, candidatesParam);
  $: draftParam =
    mounted &&
    browser &&
    $page.url.searchParams.get("draft") === "true" &&
    draftRejectedSlug !== slug;
  $: if (mounted && `${slug}|${draftParam}` !== loadedKey)
    loadRace(slug, draftParam);

  $: description = compareMetaDescription(race);
  $: pageTitle = comparePageTitle(race);
  $: draftQuery = isDraftPreview ? "?draft=true" : "";

  // Client-side navigation within the same race (another candidate, say)
  // brings new embedded data; follow it unless a draft is being previewed.
  $: if (
    mounted &&
    !draftParam &&
    data.prerenderedRace &&
    data.prerenderedRace.id === slug &&
    race !== data.prerenderedRace
  )
    race = data.prerenderedRace;

  // The compared issue lives in `?issue=<slug>` so a shared link opens on it.
  let selectedIssue: CanonicalIssue = "Healthcare";
  let syncedIssue: CanonicalIssue | null = null;

  function issueFromParam(value: string | null): CanonicalIssue | null {
    if (!value) return null;
    const wanted = value.trim().toLowerCase();
    return (
      CANONICAL_ISSUES.find(
        (issue) =>
          candidateSlug(issue) === wanted || issue.toLowerCase() === wanted,
      ) ?? null
    );
  }

  /** Current address-bar query (a shallow replaceState leaves `$page.url` behind). */
  function currentParams(): URLSearchParams {
    return new URLSearchParams(
      browser ? window.location.search : $page.url.search,
    );
  }

  $: if (mounted && syncedIssue !== null && selectedIssue !== syncedIssue) {
    syncedIssue = selectedIssue;
    const params = currentParams();
    params.set("issue", candidateSlug(selectedIssue));
    try {
      replaceState(
        `${window.location.pathname}?${params.toString()}${window.location.hash}`,
        $page.state,
      );
    } catch {
      // The router is not ready yet; the next change will sync it.
    }
  }

  onMount(() => {
    const fromUrl = issueFromParam(
      new URLSearchParams(window.location.search).get("issue"),
    );
    if (fromUrl) selectedIssue = fromUrl;
    syncedIssue = selectedIssue;
    mounted = true;
    // The desktop table shows every issue; bring the linked one into view.
    if (fromUrl && window.matchMedia?.("(min-width: 1024px)").matches) {
      tick().then(() =>
        document
          .getElementById(`compare-issue-${candidateSlug(fromUrl)}`)
          ?.scrollIntoView(),
      );
    }
  });

  let copyStatus = "";
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  /** Copy the comparison's address (candidates + issue) for sharing. */
  async function copyLink() {
    const url = window.location.href;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      // Older browsers and non-secure contexts: a hidden textarea + execCommand.
      const field = document.createElement("textarea");
      field.value = url;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      field.remove();
    }
    copyStatus = copied
      ? "Link copied to clipboard"
      : "Couldn't copy the link. Copy it from the address bar instead.";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyStatus = ""), 4000);
  }

  // Same policy as the race page: the build-embedded race renders as is; a
  // draft, or a page built without data, fetches after mount, keeping any
  // embedded copy if that fetch fails.
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
    // The build embedded this race: nothing to refetch (drafts always fetch).
    if (!draft && prerendered) {
      race = prerendered;
      loading = false;
      return;
    }
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
          draftRejectedSlug = target;
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
    const params = currentParams();
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

<div class="page-container py-6 sm:py-8">
  {#if notFound}
    <EmptyState
      title="Race not found"
      body="We couldn't find a published race at this address. It may have been renamed, retired after the election, or never published."
    />
  {:else}
    <header class="compare-header">
      <a href="/races/{slug}/{draftQuery}" class="compare-back-link">
        <UiIcon name="arrow-left" size="sm" /> Race overview
      </a>
      <p class="eyebrow mt-3">Candidate comparison</p>
      <div class="compare-title-row">
        <h1 class="h-page mt-1">Compare Candidates</h1>
        {#if race}
          <button
            type="button"
            class="btn-secondary shrink-0"
            on:click={copyLink}
          >
            {copyStatus === "Link copied to clipboard" ? "Copied" : "Copy link"}
          </button>
        {/if}
      </div>
      {#if race}<p class="mt-2 text-sm text-content-muted sm:text-base">
          {raceDisplayTitle(race)}
        </p>{/if}
      <p class="sr-only" role="status" aria-live="polite">{copyStatus}</p>
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
    {:else if error}
      <div class="alert-error mx-auto max-w-xl p-6 text-center" role="alert">
        <h2 class="text-xl font-semibold">We couldn't load this comparison</h2>
        <p class="mt-2">
          Something went wrong while loading the race data. Please check your
          connection and try again.
        </p>
        <a href="/races/{slug}/{draftQuery}" class="btn-secondary mt-4"
          >Return to Race Overview</a
        >
      </div>
    {:else if race && candidates.length === 0}
      <EmptyState
        level={2}
        title="No candidates to compare"
        body="This race has no active candidates listed yet. Check the race page for the latest field."
        primaryHref="/races/{slug}/{draftQuery}"
        primaryLabel="Back to race overview"
        secondaryHref={null}
      />
    {:else if race}
      <CandidateComparison
        {race}
        {candidates}
        {isDraftPreview}
        bind:selectedIssue
        onToggle={toggleSelection}
      />
    {/if}
  {/if}
</div>

<style lang="postcss">
  @reference "../../../../app.css";

  .compare-header {
    @apply mb-5 sm:mb-6;
  }

  .compare-title-row {
    @apply flex flex-wrap items-center justify-between gap-3;
  }

  .compare-back-link {
    @apply -ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary no-underline transition-colors hover:bg-surface-alt;
  }
</style>
