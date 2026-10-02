<script lang="ts">
  /**
   * One not-found / error / empty-state block for the whole site, so the
   * 404 page and the race, candidate, and compare not-found states match.
   */
  export let title: string;
  export let body = "";
  /** Heading level: pages that have no other h1 should keep the default. */
  export let level: 1 | 2 = 1;
  export let primaryHref = "/elections/";
  export let primaryLabel = "Browse elections";
  export let secondaryHref: string | null = "/";
  export let secondaryLabel = "Go to home page";
</script>

<section class="card mx-auto max-w-xl px-6 py-10 text-center sm:px-10">
  <svelte:element this={`h${level}`} class="h-section">{title}</svelte:element>
  {#if body}
    <p class="mx-auto mt-3 max-w-prose text-base leading-7 text-content-muted">
      {body}
    </p>
  {/if}
  <slot />
  <div class="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
    <a href={primaryHref} class="btn-primary">{primaryLabel}</a>
    {#if secondaryHref}
      <a href={secondaryHref} class="btn-secondary">{secondaryLabel}</a>
    {/if}
  </div>
</section>
