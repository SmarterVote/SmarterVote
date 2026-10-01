<script lang="ts">
  import type { AgentReview } from "$lib/types";

  export let reviews: AgentReview[] = [];

  // Current reviews first: a stale review judged a roster the race has since
  // replaced, so it must never read as a current approval.
  $: displayReviews = (reviews || [])
    .filter(
      (r) =>
        r.model !== "automated-link-validator" &&
        r.model !== "automated-profile-quality",
    )
    .sort((a, b) => Number(isStale(a)) - Number(isStale(b)));
  $: staleCount = displayReviews.filter(isStale).length;

  function isStale(review: AgentReview): boolean {
    return review.stale === true;
  }

  let collapsed = true;

  const KNOWN_VERDICTS = new Set(["approved", "needs_revision", "flagged"]);

  /** Semantic verdict style (success / warning / danger), theme-aware. */
  function verdictClass(verdict: string): string {
    return KNOWN_VERDICTS.has(verdict)
      ? `review-verdict--${verdict}`
      : "review-verdict--neutral";
  }

  type Severity = "error" | "warning" | "info";

  function severityLevel(severity: string): Severity {
    return severity === "error" || severity === "warning" ? severity : "info";
  }

  const SEVERITY_LABEL: Record<Severity, string> = {
    error: "Error",
    warning: "Warning",
    info: "Note",
  };
</script>

