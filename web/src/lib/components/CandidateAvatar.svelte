<script lang="ts">
  /**
   * The one candidate headshot used on race, candidate and compare pages:
   * a thumbnail-sized photo (via avatarSrc) that falls back to the same
   * initials disc everywhere when there is no photo or it fails to load.
   */
  import { avatarSrc } from "$lib/utils/avatar";
  import { candidateInitials } from "$lib/utils/candidates";
  import { headshotFallback } from "$lib/utils/racePageImage";

  export let name: string;
  export let imageUrl: string | null | undefined = undefined;
  /** Rendered size in px (the CSS can still resize it responsively via `class`). */
  export let size = 40;
  export let shape: "circle" | "rounded" = "circle";
  /** Accessible name; empty when the candidate's name is already next to it. */
  export let alt = "";
  export let loading: "lazy" | "eager" = "lazy";
  let className = "";
  export { className as class };

  let failed = false;
  let seen = imageUrl;
  // A different headshot gets a fresh chance to load.
  $: if (imageUrl !== seen) {
    seen = imageUrl;
    failed = false;
  }
  $: src = avatarSrc(imageUrl);
  $: initials = candidateInitials(name);
</script>

{#if src && !failed}
  <img
    {src}
    {alt}
    width={size}
    height={size}
    {loading}
    decoding="async"
    referrerpolicy="no-referrer"
    class="candidate-avatar candidate-avatar--{shape} {className}"
    style="--avatar-size: {size}px"
    use:headshotFallback={() => (failed = true)}
  />
{:else if alt}
  <span
    class="candidate-avatar candidate-avatar--{shape} candidate-avatar--initials {className}"
    style="--avatar-size: {size}px"
    role="img"
    aria-label={alt}><span aria-hidden="true">{initials}</span></span
  >
{:else}
  <span
    class="candidate-avatar candidate-avatar--{shape} candidate-avatar--initials {className}"
    style="--avatar-size: {size}px"
    aria-hidden="true">{initials}</span
  >
{/if}

<style lang="postcss">
  .candidate-avatar {
    @apply shrink-0 border border-stroke object-cover;
    /* A parent may resize responsively by setting --avatar-display-size. */
    width: var(--avatar-display-size, var(--avatar-size));
    height: var(--avatar-display-size, var(--avatar-size));
  }

  .candidate-avatar--circle {
    @apply rounded-full;
  }

  .candidate-avatar--rounded {
    @apply rounded-xl;
  }

  .candidate-avatar--initials {
    @apply inline-flex select-none items-center justify-center bg-surface-alt font-bold leading-none text-content-muted;
    font-size: max(
      0.625rem,
      calc(var(--avatar-display-size, var(--avatar-size)) * 0.36)
    );
  }
</style>
