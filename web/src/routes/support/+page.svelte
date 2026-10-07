<script lang="ts">
  import ContactCard from "$lib/components/support/ContactCard.svelte";
  import PolicySection from "$lib/components/support/PolicySection.svelte";
  import SupportTiers from "$lib/components/support/SupportTiers.svelte";
  import TrustPage from "$lib/components/support/TrustPage.svelte";

  const paymentsEnabled = import.meta.env.VITE_PAYMENTS_ENABLED === "true";
</script>

<TrustPage
  title="Support Smarter.Vote"
  description="Help Smarter.Vote LLC build broader, dependable election coverage."
  path="/support/"
  eyebrow="Get involved"
>
  <PolicySection title="Why support matters right now">
    <p>
      So far, Smarter.Vote has been funded entirely by its founder. There are no
      advertisers, sponsors, or campaign dollars behind it, and every race guide
      carries real research, data, and hosting costs.
    </p>
    <p>
      The next steps are expanding beyond national races to state and local
      contests, and keeping coverage going through the 2028 cycle. Neither is
      possible on one person's budget. Reader support is what makes them happen.
    </p>
  </PolicySection>
  {#if paymentsEnabled}
    <SupportTiers />
  {:else}
    <PolicySection title="Secure payments are opening soon">
      <p>
        We are finishing the payment and accounting setup for Smarter.Vote LLC.
        Until that work is complete, no payment information is collected here.
        You can contact us below if you would like to help fund broader election
        coverage.
      </p>
    </PolicySection>
  {/if}
  <PolicySection title="What your support enables">
    <p>
      Funding helps pay for election-data access, research, source review,
      accessibility, hosting, and expansion beyond national races. Until
      dependable provider coverage is affordable and validated, we will not
      imply complete state or local ballot coverage.
    </p>
  </PolicySection>
  <PolicySection title="Support terms">
    <p>
      Support is accepted by Smarter.Vote LLC. It is not tax-deductible. Any
      geographic or program preference is a nonbinding request, not a legally
      restricted fund, unless a written agreement explicitly says otherwise.
    </p>
    <p>
      No support payment buys favorable coverage, editorial review, access to
      unpublished findings, or control of research.
    </p>
  </PolicySection>
  <ContactCard
    subject="Question about supporting Smarter.Vote"
    label="Contact us about support"
  />
</TrustPage>
