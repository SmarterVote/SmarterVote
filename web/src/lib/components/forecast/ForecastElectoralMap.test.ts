import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForecastElectoralMap from "./ForecastElectoralMap.svelte";

// USMap (rendered inside this component) fetches state boundary topology on
// mount; stub it out with an empty-but-valid topology so it mounts cleanly
// without a real network call.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({
        type: "Topology",
        objects: { states: { type: "GeometryCollection", geometries: [] } },
        arcs: [],
      }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function baseProps() {
  return {
    activeStates: new Set<string>(),
    selectedState: null as string | null,
    stateRaceCounts: {},
    stateColors: {},
    stateTooltips: {},
    onStateClick: vi.fn(),
    onClearFilter: vi.fn(),
  };
}

describe("ForecastElectoralMap", () => {
  it("renders the map header and legend, including holdover swatches for non-house tabs", () => {
    render(ForecastElectoralMap, { activeTab: "senate", ...baseProps() });

    expect(screen.getByText("Electoral map")).toBeTruthy();
    expect(screen.getByText("Safe D")).toBeTruthy();
    expect(screen.getByText("Safe R")).toBeTruthy();
    expect(screen.getByText("Democratic holdover")).toBeTruthy();
    expect(screen.getByText("Republican holdover")).toBeTruthy();
    expect(screen.queryByText(/Clear Map Filter/)).toBeNull();
  });

  it("shows the mobile map by default and offers a hide control", async () => {
    render(ForecastElectoralMap, { activeTab: "house", ...baseProps() });

    const toggle = screen.getByRole("button", {
      name: "Hide interactive map",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Show interactive map" }),
    ).toBeTruthy();
  });

  it("omits holdover legend entries for the house tab", () => {
    render(ForecastElectoralMap, { activeTab: "house", ...baseProps() });

    // A state choropleth is not a district result map; the House view says so.
    expect(screen.getByText("House races by state")).toBeTruthy();
    expect(screen.getByText(/not a state result map/)).toBeTruthy();

    expect(screen.queryByText("Democratic holdover")).toBeNull();
    expect(screen.queryByText("Republican holdover")).toBeNull();
  });

  it("shows a clear-filter button for the selected state and calls onClearFilter", async () => {
    const props = baseProps();
    render(ForecastElectoralMap, {
      activeTab: "house",
      ...props,
      selectedState: "Texas",
    });

    const button = screen.getByRole("button", {
      name: /Clear map filter: Texas/,
    });
    await fireEvent.click(button);

    expect(props.onClearFilter).toHaveBeenCalledTimes(1);
  });

  it("offers active states in a mobile selector and updates the filter", async () => {
    const props = baseProps();
    render(ForecastElectoralMap, {
      activeTab: "house",
      ...props,
      activeStates: new Set(["Texas", "Delaware"]),
      stateRaceCounts: { Texas: 3, Delaware: 1 },
    });

    const select = screen.getByLabelText("Select a state");
    expect(screen.getByRole("option", { name: "Delaware (1)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Texas (3)" })).toBeTruthy();

    await fireEvent.change(select, { target: { value: "Delaware" } });
    expect(props.onStateClick).toHaveBeenCalledWith("Delaware");

    await fireEvent.change(select, { target: { value: "" } });
    expect(props.onClearFilter).toHaveBeenCalledTimes(1);
  });

  it("summarises a map selection next to the map and jumps to the results", async () => {
    const onViewResults = vi.fn();
    render(ForecastElectoralMap, {
      activeTab: "house",
      ...baseProps(),
      activeStates: new Set(["Georgia"]),
      selectedState: "Georgia",
      stateRaceCounts: { Georgia: 14 },
      onViewResults,
    });

    const summary = screen.getByTestId("map-selection-summary");
    expect(summary.textContent).toMatch(/14 races\s+in Georgia/);
    await fireEvent.click(screen.getByRole("button", { name: "View races" }));
    expect(onViewResults).toHaveBeenCalledTimes(1);
  });

  it("shows no selection summary without a selected state", () => {
    render(ForecastElectoralMap, { activeTab: "house", ...baseProps() });
    expect(screen.queryByTestId("map-selection-summary")).toBeNull();
  });
});
