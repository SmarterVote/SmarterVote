<script lang="ts">
  export let active = false;
  export let onClick: () => void;
  export let disabled = false;
</script>

<button
  class="tab-button"
  class:active
  class:disabled
  on:click={onClick}
  {disabled}
>
  <slot />
</button>

<style lang="postcss">
  .tab-button {
    @apply min-h-11 px-3 py-2 text-sm font-medium border-b-2 border-transparent text-content-subtle;
    @apply hover:text-content-muted hover:border-stroke transition-colors duration-200;
    @apply rounded-t-md;
  }

  /* Inset so the ring isn't clipped by scrolling tab strips. */
  .tab-button:focus-visible {
    @apply outline-none ring-2 ring-inset ring-primary;
  }

  .tab-button.active {
    @apply text-primary border-primary;
  }

  .tab-button:disabled,
  .tab-button.disabled {
    @apply text-content-faint cursor-not-allowed;
  }

  .tab-button:disabled:hover,
  .tab-button.disabled:hover {
    @apply text-content-faint border-transparent;
  }
</style>
