import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import HomeSupportCallout from "./HomeSupportCallout.svelte";

afterEach(cleanup);

describe("HomeSupportCallout", () => {
  it("thanks readers and links to the support page", () => {
    render(HomeSupportCallout);
    const callout = screen.getByRole("complementary", { name: "Thank you" });
    expect(callout.textContent?.replace(/\s+/g, " ")).toContain(
      "Thank you to everyone who used Smarter.Vote this election season. " +
        "Next, we want to research the voting records and public stances of " +
        "officials now in office, and start early on 2028. If Smarter.Vote " +
        "helped you, please consider supporting that work.",
    );
    expect(
      screen
        .getByRole("link", { name: /Support Smarter\.Vote/ })
        .getAttribute("href"),
    ).toBe("/support/");
  });

  it("uses a label, not a heading, so it doesn't precede the page h1", () => {
    render(HomeSupportCallout);
    expect(screen.queryByRole("heading", { name: "Thank you" })).toBeNull();
  });
});
