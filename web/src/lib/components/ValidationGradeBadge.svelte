<script lang="ts">
  import type { AgentReview, ValidationGrade } from "$lib/types";
  import { tick } from "svelte";
  import { scrollBehavior } from "$lib/utils/motion";
  import { reviewStatus } from "$lib/utils/reviews";

  export let grade: ValidationGrade;
  /** The race's reviews: stale ones (an earlier roster) never count as validation. */
  export let reviews: AgentReview[] = [];

  $: status = reviewStatus(grade, reviews);

  let showPopover = false;
  let wrapper: HTMLDivElement | undefined;
  let badge: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;
  /** Open toward the right of the badge when right-aligning would run off-screen. */
  let alignLeft = false;

  /** Popover width in px (w-72), capped like its max-width. */
  const POPOVER_WIDTH = 288;
  const EDGE_GAP = 8;

  function placePopover() {
    if (!wrapper || typeof window === "undefined") return;
    const rect = wrapper.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 32);
    // Right-aligned to the badge unless that would cross the left edge.
    alignLeft = rect.right - width < EDGE_GAP;
  }

  async function togglePopover() {
    if (showPopover) {
      showPopover = false;
      return;
    }
    placePopover();
    showPopover = true;
    // Move focus into the dialog so Escape and Tab work from inside it.
    await tick();
    popover?.focus();
  }

  function closePopover(returnFocus = false) {
    showPopover = false;
    if (returnFocus) badge?.focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !showPopover) return;
    event.stopPropagation();
    closePopover(true);
  }

  function gradeColor(g: string): string {
    switch (g) {
      case "A":
        return "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-300 dark:border-green-700";
      case "B":
        return "bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border-teal-300 dark:border-teal-700";
      case "C":
        return "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700";
      case "D":
        return "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-700";
      case "F":
        return "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700";
      default:
        return "bg-surface-alt text-content border-stroke";
    }
  }

  function scrollToReview() {
    closePopover();
    const el = document.getElementById("ai-review");
    if (el) el.scrollIntoView({ behavior: scrollBehavior() });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="grade-wrapper" bind:this={wrapper} on:keydown={onKeydown}>
  <button
    type="button"
    bind:this={badge}
    class="grade-badge {gradeColor(grade.grade)}"
    on:click={togglePopover}
    aria-label="Automated research score: {grade.grade}{status.allStale
      ? ' (reviewed before the latest roster update)'
      : ''}"
    aria-expanded={showPopover}
    aria-controls={showPopover ? "validation-grade-popover" : undefined}
  >
    <svg
      class="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
    <span class="grade-letter">{grade.grade}</span>
    <span class="grade-label"
      >{status.allStale ? "Review outdated" : "Research score"}</span
    >
  </button>

  {#if showPopover}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="popover-backdrop" on:click={() => closePopover(true)}></div>
    <div
      class="popover"
      class:popover--left={alignLeft}
      bind:this={popover}
      tabindex="-1"
      id="validation-grade-popover"
      role="dialog"
      aria-label="Automated research score details"
    >
      <div class="popover-header">
        <span class="popover-title">Automated research score</span>
        <span class="popover-grade {gradeColor(grade.grade)}"
          >{grade.grade}</span
        >
      </div>
      <p class="popover-score">Score: {grade.score}/100</p>
      <p class="popover-summary">{status.summary}</p>
      {#if status.currencyNote}
        <p class="popover-currency">{status.currencyNote}</p>
      {/if}
      <p class="popover-explain">
        Separate AI models review source quality, completeness, consistency, and
        neutrality. The score summarizes those research checks; it is not a
        guarantee that every claim is correct.
      </p>
      <button type="button" class="popover-link" on:click={scrollToReview}>
        View review details
        <svg
          class="w-3.5 h-3.5"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        </svg>
      </button>
    </div>
  {/if}
</div>

<style lang="postcss">
  @reference "../../app.css";

  .grade-wrapper {
    @apply relative inline-flex;
  }

  .grade-badge {
    @apply inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-full border
           text-sm font-semibold cursor-pointer transition-all duration-150
           hover:shadow-md active:scale-95;
  }

  .grade-letter {
    @apply text-base font-bold leading-none;
  }

  /* Full-opacity text: the old 75% opacity dropped green-800 on green-100
     below 4.5:1. */
  .grade-label {
    @apply text-xs font-medium;
  }

  .popover-backdrop {
    @apply fixed inset-0 z-40;
  }

  /* Right-aligned to the badge by default; placePopover() flips it to open
     rightward when the badge sits too close to the left edge. */
  .popover {
    @apply absolute top-full right-0 mt-2 z-50 w-72 max-w-[calc(100vw-2rem)]
           bg-surface border border-stroke rounded-xl shadow-lg p-4 focus:outline-hidden;
  }

  .popover--left {
    @apply left-0 right-auto;
  }

  .popover-header {
    @apply flex items-center justify-between mb-2;
  }

  .popover-title {
    @apply text-sm font-semibold text-content;
  }

  .popover-grade {
    @apply px-2 py-0.5 rounded-sm text-sm font-bold border;
  }

  .popover-score {
    @apply text-sm font-medium text-content-muted mb-1;
  }

  .popover-summary {
    @apply text-sm text-content-muted mb-3;
  }

  .popover-currency {
    @apply -mt-2 mb-3 text-xs font-medium text-content-subtle;
  }

  .popover-explain {
    @apply text-xs text-content-subtle mb-3 leading-relaxed;
  }

  .popover-link {
    @apply inline-flex min-h-10 items-center gap-1 text-sm font-medium
           text-primary hover:underline
           cursor-pointer transition-colors duration-150;
  }
</style>