<div id="ai-review" class="review-panel">
  <button
    type="button"
    class="review-title"
    on:click={() => (collapsed = !collapsed)}
    aria-expanded={!collapsed}
  >
    <svg
      class="w-5 h-5 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
    Automated Review Details
    {#if displayReviews && displayReviews.length > 0}
      <span class="review-count"
        >{displayReviews.length} review{displayReviews.length !== 1
          ? "s"
          : ""}{staleCount > 0 ? ` · ${staleCount} stale` : ""}</span
      >
    {/if}
    <svg
      class="w-4 h-4 ml-auto transition-transform duration-200"
      class:rotate-180={!collapsed}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M19 9l-7 7-7-7"
      />
    </svg>
  </button>

  {#if !collapsed}
    {#if !displayReviews || displayReviews.length === 0}
      <p class="review-empty">
        No automated review has been run for this race yet.
      </p>
    {:else}
      <div class="review-cards">
        {#each displayReviews as review}
          <div class="review-card" class:review-card-stale={isStale(review)}>
            <div class="review-header">
              <span class="review-model">{review.model}</span>
              <div class="review-header-right">
                {#if review.score != null}
                  <span class="review-score">{review.score}/100</span>
                {/if}
                {#if isStale(review)}
                  <span
                    class="review-verdict review-verdict-stale"
                    title="Reviewed an earlier roster; not a current verdict"
                  >
                    Stale · was {review.verdict.replace("_", " ")}
                  </span>
                {:else}
                  <span class="review-verdict {verdictClass(review.verdict)}">
                    {review.verdict.replace("_", " ")}
                  </span>
                {/if}
              </div>
            </div>
            {#if isStale(review)}
              <p class="review-stale-note" role="note">
                This review no longer applies to the current candidate roster{review.stale_reason
                  ? `: ${review.stale_reason}`
                  : "."}
              </p>
            {/if}
            {#if review.summary}
              <p class="review-summary">{review.summary}</p>
            {/if}
            {#if review.flags && review.flags.length > 0}
              <details class="review-flags">
                <summary class="flags-toggle">
                  {review.flags.length} flag{review.flags.length !== 1
                    ? "s"
                    : ""}
                </summary>
                <ul class="flags-list">
                  {#each review.flags as flag}
                    <li class="flag-item">
                      <span
                        class="flag-severity flag-severity--{severityLevel(
                          flag.severity,
                        )}">{SEVERITY_LABEL[severityLevel(flag.severity)]}</span
                      >
                      <div>
                        <span class="flag-field">{flag.field}</span>
                        <span class="flag-concern">{flag.concern}</span>
                        {#if flag.suggestion}
                          <span class="flag-suggestion"
                            ><span class="flag-suggestion-label"
                              >Suggestion:</span
                            >
                            {flag.suggestion}</span
                          >
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ul>
              </details>
            {:else if !isStale(review)}
              <p class="review-all-clear">No issues flagged in this review.</p>
            {/if}
            <span class="review-date">
              Reviewed: {(() => {
                try {
                  const d = new Date(review.reviewed_at);
                  return isNaN(d.getTime())
                    ? review.reviewed_at
                    : d.toLocaleDateString();
                } catch {
                  return review.reviewed_at;
                }
              })()}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style lang="postcss">
  .review-panel {
    @apply bg-page border border-stroke rounded-lg p-4 sm:p-6 mb-6;
  }

  .review-title {
    @apply flex items-center gap-2 text-base font-semibold text-content w-full
           text-left cursor-pointer hover:text-content-muted transition-colors duration-150;
  }

  .review-count {
    @apply text-xs font-normal text-content-subtle bg-surface-alt px-2 py-0.5 rounded-full;
  }

  .review-cards {
    @apply grid gap-4 sm:grid-cols-2 mt-4;
  }

  .review-card {
    @apply bg-surface rounded-lg border border-stroke p-4;
  }

  .review-card-stale {
    @apply border-dashed opacity-80;
  }

  .review-verdict-stale {
    @apply bg-surface-alt text-content-subtle border border-stroke normal-case;
  }

  .review-stale-note {
    @apply mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900;
  }

  .review-header {
    @apply flex items-center justify-between mb-2;
  }

  .review-header-right {
    @apply flex items-center gap-2;
  }

  .review-score {
    @apply text-xs font-medium text-content-subtle;
  }

  .review-model {
    @apply text-sm font-medium text-content-muted;
  }

  .review-verdict {
    @apply rounded-full border px-2 py-1 text-xs font-medium capitalize;
  }

  /* Verdict and severity colors follow the shared alert palette in app.css
     (alert-error / alert-warn), with a success ramp for approvals. */
  .review-verdict--approved {
    @apply border-green-200 bg-green-50 text-green-800;
  }
  .review-verdict--needs_revision {
    @apply border-amber-200 bg-amber-50 text-amber-900;
  }
  .review-verdict--flagged {
    @apply border-red-200 bg-red-50 text-red-800;
  }
  .review-verdict--neutral {
    @apply border-stroke bg-surface-alt text-content;
  }

  .review-summary {
    @apply text-sm text-content-muted mb-3;
  }

  .review-flags {
    @apply mb-2;
  }

  .flags-toggle {
    @apply text-xs font-medium text-content-subtle cursor-pointer hover:text-content-muted;
  }

  .flags-list {
    @apply mt-2 space-y-2;
  }

  .flag-item {
    @apply flex items-start gap-2 text-xs;
  }

  .flag-severity {
    @apply flex-shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase leading-none tracking-wide;
  }
  .flag-severity--error {
    @apply border-red-200 bg-red-50 text-red-800;
  }
  .flag-severity--warning {
    @apply border-amber-200 bg-amber-50 text-amber-900;
  }
  .flag-severity--info {
    @apply border-stroke bg-surface-alt text-content-muted;
  }

  .flag-field {
    @apply font-mono text-content-subtle block;
  }

  .flag-concern {
    @apply text-content-muted block;
  }

  .flag-suggestion {
    @apply mt-1 block text-content-muted;
  }

  .flag-suggestion-label {
    @apply font-semibold text-primary-700;
  }

  .review-date {
    @apply text-xs text-content-faint;
  }

  .review-empty {
    @apply text-sm text-content-subtle italic;
  }

  .review-all-clear {
    @apply mb-2 text-sm font-medium text-green-700;
  }

  /* Dark theme: Svelte scopes styles, so target the global .dark root. These
     mirror the dark variants of .alert-error / .alert-warn in app.css. */
  :global(.dark) .review-stale-note,
  :global(.dark) .review-verdict--needs_revision,
  :global(.dark) .flag-severity--warning {
    border-color: rgb(146 64 14 / 0.5); /* amber-800/50 */
    background-color: rgb(69 26 3 / 0.3); /* amber-950/30 */
    color: rgb(254 243 199); /* amber-100 */
  }
  :global(.dark) .review-verdict--flagged,
  :global(.dark) .flag-severity--error {
    border-color: rgb(153 27 27 / 0.6); /* red-800/60 */
    background-color: rgb(69 10 10 / 0.3); /* red-950/30 */
    color: rgb(254 202 202); /* red-200 */
  }
  :global(.dark) .review-verdict--approved {
    border-color: rgb(22 101 52 / 0.6); /* green-800/60 */
    background-color: rgb(5 46 22 / 0.3); /* green-950/30 */
    color: rgb(187 247 208); /* green-200 */
  }
  :global(.dark) .review-all-clear {
    color: rgb(134 239 172); /* green-300 */
  }
  :global(.dark) .flag-suggestion-label {
    color: rgb(var(--sv-primary));
  }
</style>
