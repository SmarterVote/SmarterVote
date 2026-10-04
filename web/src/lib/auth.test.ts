import { afterEach, describe, expect, it, vi } from "vitest";

describe("Auth0 frontend config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reports missing required Auth0 env vars", async () => {
    vi.stubEnv("VITE_SKIP_AUTH", "false");
    vi.stubEnv("VITE_AUTH0_DOMAIN", "");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "");
    vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.example.test");

    const { getAuth0ConfigError, getAuth0Client } = await import("./auth");

    expect(getAuth0ConfigError()).toContain("VITE_AUTH0_DOMAIN");
    expect(getAuth0ConfigError()).toContain("VITE_AUTH0_CLIENT_ID");
    await expect(getAuth0Client()).rejects.toThrow("Auth0 is not configured");
  });

  it("returns a stub client when auth is skipped in development", async () => {
    vi.stubEnv("VITE_SKIP_AUTH", "true");
    vi.stubEnv("VITE_AUTH0_DOMAIN", "");

    const { getAuth0ConfigError, getAuth0Client, isAuthSkipped } =
      await import("./auth");

    expect(isAuthSkipped()).toBe(true);
    expect(getAuth0ConfigError()).toBeNull();
    const client = await getAuth0Client();
    await expect(client.isAuthenticated()).resolves.toBe(true);
    await expect(client.getTokenSilently()).resolves.toBe("dev-token");
    await expect(client.handleRedirectCallback()).resolves.toEqual({
      appState: {},
    });
    await expect(client.loginWithRedirect()).resolves.toBeUndefined();
    await expect(client.logout()).resolves.toBeUndefined();
  });

  it("never skips auth in production builds", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_SKIP_AUTH", "true");
    const { isAuthSkipped } = await import("./auth");
    expect(isAuthSkipped()).toBe(false);
  });

  it("names a single missing var in the singular", async () => {
    vi.stubEnv("VITE_SKIP_AUTH", "false");
    vi.stubEnv("VITE_AUTH0_DOMAIN", "tenant.auth0.com");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "client");
    vi.stubEnv("VITE_AUTH0_AUDIENCE", "   ");
    const { getAuth0ConfigError } = await import("./auth");
    expect(getAuth0ConfigError()).toBe(
      "Auth0 is not configured. Missing frontend env var: VITE_AUTH0_AUDIENCE.",
    );
  });

  it("creates one trimmed, cached Auth0 client when configured", async () => {
    const fakeClient = { isAuthenticated: vi.fn() };
    const createAuth0Client = vi.fn().mockResolvedValue(fakeClient);
    vi.doMock("@auth0/auth0-spa-js", () => ({ createAuth0Client }));
    vi.stubEnv("VITE_SKIP_AUTH", "false");
    vi.stubEnv("VITE_AUTH0_DOMAIN", " tenant.auth0.com ");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "client-id");
    vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.example.test");
    try {
      const { getAuth0Client } = await import("./auth");
      const first = await getAuth0Client();
      const second = await getAuth0Client();

      expect(first).toBe(fakeClient);
      expect(second).toBe(first);
      expect(createAuth0Client).toHaveBeenCalledTimes(1);
      expect(createAuth0Client).toHaveBeenCalledWith({
        domain: "tenant.auth0.com",
        clientId: "client-id",
        authorizationParams: {
          redirect_uri: `${window.location.origin}/admin`,
          audience: "https://api.example.test",
        },
      });
    } finally {
      vi.doUnmock("@auth0/auth0-spa-js");
    }
  });
});
