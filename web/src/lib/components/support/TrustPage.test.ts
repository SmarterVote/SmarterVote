import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import TrustPage from "./TrustPage.svelte";

describe("TrustPage", () => {
  it("renders the eyebrow and a timezone-stable last-updated date", () => {
    render(TrustPage, {
      title: "Privacy",
      description: "How we handle data.",
      path: "/privacy/",
      eyebrow: "Policy",
      updated: "2026-10-01",
    });
    expect(screen.getByText("Policy")).toBeTruthy();
    const time = screen.getByText("October 1, 2026");
    expect(time.getAttribute("datetime")).toBe("2026-10-01");
  });

  it("omits the eyebrow and date when not provided", () => {
    const { container } = render(TrustPage, {
      title: "About",
      description: "About us.",
      path: "/about/",
    });
    expect(container.querySelector(".eyebrow")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
  });
});
