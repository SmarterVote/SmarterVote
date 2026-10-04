import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import EmptyState from "./EmptyState.svelte";

describe("EmptyState", () => {
  afterEach(cleanup);

  it("renders an h1 with the default browse and home actions", () => {
    render(EmptyState, { title: "Page not found" });
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Browse elections" })
        .getAttribute("href"),
    ).toBe("/elections/");
    expect(
      screen
        .getByRole("link", { name: "Go to home page" })
        .getAttribute("href"),
    ).toBe("/");
    expect(document.querySelector("p")).toBeNull();
  });

  it("supports an h2, body copy, custom primary action and no secondary", () => {
    render(EmptyState, {
      title: "Race not found",
      body: "We don't cover that race yet.",
      level: 2,
      primaryHref: "/forecast/",
      primaryLabel: "See the forecast",
      secondaryHref: null,
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "Race not found" }),
    ).toBeTruthy();
    expect(screen.getByText("We don't cover that race yet.")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen
        .getByRole("link", { name: "See the forecast" })
        .getAttribute("href"),
    ).toBe("/forecast/");
  });
});
