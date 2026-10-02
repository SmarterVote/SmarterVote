<script lang="ts">
  import ContactCard from "$lib/components/support/ContactCard.svelte";
  import PolicySection from "$lib/components/support/PolicySection.svelte";
  import TrustPage from "$lib/components/support/TrustPage.svelte";

  const paymentsEnabled = import.meta.env.VITE_PAYMENTS_ENABLED === "true";

  const onThisPage = [
    { href: "#purpose", label: "Purpose" },
    { href: "#why-this-exists", label: "Why this exists" },
    { href: "#ai-generated-content", label: "AI-generated content" },
    { href: "#availability", label: "What is available" },
    { href: "#methodology", label: "Methodology" },
    { href: "#forecast-methodology", label: "Forecasts" },
    { href: "#accountability", label: "Accountability" },
  ];

  const ratingThresholds = [
    { rating: "Toss-up", range: "below 55%" },
    { rating: "Tilt", range: "from 55%" },
    { rating: "Lean", range: "from 65%" },
    { rating: "Likely", range: "from 80%" },
    { rating: "Safe", range: "from 95%" },
  ];
</script>

<TrustPage
  title="About Smarter.Vote"
  description="Smarter.Vote uses AI to help produce sourced election research so people can compare candidates and inspect the underlying evidence."
  path="/about/"
  eyebrow="About"
