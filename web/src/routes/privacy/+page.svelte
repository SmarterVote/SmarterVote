<script lang="ts">
  import ContactCard from "$lib/components/support/ContactCard.svelte";
  import PolicySection from "$lib/components/support/PolicySection.svelte";
  import TrustPage from "$lib/components/support/TrustPage.svelte";
</script>

<TrustPage
  title="Privacy"
  description="A plain-language description of how Smarter.Vote handles visitor, inquiry, and payment data."
  path="/privacy/"
  eyebrow="Policy"
  updated="2026-10-01"
>
  <PolicySection title="Data we handle">
    <p>
      The public site may receive ordinary technical request data and
      privacy-preserving traffic measurements. If you email us, Gmail processes
      the message and related account information. Please send only what is
      needed for your inquiry.
    </p>
  </PolicySection>
  <PolicySection title="Address lookup">
    <p>
      If address suggestions are enabled, what you type is sent directly from
      your browser to Google Places. Selecting a suggestion retrieves its
      formatted address. The completed address is then sent directly from your
      browser to the U.S. Census Geocoder to identify a state and congressional
      district. Smarter.Vote does not send the address to its own server, place
      it in the page URL or analytics, or save it in browser storage. The
      derived state, district, and matched race IDs are kept in this tab's
      session storage so results survive a refresh. Google and the Census Bureau
      handle their parts of the lookup under their own policies. The derived
      values are cleared when you search another address or close the tab.
    </p>
  </PolicySection>
  <PolicySection title="Support payments">
    <p>
      When online support payments are enabled, checkout is handled by Stripe on
      Stripe's own pages. Stripe collects your card details, email address, and
      billing information and processes them under its own privacy policy.
      Smarter.Vote never receives your card number. Payment records, including
      the amount and the contact details you give Stripe, are kept in
      Smarter.Vote LLC's Stripe account for receipts, bookkeeping, refunds, and
      managing monthly support. Our own server logs only the checkout session
      ID, amount, and payment status.
    </p>
  </PolicySection>
  <PolicySection title="Administrator sign-in">
    <p>
      Visitors do not need to sign in. Auth0 is used only for Smarter.Vote
      administrators to sign in to the site's admin tools, and processes their
      account and login data under its own policies. No visitor account data is
      collected.
    </p>
  </PolicySection>
  <PolicySection title="Retention and access">
    <p>
      The Gmail inbox is initially limited to the Smarter.Vote LLC owner,
      protected with multi-factor authentication, and organized by inquiry type.
      Our working target is to delete inactive inquiry correspondence after 12
      months unless it is needed for an active matter, legal obligation,
      security, or bookkeeping.
    </p>
  </PolicySection>
  <PolicySection title="Your choices">
    <p>
      You can browse public research without an account. You may ask about,
      correct, or request deletion of personal information you sent us, subject
      to obligations that require retention.
    </p>
  </PolicySection>
  <ContactCard subject="Privacy request" label="Send a privacy request" />
</TrustPage>
