<script lang="ts">
  import { page } from "$app/stores";
  import EmptyState from "$lib/components/EmptyState.svelte";

  $: status = $page.status ?? 404;
  $: notFound = status === 404;
  // SvelteKit's default 404 message ("Not Found") only repeats the title.
  $: rawMessage = $page.error?.message?.trim() ?? "";
  $: message =
    rawMessage && rawMessage.toLowerCase() !== "not found"
      ? rawMessage
      : notFound
        ? "The page may have moved or the address may be incorrect. You can return home or continue to the election directory."
        : "An unexpected error occurred while processing your request.";
  $: title = notFound ? "Page not found" : "Something went wrong";
</script>

<svelte:head>
  <title>{notFound ? title : `Error ${status}`} | Smarter.Vote</title>
  <meta name="description" content={message} />
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page-container py-12 sm:py-16">
  <EmptyState
    {title}
    body={message}
    primaryHref="/"
    primaryLabel="Go home"
    secondaryHref="/elections/"
    secondaryLabel="Browse elections"
  >
    <p class="mt-3 text-sm text-content-subtle">
      Error {status}. If you followed a link here, check the URL or
      <a href="/elections/" class="text-primary underline hover:no-underline"
        >search the election directory</a
      >.
    </p>
  </EmptyState>
</div>
