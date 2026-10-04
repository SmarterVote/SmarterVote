import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminSignIn from "./+page.svelte";

const auth0 = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  loginWithRedirect: vi.fn(),
  handleRedirectCallback: vi.fn(),
}));
const goto = vi.hoisted(() => vi.fn());

vi.mock("$lib/auth", () => ({ getAuth0Client: async () => auth0 }));
vi.mock("$app/navigation", () => ({ goto }));

function visit(search: string) {
  history.replaceState({}, "", `/admin/${search}`);
}

describe("admin sign-in page", () => {
  beforeEach(() => {
    auth0.isAuthenticated.mockResolvedValue(false);
    auth0.loginWithRedirect.mockResolvedValue(undefined);
    auth0.handleRedirectCallback.mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    visit("");
  });

  it("lets silent SSO work on a first visit (no forced login prompt)", async () => {
    visit("");
    render(AdminSignIn);
    await waitFor(() => expect(auth0.loginWithRedirect).toHaveBeenCalled());
    expect(auth0.loginWithRedirect).toHaveBeenCalledWith(undefined);
  });

  it("sends an authenticated admin straight to the pipeline", async () => {
    auth0.isAuthenticated.mockResolvedValue(true);
    visit("");
    render(AdminSignIn);
    await waitFor(() =>
      expect(goto).toHaveBeenCalledWith("/admin/pipeline", {
        replaceState: true,
      }),
    );
    expect(auth0.loginWithRedirect).not.toHaveBeenCalled();
  });

  it("shows fixed copy for Auth0 errors, never the error_description", async () => {
    visit(
      "?error=access_denied&error_description=Call%20555-0100%20now%E0%A4%A",
    );
    const { findByRole, container } = render(AdminSignIn);
    const alert = await findByRole("alert");
    expect(alert.textContent).toMatch(/Access was denied/);
    expect(container.textContent).not.toContain("555-0100");
    expect(window.location.search).toBe("");
  });

  it("uses generic copy for unknown error codes", async () => {
    visit("?error=%3Cb%3Ehi%3C%2Fb%3E");
    const { findByRole } = render(AdminSignIn);
    expect((await findByRole("alert")).textContent).toMatch(
      /Sign-in didn't complete/,
    );
  });

  it("forces the login prompt when retrying after an expired session", async () => {
    visit("?session_expired=1");
    const { findByRole } = render(AdminSignIn);
    await findByRole("alert");
    expect(auth0.loginWithRedirect).not.toHaveBeenCalled();
    await fireEvent.click(
      await findByRole("button", { name: "Sign in again" }),
    );
    await waitFor(() =>
      expect(auth0.loginWithRedirect).toHaveBeenCalledWith({
        authorizationParams: { prompt: "login" },
      }),
    );
  });

  it("reports a failed redirect callback", async () => {
    auth0.handleRedirectCallback.mockRejectedValue(new Error("bad state"));
    visit("?code=abc&state=xyz");
    const { findByRole } = render(AdminSignIn);
    expect((await findByRole("alert")).textContent).toMatch(
      /Sign-in didn't complete/,
    );
  });
});
