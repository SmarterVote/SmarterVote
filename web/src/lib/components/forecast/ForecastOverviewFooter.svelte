<script lang="ts">
  export let narrative: string;
  export let updatedAt: string | undefined;
</script>

<div class="lg:col-span-12 space-y-4 pt-2">
  <div class="rounded-xl border border-stroke bg-surface-alt/30 p-4 sm:p-5">
    <div class="eyebrow mb-2.5 flex items-center gap-1.5">
      <svg
        aria-hidden="true"
        class="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
        />
      </svg>
      Forecast Overview
    </div>
    <p
      class="max-w-prose text-sm font-normal leading-6 text-content-muted sm:text-base sm:leading-7"
    >
      {narrative ||
        "Projections indicate a highly competitive cycle for this chamber."}
    </p>
  </div>

  <!-- Clean Updated Footer -->
  <div
    class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-subtle px-1"
  >
    <span>AI-generated model projection</span>
    {#if updatedAt}
      <span aria-hidden="true">·</span>
      <span
        >Last updated <span class="font-semibold text-content-muted"
          >{new Date(updatedAt).toLocaleDateString()}</span
        ></span
      >
    {/if}
  </div>
</div>