>
  <nav slot="header" aria-label="On this page" class="mt-6">
    <p class="eyebrow mb-2 text-content-subtle">On this page</p>
    <ul class="flex flex-wrap gap-2 text-sm">
      {#each onThisPage as item}
        <li>
          <a
            href={item.href}
            class="inline-flex min-h-9 items-center rounded-full border border-stroke bg-surface px-3 font-medium text-content-muted transition-colors hover:border-primary-400 hover:text-primary"
            >{item.label}</a
          >
        </li>
      {/each}
    </ul>
  </nav>

  <PolicySection id="purpose" title="Our purpose">
    <p>
      Smarter.Vote makes public information about candidates easier to compare.
      Research pages link back to their sources, show uncertainty, and give
      readers a starting point for their own verification. Smarter.Vote does not
      endorse candidates or parties.
    </p>
  </PolicySection>

  <PolicySection id="why-this-exists" title="Why this exists">
    <p>
      I think having systems to choose our rules and leaders is one of the
      better ideas humanity has had. For as dysfunctional as our government can
      be, I've always felt lucky to live in a democracy.
    </p>
    <p>
      Most of what's wrong with it is firmly outside the scope of what one 27
      year old software engineer can fix. But in 2024 I went to vote and could
      hardly find any issue stances or positions for many of the candidates on
      my ballot.
    </p>
    <p>
      So I built this. Smarter.Vote runs an AI pipeline that researches issue
      stances for candidates in national races (U.S. House, U.S. Senate, and
      governor) and publishes the sources next to the answers, so you can check
      the work instead of taking my word for it. Ballot initiatives and local
      races are hopefully next.
    </p>
    <p class="font-medium text-content">— Jacob Loukota, Smarter.Vote LLC</p>
  </PolicySection>

  <PolicySection
    id="ai-generated-content"
    title="This site uses AI-generated content"
  >
    <p class="alert-info text-base font-medium text-content sm:text-lg">
      Much of the candidate and election research on Smarter.Vote is drafted,
      organized, classified, or summarized by artificial intelligence.
    </p>
    <p>
      This includes candidate summaries, issue-position comparisons, confidence
      labels, race analysis, and forecasts. Automated research and review
      systems work from public sources, but source links and automated checks do
      not guarantee that the resulting text is complete, current, neutral, or
      correct. Do not assume that every published statement has been
      individually fact-checked by a human.
    </p>
    <p>
      Smarter.Vote LLC chooses what systems to use and is responsible for what
      it publishes. Readers should inspect the cited evidence, compare it with
      official records and candidate statements, and report errors through the <a
        class="text-primary underline hover:no-underline"
        href="/corrections/">corrections process</a
      >.
    </p>
  </PolicySection>

  <PolicySection id="availability" title="What is available today">
    <p>
      Smarter.Vote is an early-stage service operated by Smarter.Vote LLC.
      Current research focuses on national races. It is not a complete ballot
      guide and does not yet provide dependable coverage of state legislatures,
      local offices, judicial races, or ballot measures.
    </p>
    <p>
      Automated tools assist with research and review, but they can miss context
      or make mistakes. Readers should check linked sources and official
      election authorities before acting.
    </p>
  </PolicySection>

  <section
    id="methodology"
    aria-labelledby="methodology-heading"
    class="scroll-mt-24 space-y-6 pt-4"
  >
    <div>
      <h2 id="methodology-heading" class="h-section">Our methodology</h2>
      <p class="mt-2 max-w-prose leading-7">
        How Smarter.Vote researches, reviews, and presents election information.
      </p>
    </div>

    <PolicySection level={3} title="How the research is made">
      <p>
        Automated research agents search public sources—including candidate
        statements, campaign websites, official records, voting databases, and
        reputable reporting—and organize the evidence into candidate summaries,
        issue positions, background, and race analysis. They are instructed to
        describe what candidates say and do without endorsing them.
      </p>
      <p>
        Source links remain attached to the research so readers can inspect the
        evidence directly. A source is not treated as neutral merely because it
        is linked: campaign material represents the candidate's own account,
        while records and reporting provide additional context.
      </p>
      <p>
        Candidates are listed with Democratic and Republican candidates first;
        within each group, incumbents come first, then alphabetical by last
        name. The order is not a ranking or an endorsement.
      </p>
    </PolicySection>

    <PolicySection level={3} title="Evidence and confidence">
      <p>
        Confidence labels describe the strength of the available evidence—not
        the value of a candidate or policy. High confidence requires multiple
        corroborating sources or an official candidate position. Medium
        confidence requires at least one credible source. Low confidence marks
        information that is inferred, unverified, or unsupported by a source.
      </p>
      <p>
        “No public position found” means the research process looked for an
        attributable position and did not find one. It does not mean the
        candidate has no view, and it is different from an issue that has not
        yet been researched.
      </p>
    </PolicySection>

    <PolicySection level={3} title="Automated review and publication">
      <p>
        Separate AI models review the full race side by side for the correct
        candidate roster, internal consistency, source quality, completeness,
        background accuracy, and neutral treatment across candidates. Automated
        checks also look for broken sources, malformed polling, placeholders,
        and missing required research.
      </p>
      <p>
        The automated research score combines the review models' scores and
        accounts for unresolved warnings. A failing score or an unresolved error
        blocks publication. This is automated editorial quality control, not a
        promise that every statement has been independently fact-checked by a
        human.
      </p>
    </PolicySection>

    <PolicySection
      id="forecast-methodology"
      level={3}
      title="How forecasts work"
    >
      <p>
        Every race forecast starts from the published race record: the verified
        candidate list, candidate-level polling, fundraising, incumbency, the
        district or state's partisan lean, and the documented race environment.
        Prediction-market prices can add context, but they are discounted when
        trading is thin or stale and are never treated as ground truth.
      </p>
      <p>
        Three AI models from different developers each estimate the race
        independently. None of them sees the others' answers or the previous
        forecast, so no single model's lean—and no stale number—decides the
        result. The published win probability is the median of their estimates,
        and the rating follows directly from it:
      </p>
      <dl
        class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-stroke bg-surface-alt px-4 py-3 text-sm sm:grid-cols-[auto_1fr]"
        aria-label="Forecast rating thresholds by win probability"
      >
        {#each ratingThresholds as t}
          <dt class="font-semibold text-content">{t.rating}</dt>
          <dd class="tabular-nums">{t.range}</dd>
        {/each}
      </dl>
      <p>
        Confidence reflects how closely the models agreed and how much polling
        exists; a race without public polling is never labeled high confidence.
      </p>
      <p>
        A separate writing step explains that consensus without changing its
        numbers, and a fact-check sends back any text that contradicts the
        race—for example, describing a primary as unresolved after it has been
        decided. Each forecast lists its key drivers, its main uncertainty, and
        the sources behind specific claims.
      </p>
      <p>
        Chamber forecasts combine race probabilities with known holdover seats.
        Polling errors tend to run in the same direction across the country, so
        the model lets every race shift together with a shared national swing
        instead of treating each contest as an independent coin flip. Each race
        keeps its own probability, but the range of seat outcomes and the chance
        of party control reflect how a real polling miss plays out. The chamber
        analysis is drafted independently by several leading AI models and
        merged by an editor model that checks every figure against the forecast.
        For the 2026 Senate forecast, a 50–50 result is counted as Republican
        control under the vice president tie-break assumption.
      </p>
    </PolicySection>

    <PolicySection level={3} title="Limits and updates">
      <p>
        Sources can be incomplete, positions can change, and automated analysis
        can misunderstand nuance. Polls capture a period in time, and forecasts
        change as new evidence arrives. Forecasts are estimates—not election
        results, voting advice, or guarantees.
      </p>
    </PolicySection>

    <PolicySection level={3} title="Verification and corrections">
      <p>
        Use the linked evidence to check research claims, and rely on state and
        local election officials for registration, deadlines, voting methods,
        and official results. Report errors through our
        <a
          class="text-primary underline hover:no-underline"
          href="/corrections/">corrections process</a
        >. Funding never determines findings, classifications, forecasts, or
        publication decisions.
      </p>
    </PolicySection>
  </section>

  <PolicySection id="accountability" title="Accountability">
    <p>
      Smarter.Vote LLC is responsible for the site, its editorial decisions,
      privacy inquiries, corrections, partnerships, and any future refunds.
      Learn more about our
      <a class="text-primary underline hover:no-underline" href="#methodology"
        >methodology</a
      >,
      <a class="text-primary underline hover:no-underline" href="/corrections/"
        >corrections policy</a
      >, and
      <a
        class="text-primary underline hover:no-underline"
        href="/funding-and-editorial-independence/"
        >funding and editorial independence policy</a
      >.
    </p>
  </PolicySection>

  <ContactCard subject="General question for Smarter.Vote LLC" />

  <p class="text-center text-sm">
    {#if paymentsEnabled}
      Smarter.Vote LLC accepts support through the
      <a class="text-primary underline hover:no-underline" href="/support/"
        >secure support page</a
      >. You can also support the individual developer separately through
    {:else}
      Smarter.Vote LLC is not yet accepting support payments. You can support
      the individual developer separately through
    {/if}
    <a
      class="text-primary underline hover:no-underline"
      href="https://github.com/sponsors/loukotaj"
      target="_blank"
      rel="noopener noreferrer">GitHub Sponsors</a
    >. GitHub Sponsors is personal support, not a contribution to Smarter.Vote
    LLC.
  </p>
</TrustPage>
