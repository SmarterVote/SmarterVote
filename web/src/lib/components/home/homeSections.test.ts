import { cleanup, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import HowItWorks from "./HowItWorks.svelte";
import TrustPrinciples from "./TrustPrinciples.svelte";

describe("homepage explainer sections", () => {
  afterEach(cleanup);

  it("HowItWorks lists the three numbered steps under its heading", () => {
    render(HowItWorks);
    const section = screen.getByRole("region", {
      name: "Three steps. Your conclusions.",
    });
    const steps = within(section).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.querySelector("h3")?.textContent)).toEqual([
      "Find",
      "Compare",
      "Inspect",
    ]);
    expect(steps[2].textContent).toContain("03");
  });

  it("TrustPrinciples shows three principles and links to the methodology", () => {
    render(TrustPrinciples);
    const section = screen.getByRole("region", {
      name: "Don't take our word for it.",
    });
    expect(within(section).getAllByRole("article")).toHaveLength(3);
    expect(within(section).getByText("No endorsements. Ever.")).toBeTruthy();
    expect(
      within(section)
        .getByRole("link", { name: /Examine our methodology/ })
        .getAttribute("href"),
    ).toBe("/about/#methodology");
  });
});
