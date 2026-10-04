import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import PolicySection from "./PolicySection.svelte";

describe("PolicySection", () => {
  afterEach(cleanup);

  it("renders a top-level h2 section without an anchor by default", () => {
    const { container } = render(PolicySection, { title: "Refunds" });
    const heading = screen.getByRole("heading", { level: 2, name: "Refunds" });
    expect(heading.className).toContain("sm:text-xl");
    expect(container.querySelector("section")?.hasAttribute("id")).toBe(false);
  });

  it("renders a nested h3 with an anchor id", () => {
    const { container } = render(PolicySection, {
      title: "Card payments",
      level: 3,
      id: "card-payments",
    });
    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Card payments",
    });
    expect(heading.className).not.toContain("sm:text-xl");
    expect(container.querySelector("section")?.id).toBe("card-payments");
  });
});
