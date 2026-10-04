<script lang="ts">
  export let active = false;
  export let onClick: () => void;
  export let disabled = false;
  /**
   * Render as an ARIA tab (inside a `role="tablist"` parent): exposes the
   * selected state, takes part in a roving tabindex (only the selected tab is
   * in the Tab order) and points at the panel it controls. Without it the
   * button stays a plain toggle for callers that are not tablists.
   */
  export let tab = false;
  export let id: string | undefined = undefined;
  export let controls: string | undefined = undefined;
  export let onKeydown: ((event: KeyboardEvent) => void) | undefined =
    undefined;
</script>

{#if tab}
  <button
    {id}
    type="button"
    role="tab"
    class="tab-button"
    class:active
    class:disabled
    aria-selected={active}
    aria-controls={controls}
    tabindex={active ? 0 : -1}
    on:click={onClick}
    on:keydown={(event) => onKeydown?.(event)}
    {disabled}
  >
    <slot />
  </button>
{:else}
  <button
    {id}
    type="button"
    class="tab-button"
    class:active
    class:disabled
    on:click={onClick}
    {disabled}
  >
    <slot />
  </button>
{/if}

<style lang="postcss">
  @reference "../../app.css";

  .tab-button {
    @apply min-h-11 px-3 py-2 text-sm font-medium border-b-2 border-transparent text-content-subtle;
    @apply hover:text-content-muted hover:border-stroke transition-colors duration-200;
    @apply rounded-t-md;
  }

  /* Inset so the ring isn't clipped by scrolling tab strips. */
  .tab-button:focus-visible {
    @apply outline-hidden ring-2 ring-inset ring-primary;
  }

  .tab-button.active {
    @apply text-primary border-primary font-semibold;
  }

  .tab-button:disabled,
  .tab-button.disabled {
    @apply text-content-faint cursor-not-allowed;
  }

  .tab-button:disabled:hover,
  .tab-button.disabled:hover {
    @apply text-content-faint border-transparent;
  }

  /* Forced colors drop the color-only selected state, so the selected tab
     gets a system-colored fill and a thick underline, and focus gets a real
     outline (box-shadow rings are removed in this mode). */
  @media (forced-colors: active) {
    .tab-button {
      border-bottom-color: Canvas;
    }
    .tab-button.active {
      forced-color-adjust: none;
      background: Highlight;
      color: HighlightText;
      border-bottom: 4px solid CanvasText;
    }
    .tab-button:focus-visible {
      outline: 2px solid CanvasText;
      outline-offset: -4px;
    }
  }
</style>
