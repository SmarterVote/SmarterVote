/**
 * Fixed copy for the OAuth error codes Auth0 can append to the /admin redirect.
 * The `error_description` query param is never shown: anyone can craft a link
 * to /admin?error=x&error_description=<any text>, so rendering it would let a
 * third party put arbitrary words in a Smarter.Vote-branded alert.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "Access was denied. Sign in with an account that has admin access.",
  unauthorized:
    "Access was denied. Sign in with an account that has admin access.",
  login_required: "Your sign-in session ended. Sign in again to continue.",
  consent_required:
    "Sign-in needs your consent to continue. Sign in again to approve it.",
  interaction_required: "Sign-in needs your input. Sign in again to continue.",
  mfa_required:
    "Multi-factor verification is required. Sign in again to complete it.",
  temporarily_unavailable:
    "Sign-in is temporarily unavailable. Please try again in a few minutes.",
  server_error: "Sign-in failed on the identity provider. Please try again.",
};

export const GENERIC_AUTH_ERROR_MESSAGE =
  "Sign-in didn't complete. Please try again.";

/** User-facing message for an Auth0 `error` code; generic for anything else. */
export function authErrorMessage(code: string | null | undefined): string {
  const key = (code ?? "").trim().toLowerCase();
  return (
    (Object.hasOwn(AUTH_ERROR_MESSAGES, key) && AUTH_ERROR_MESSAGES[key]) ||
    GENERIC_AUTH_ERROR_MESSAGE
  );
}
