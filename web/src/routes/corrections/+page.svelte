<script lang="ts">
  import PolicySection from "$lib/components/support/PolicySection.svelte";
  import TrustPage from "$lib/components/support/TrustPage.svelte";
  import UiIcon from "$lib/components/UiIcon.svelte";

  const correctionsEmail = "SmarterDotVote@gmail.com";
  const correctionsMailto = `mailto:${correctionsEmail}?subject=${encodeURIComponent(
    "Correction report",
  )}`;
</script>

<TrustPage
  title="Corrections"
  description="How to report an error and how Smarter.Vote LLC reviews corrections."
  path="/corrections/"
  eyebrow="Accountability"
  updated="2026-10-01"
>
  <PolicySection title="Report a possible error">
    <p>
      Include the page URL, candidate or contest, the specific statement at
      issue, and a reliable supporting source. Do not include sensitive personal
      information.
    </p>
    <p>
      Email the report to
      <a
        class="font-medium text-primary underline hover:no-underline"
        href={correctionsMailto}>{correctionsEmail}</a
      >, or file it as a public GitHub issue if you want its status and
      resolution to be reviewable openly (that option needs a GitHub account).
    </p>
    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <a class="btn-primary w-full sm:w-auto" href={correctionsMailto}
        >Email a correction</a
      >
      <a
        href="https://github.com/SmarterVote/SmarterVote/issues/new?template=correction.yml"
        target="_blank"
        rel="noopener noreferrer"
        class="btn-secondary w-full sm:w-auto"
      >
        Report a correction on GitHub <UiIcon name="external" size="sm" />
      </a>
    </div>
  </PolicySection>
  <PolicySection title="What happens next">
    <p>
      Smarter.Vote LLC reviews the cited evidence and retains editorial control
      over the outcome. We may correct, clarify, add context, update sources, or
      determine that no change is warranted. When we make a material correction,
      we update the relevant page and its revision date.
    </p>
    <p>
      We are a small early-stage organization and do not yet promise a response
      time, but election-sensitive and safety-related reports receive priority.
    </p>
  </PolicySection>
</TrustPage>
