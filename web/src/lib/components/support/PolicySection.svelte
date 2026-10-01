<script lang="ts">
  export let title: string;
  /** Heading level: 2 for top-level sections, 3 when nested under another h2. */
  export let level: 2 | 3 = 2;
  /** Optional anchor id; scroll-margin keeps it clear of the sticky header. */
  export let id: string | undefined = undefined;
</script>

<section {id} class="card scroll-mt-24 p-4 sm:p-6">
  <svelte:element
    this={`h${level}`}
    class={level === 2 ? "h-card mb-3 sm:text-xl" : "h-card mb-3"}
  >
    {title}
  </svelte:element>
  <div class="max-w-prose space-y-3 leading-7">
    <slot />
  </div>
</section>
