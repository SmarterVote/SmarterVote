<script lang="ts">
  import ContactCard from "$lib/components/support/ContactCard.svelte";
  import PolicySection from "$lib/components/support/PolicySection.svelte";
  import TrustPage from "$lib/components/support/TrustPage.svelte";
</script>

<TrustPage
  title="Funding and editorial independence"
  description="The rules separating Smarter.Vote funding from its election research and publication decisions."
  path="/funding-and-editorial-independence/"
  eyebrow="Accountability"
  updated="2026-10-07"
>
  <PolicySection title="Current funding">
    <p>
      So far, Smarter.Vote has been funded entirely by its founder, Jacob
      Loukota. It has no institutional funders, sponsors, or advertisers.
      Smarter.Vote LLC now accepts individual support, and all funding follows
      the rules on this page.
    </p>
    <p>
      Expanding coverage to state and local races and continuing through 2028
      will depend on that support. If you value this work, you can
      <a class="text-primary underline hover:no-underline" href="/support/"
        >support Smarter.Vote</a
      >.
    </p>
  </PolicySection>
  <PolicySection title="Editorial control">
    <p>
      Smarter.Vote LLC retains final authority over research methods, sources,
      findings, confidence labels, forecasts, corrections, and publication.
      Financial support never guarantees coverage or favorable treatment.
    </p>
  </PolicySection>
  <PolicySection title="Funding we will not accept">
    <p>
      We will not accept institutional funding from political candidates or
      campaigns, political parties, PACs, ballot committees, foreign political
      actors, undisclosed institutional funders, or anyone conditioning payment
      on an editorial outcome.
    </p>
    <p>
      We may also decline funding that creates a material conflict, threatens
      reader trust, or cannot be disclosed appropriately. These rules apply even
      when funding would otherwise expand coverage.
    </p>
  </PolicySection>
  <PolicySection title="Priorities, disclosure, and recognition">
    <p>
      Funding may help prioritize a geography or coverage category only through
      published quality standards; it cannot change what the research says.
      Individual recognition will be private by default and opt-in. We disclose
      institutional relationships at the program level, including the sponsor
      and purpose. We will publish amount bands after those bands receive
      appropriate professional review.
    </p>
    <p>
      Until disclosure bands and exceptions are approved, Smarter.Vote LLC uses
      specific written agreements and does not promise anonymity or public
      recognition.
    </p>
  </PolicySection>
  <PolicySection title="Support is not a charitable donation">
    <p>
      Smarter.Vote LLC is not presenting itself as a nonprofit or tax-exempt
      charity. Contributions are not tax-deductible. Supporter allocation
      choices are nonbinding preferences unless a written agreement expressly
      creates a restriction.
    </p>
  </PolicySection>
  <ContactCard subject="Funding independence question" />
</TrustPage>
