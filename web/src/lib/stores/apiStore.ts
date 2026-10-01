/**
 * API utilities and authentication store (admin-only).
 *
 * Do not import this module statically from public code paths — it pulls in
 * `$lib/auth` and `@auth0/auth0-spa-js`. Public modules use `await import()`.
 */
import { writable } from "svelte/store";
import { getAuth0Client } from "$lib/auth";
import { logger } from "$lib/utils/logger";
import type { Auth0Client } from "@auth0/auth0-spa-js";

interface ApiState {
  auth0: Auth0Client | null;
  isAuthenticated: boolean;
  /** Set when the session can no longer produce a valid token. */
  sessionExpired: boolean;
}

const initialState: ApiState = {
  auth0: null,
  isAuthenticated: false,
  sessionExpired: false,
};

export const apiStore = writable<ApiState>(initialState);

export const SESSION_EXPIRED_MESSAGE = "Session expired — sign in again.";
export const SESSION_EXPIRED_PATH = "/admin/?session_expired=1";
export const SIGN_IN_REQUIRED_MESSAGE = "Sign in required.";
export const SIGN_IN_PATH = "/admin/";

/** Raised when the API keeps rejecting the session after a forced token refresh. */
export class SessionExpiredError extends Error {
  constructor(message: string = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/**
 * Raised when there was never a session in this page (e.g. a direct visit to
 * /admin/pipeline/ while signed out). Not an "expiry": the user is routed to
 * the normal sign-in flow instead of the session-expired notice.
 */
export class SignInRequiredError extends SessionExpiredError {
  constructor(message: string = SIGN_IN_REQUIRED_MESSAGE) {
    super(message);
    this.name = "SignInRequiredError";
  }
}

/** Auth0 error codes that mean the user must sign in again interactively. */
const LOGIN_REQUIRED_CODES = new Set([
  "login_required",
  "consent_required",
  "interaction_required",
  "missing_refresh_token",
  "invalid_grant",
]);

export function isLoginRequired(error: unknown): boolean {
  const code = (error as { error?: unknown } | null)?.error;
  return typeof code === "string" && LOGIN_REQUIRED_CODES.has(code);
}

let sessionExpiredHandler: () => void = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/admin/pipeline")) {
    window.location.assign(SESSION_EXPIRED_PATH);
  }
};

/** Override the redirect performed when the session expires (tests, embedding). */
export function setSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
}

let signInRequiredHandler: () => void = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/admin/pipeline")) {
    window.location.assign(SIGN_IN_PATH);
  }
};

/** Override the redirect used when no session ever existed (tests, embedding). */
export function setSignInRequiredHandler(handler: () => void): void {
  signInRequiredHandler = handler;
}

function wasAuthenticated(): boolean {
  let authenticated = false;
  const unsubscribe = apiStore.subscribe((state) => {
    authenticated = state.isAuthenticated || state.sessionExpired;
  });
  unsubscribe();
  return authenticated;
}

/**
 * Only a session that was authenticated in this page can "expire". Without
 * one (a signed-out direct visit, or a request racing initializeAuth), route
 * to the normal sign-in flow instead of showing a misleading expiry notice.
 */
function markSessionExpired(): SessionExpiredError {
  if (!wasAuthenticated()) {
    try {
      signInRequiredHandler();
    } catch (error) {
      logger.error("Sign-in-required handler failed:", error);
    }
    return new SignInRequiredError();
  }
  apiStore.update((state) => ({
    ...state,
    isAuthenticated: false,
    sessionExpired: true,
  }));
  try {
    sessionExpiredHandler();
  } catch (error) {
    logger.error("Session-expired handler failed:", error);
  }
  return new SessionExpiredError();
}

function currentClient(): Auth0Client | null {
  let client: Auth0Client | null = null;
  const unsubscribe = apiStore.subscribe((state) => {
    client = state.auth0;
  });
  unsubscribe();
  return client;
}

async function resolveClient(): Promise<Auth0Client> {
  const existing = currentClient();
  if (existing) return existing;
  try {
    const client = await getAuth0Client();
    apiStore.update((state) => ({ ...state, auth0: client }));
    return client;
  } catch (error) {
    logger.error("Failed to refresh token:", error);
    throw new Error("Authentication token refresh failed");
  }
}

/**
 * Ask the SDK for a token on every request. auth0-spa-js caches tokens and
 * renews them before expiry, so this is cheap; `forceRefresh` bypasses the
 * cache after the API rejected the cached token.
 */
async function acquireToken(
  client: Auth0Client,
  forceRefresh: boolean,
): Promise<string> {
  try {
    const token = await client.getTokenSilently(
      forceRefresh ? { cacheMode: "off" } : undefined,
    );
    apiStore.update((state) => ({
      ...state,
      isAuthenticated: true,
      sessionExpired: false,
    }));
    return token;
  } catch (error) {
    logger.error("Failed to refresh token:", error);
    if (isLoginRequired(error)) throw markSessionExpired();
    throw new Error("Authentication token refresh failed");
  }
}

/**
 * Initialize authentication
 */
export async function initializeAuth() {
  try {
    const auth0 = await getAuth0Client();
    const token = await auth0.getTokenSilently();

    apiStore.update((state) => ({
      ...state,
      auth0,
      isAuthenticated: true,
      sessionExpired: false,
    }));

    return { auth0, token };
  } catch (error) {
    logger.error("Failed to initialize auth:", error);
    throw error;
  }
}

async function sendRequest(
  url: string,
  options: RequestInit,
  token: string,
  timeoutMs?: number,
): Promise<Response> {
  // Different timeout strategies based on operation type
  const defaultTimeout = 30000; // 30 seconds for most operations

  // Determine if this is a long-running operation that shouldn't timeout
  const isLongRunningOperation =
    url.includes("/runs/") || // Pipeline run operations
    url.includes("/api/races/queue") || // Queueing pipeline work
    url.includes("/continue") || // Pipeline continuation
    (options.method === "POST" && url.includes("/run")); // Any run operation

  // Use provided timeout, or no timeout for long operations, or default
  const actualTimeout =
    timeoutMs !== undefined
      ? timeoutMs
      : isLongRunningOperation
        ? null
        : defaultTimeout;

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  if (actualTimeout !== null) {
    timeoutId = setTimeout(() => controller.abort(), actualTimeout);
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });

    if (timeoutId) clearTimeout(timeoutId);
    return response;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutText = actualTimeout
        ? `after ${actualTimeout / 1000} seconds`
        : "due to abort signal";
      throw new Error(
        `Request timed out ${timeoutText}: ${options.method ?? "GET"} ${url}`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Network request failed: ${options.method ?? "GET"} ${url}. ${message}`,
    );
  }
}

/**
 * Fetch with authentication and smart timeout handling.
 *
 * A token is requested from the SDK per call (it caches and renews). On a 401
 * the request is retried once with a token fetched bypassing the cache; a
 * second 401 marks the session expired and routes back to the sign-in page.
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  const client = await resolveClient();
  const token = await acquireToken(client, false);
  const response = await sendRequest(url, options, token, timeoutMs);
  if (response.status !== 401) return response;

  const freshToken = await acquireToken(client, true);
  const retry = await sendRequest(url, options, freshToken, timeoutMs);
  if (retry.status === 401) throw markSessionExpired();
  return retry;
}
