<script lang="ts">
  import UiIcon from "$lib/components/UiIcon.svelte";
</script>

<section
  class="bg-primary-950 py-20 text-white sm:py-28"
  aria-labelledby="trust-heading"
>
  <div class="page-container">
    <div class="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:gap-20">
      <div>
        <p
          class="text-xs font-semibold uppercase tracking-wider text-primary-300"
        >
          Our editorial promise
        </p>
        <h2
          id="trust-heading"
          class="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl"
        >
          Don't take our word for it.
        </h2>
        <p class="mt-5 max-w-md text-lg leading-8 text-primary-100/80">
          Read the evidence, see where it disagrees, and decide for yourself.
        </p>
        <a
          href="/about/#methodology"
          class="mt-8 inline-flex items-center gap-1.5 border-b border-primary-400 pb-1 font-semibold text-primary-200 transition hover:text-white"
          >Examine our methodology <UiIcon name="arrow-right" size="sm" /></a
        >
      </div>
      <div class="divide-y divide-primary-800 border-y border-primary-800">
        {#each [["01", "See the sources behind the research", "Follow the evidence back to candidate statements, public records, and reputable reporting."], ["02", "Uncertainty stays visible", "Sparse evidence, conflicting accounts, and confidence levels are part of the record—not hidden in fine print."], ["03", "No endorsements. Ever.", "We organize evidence consistently across parties. The judgment about what matters remains yours."]] as principle}
          <article
            class="grid grid-cols-[3rem_1fr] gap-4 py-7 sm:grid-cols-[4rem_1fr]"
          >
            <span class="font-mono text-sm text-primary-300"
              >{principle[0]}</span
            >
            <div>
              <h3 class="text-xl font-bold sm:text-2xl">{principle[1]}</h3>
              <p class="mt-2 max-w-xl leading-7 text-primary-100/80">
                {principle[2]}
              </p>
            </div>
          </article>
        {/each}
      </div>
    </div>
  </div>
</section>
