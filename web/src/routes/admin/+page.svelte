<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { getAuth0Client } from "$lib/auth";
  import { authErrorMessage } from "$lib/utils/authErrors";

  let authError = "";
  let sessionExpired = false;
  /** True once we are handing off to Auth0, so the page isn't blank. */
  let redirecting = false;

  function clearAuthQueryParams() {
    const url = new URL(window.location.href);
    ["code", "state", "error", "error_description", "session_expired"].forEach(
      (p) => url.searchParams.delete(p),
    );
    history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  /**
   * A first visit lets Auth0 reuse an existing SSO session (no prompt). Only
   * a retry after an error or an expired session forces the login screen, so
   * the user can re-enter credentials or switch to an admin account.
   */
  async function startLogin(forcePrompt = false) {
    redirecting = true;
    const auth0 = await getAuth0Client();
    await auth0.loginWithRedirect(
      forcePrompt ? { authorizationParams: { prompt: "login" } } : undefined,
    );
  }

  async function retryLogin() {
    authError = "";
    try {
      await startLogin(true);
    } catch (error) {
      console.error("Admin sign-in could not start.", error);
      redirecting = false;
      authError = "Sign-in is unavailable right now. Please try again later.";
    }
  }

  onMount(async () => {
    try {
      const auth0 = await getAuth0Client();
      const params = new URLSearchParams(window.location.search);

      if (params.has("error")) {
        // Never echo error_description: it is attacker-controllable text.
        const code = params.get("error");
        clearAuthQueryParams();
        authError = authErrorMessage(code);
        return;
      }

      if (params.has("session_expired")) {
        // fetchWithAuth sends us here after the API rejected a refreshed
        // token. Explain why instead of bouncing straight into a redirect.
        clearAuthQueryParams();
        sessionExpired = true;
        authError = "Your admin session expired. Sign in again to continue.";
        return;
      }

      if (params.has("code")) {
        try {
          await auth0.handleRedirectCallback();
          clearAuthQueryParams();
          await goto("/admin/pipeline", { replaceState: true });
          return;
        } catch {
          clearAuthQueryParams();
          authError = "Sign-in didn't complete. Please try again.";
          return;
        }
      }

      const isAuthenticated = await auth0.isAuthenticated().catch(() => false);
      if (isAuthenticated) {
        await goto("/admin/pipeline", { replaceState: true });
        return;
      }

      await startLogin();
    } catch (error) {
      // Configuration detail is for operators only; visitors get plain copy.
      console.error(
        "Admin sign-in could not start. Verify the Auth0 domain, client id, and audience configuration.",
        error,
      );
      redirecting = false;
      authError = "Sign-in is unavailable right now. Please try again later.";
    }
  });
</script>

<svelte:head>
  <title>Admin Sign In | Smarter.Vote</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="page-narrow max-w-xl py-16">
  <h1 class="h-page">Admin sign-in</h1>
  <p class="mt-2 text-content-muted">For Smarter.Vote staff.</p>

  {#if authError}
    <div
      class="mt-6 {sessionExpired ? 'alert-warn' : 'alert-error'}"
      role="alert"
    >
      <p>{authError}</p>
    </div>
    <button type="button" class="btn-primary mt-4" on:click={retryLogin}>
      {sessionExpired ? "Sign in again" : "Sign in"}
    </button>
  {:else}
    <p
      class="mt-6 flex items-center gap-2 text-sm text-content-muted"
      role="status"
    >
      <span
        class="h-4 w-4 animate-spin rounded-full border-2 border-stroke border-t-primary"
        aria-hidden="true"
      ></span>
      {redirecting ? "Redirecting to sign-in…" : "Checking your session…"}
    </p>
  {/if}
</div>
