<script lang="ts">
  import UiIcon from "./UiIcon.svelte";

  export let ballotpediaUrl: string | null = null;
  export let registerToVoteUrl: string = "https://vote.gov/register";
  export let howToVoteUrl: string = "https://vote.gov/";
</script>

<!-- One primary action (registering) and two equal secondary links, instead of
     three competing colours. -->
<section class="card voter-resources" aria-labelledby="voter-resources-heading">
  <h2 id="voter-resources-heading" class="h-card">Voting resources</h2>
  <div class="voter-resource-list">
    <a
      href={registerToVoteUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="btn-primary voter-resource-btn"
    >
      <svg
        class="h-5 w-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
      <span class="flex-1">Register to Vote</span>
      <UiIcon name="external" size="sm" />
    </a>

    <a
      href={howToVoteUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="btn-secondary voter-resource-btn"
    >
      <svg
        class="h-5 w-5 shrink-0 text-content-subtle"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
      <span class="flex-1">How to Vote</span>
      <UiIcon name="external" size="sm" />
    </a>

    {#if ballotpediaUrl}
      <a
        href={ballotpediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="btn-secondary voter-resource-btn"
      >
        <svg
          class="h-5 w-5 shrink-0 text-content-subtle"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        <span class="flex-1">Election on Ballotpedia</span>
        <UiIcon name="external" size="sm" />
      </a>
    {/if}
  </div>
</section>

<style lang="postcss">
  .voter-resources {
    @apply p-5;
  }

  /* Stacked in the desktop sidebar and on phones; a row on tablets. */
  .voter-resource-list {
    @apply mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-col;
  }

  .voter-resource-btn {
    @apply justify-start text-left no-underline sm:flex-1 lg:flex-none;
  }
</style>
