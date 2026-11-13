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
  updated="2026-11-04"
>
  <PolicySection title="Data we handle">
    <p>
      Like any website, our hosting providers (Cloudflare for the site and
      Google Cloud for our API) receive ordinary technical request data such as
      your IP address, browser user agent, and the page requested. If you email
      us, Gmail processes the message and related account information. Please
      send only what is needed for your inquiry.
    </p>
    <p>
      We measure traffic with Cloudflare Web Analytics, which does not use
      cookies or track you across sites. Our API keeps request statistics with
      IP addresses replaced by a keyed one-way hash; it does not store raw IP
      addresses for analytics.
    </p>
    <p>
      The site remembers your light or dark theme choice in your browser's local
      storage. It sets no advertising or tracking cookies.
    </p>
  </PolicySection>
  <PolicySection title="Candidate photos">
    <p>
      We do not host candidate photos ourselves. Each headshot is loaded by your
      browser straight from the site that publishes it: Wikimedia Commons,
      official government sites such as house.gov and senate.gov, campaign
      websites (many of them run on hosts such as Wix or Squarespace), social
      media image servers, and others. A busy page such as Results can load
      photos from dozens of different sites at once.
    </p>
    <p>
      Each of those sites receives your IP address, your browser's user agent,
      and the address of the image itself, as with any image on the web. Our
      pages ask your browser not to send the address of the Smarter.Vote page
      you were on. Those sites handle that request data under their own
      policies, which we do not control, and some may set or read their own
      cookies. If a photo fails to load, the site shows the candidate's initials
      instead.
    </p>
  </PolicySection>
  <PolicySection title="Address lookup">
    <p>
      If address suggestions are enabled, what you type is sent directly from
      your browser to Google Places. Selecting a suggestion retrieves its
      formatted address. The completed address is then sent to Smarter.Vote's
      API, which forwards it to the U.S. Census Geocoder to identify a state and
      congressional district and returns only those two values. Our API does not
      store or log the address, and it is never placed in the page URL,
      analytics, or browser storage. Google and the Census Bureau handle their
      parts of the lookup under their own policies.
    </p>
    <p>
      The derived state, district, and matched race IDs are kept in this tab's
      session storage so results survive a refresh, and are cleared when you
      search another address or close the tab. The state and district (not your
      address) are also added to the My Ballot page URL so the results can be
      bookmarked or shared; anyone you share that link with can see them.
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
