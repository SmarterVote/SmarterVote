<script lang="ts">
  import UiIcon from "$lib/components/UiIcon.svelte";
</script>

<!-- An aside with a styled label, not an h2: like the results callout, it
     sits above the page's h1, and a heading here would put the outline out
     of order. -->
<aside
  class="card mb-8 flex flex-col gap-4 border-primary-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 dark:border-primary-800/60"
  aria-labelledby="home-support-heading"
>
  <div class="min-w-0">
    <p id="home-support-heading" class="h-card">Thank you</p>
    <p class="mt-1 max-w-3xl text-sm leading-6 text-content-muted">
      Thank you to everyone who used Smarter.Vote this election season. Next, we
      want to research the voting records and public stances of officials now in
      office, and start early on 2028. If Smarter.Vote helped you, please
      consider supporting that work.
    </p>
  </div>
  <a href="/support/" class="btn-primary shrink-0 self-start sm:self-center">
    Support Smarter.Vote <UiIcon name="arrow-right" size="sm" />
  </a>
</aside>
