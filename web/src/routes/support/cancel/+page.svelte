<script lang="ts">
  import TrustPage from "$lib/components/support/TrustPage.svelte";
</script>

<TrustPage
  title="Checkout cancelled"
  description="Your Smarter.Vote support checkout was cancelled."
  path="/support/cancel/"
  noindex
>
  <p class="text-content-muted">
    No payment was taken. You can <a
      href="/support/"
      class="text-primary underline hover:no-underline"
      >return to the support page</a
    > whenever you're ready.
  </p>
</TrustPage>
