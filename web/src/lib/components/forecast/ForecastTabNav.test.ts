import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForecastTabNav from "./ForecastTabNav.svelte";

const tabs = [
  { id: "house" as const, label: "House" },
  { id: "senate" as const, label: "Senate" },
  { id: "governors" as const, label: "Governors" },
];

describe("ForecastTabNav", () => {
  afterEach(cleanup);

  it("marks the active tab and calls onSelect on click", async () => {
    const onSelect = vi.fn();
    render(ForecastTabNav, {
      tabs,
      activeTab: "house",
      onSelect,
    });

    expect(screen.getByText("House").closest("button")?.className).toContain(
      "active",
    );
    expect(
      screen.getByRole("tab", { name: "House" }).getAttribute("aria-selected"),
    ).toBe("true");

    await fireEvent.click(screen.getByText("Senate"));

    expect(onSelect).toHaveBeenCalledWith("senate");
  });

  it("exposes tablist semantics with a roving tabindex", () => {
    render(ForecastTabNav, { tabs, activeTab: "senate", onSelect: vi.fn() });

    expect(
      screen.getByRole("tablist", { name: "Forecast chamber" }),
    ).toBeTruthy();
    const senate = screen.getByRole("tab", { name: "Senate" });
    const house = screen.getByRole("tab", { name: "House" });
    expect(senate.getAttribute("aria-selected")).toBe("true");
    expect(senate.getAttribute("tabindex")).toBe("0");
    expect(senate.getAttribute("aria-controls")).toBe("forecast-tabpanel");
    expect(house.getAttribute("aria-selected")).toBe("false");
    expect(house.getAttribute("tabindex")).toBe("-1");
  });

  it("moves between tabs with the arrow, Home and End keys", async () => {
    const onSelect = vi.fn();
    render(ForecastTabNav, { tabs, activeTab: "house", onSelect });
    const house = screen.getByRole("tab", { name: "House" });

    await fireEvent.keyDown(house, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("senate");
    await fireEvent.keyDown(house, { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("governors");
    await fireEvent.keyDown(house, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("governors");
    await fireEvent.keyDown(house, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith("house");
  });
});
