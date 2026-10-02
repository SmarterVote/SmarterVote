import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ForecastProjectionSummary from "./ForecastProjectionSummary.svelte";

describe("ForecastProjectionSummary", () => {
  afterEach(cleanup);

  it("renders control label, seat totals, expected seats and net change", () => {
    render(ForecastProjectionSummary, {
      label: "Senate",
      controlParty: "Republican",
      threshold: 51,
      projectedSeats: { Democratic: 47, Republican: 53, Other: 0 },
      totalExpected: 100,
      expectedSeats: { Democratic: 46.5, Republican: 53.5 },
      netChange: { Democratic: -1, Republican: 1, Other: 0 },
    });

    expect(screen.getByText("Senate Projected Seats")).toBeTruthy();
    expect(screen.getByText("Republican Control")).toBeTruthy();
    expect(screen.getByText("51 seats needed for majority")).toBeTruthy();
    expect(screen.getByText("Democratic 47")).toBeTruthy();
    expect(screen.getByText("Republican 53")).toBeTruthy();
    expect(screen.getByText("Total: 100")).toBeTruthy();
    expect(screen.getByText(/Expected seats: D 46\.5, R 53\.5/)).toBeTruthy();
    expect(screen.getByText("+1 net")).toBeTruthy();
    expect(screen.getByText("-1 net")).toBeTruthy();
    // Control odds live in the summary card above; the sidebar no longer repeats them.
    expect(screen.queryByText("GOP control")).toBeNull();
  });

  it("shows 'No Clear Control' when the control party is Other", () => {
    render(ForecastProjectionSummary, {
      label: "Governors",
      controlParty: "Other",
      threshold: 26,
      projectedSeats: { Democratic: 25, Republican: 25, Other: 0 },
      totalExpected: 50,
      expectedSeats: undefined,
      netChange: { Democratic: 0, Republican: 0, Other: 0 },
    });

    expect(screen.getByText("No Clear Control")).toBeTruthy();
    expect(screen.queryByText(/Expected seats/)).toBeNull();
  });

  it("joins expected seats without a stray space before the Other comma", () => {
    render(ForecastProjectionSummary, {
      label: "House",
      controlParty: "Democratic",
      threshold: 218,
      projectedSeats: { Democratic: 228, Republican: 206, Other: 1 },
      totalExpected: 435,
      expectedSeats: { Democratic: 227.3, Republican: 206.7, Other: 1 },
      netChange: { Democratic: 3, Republican: -4, Other: 1 },
    });

    expect(
      screen.getByText("Expected seats: D 227.3, R 206.7, Other 1.0"),
    ).toBeTruthy();
  });
});
