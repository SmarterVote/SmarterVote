import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ForecastControlBar from "./ForecastControlBar.svelte";

describe("ForecastControlBar", () => {
  afterEach(cleanup);

  it("renders the tie callout when a Senate 50-50 tie is not already the projection", () => {
    render(ForecastControlBar, {
      activeTab: "senate",
      outcomeProbabilities: {
        Democratic: 0.3,
        Republican: 0.6,
        tie_50_50: 0.1,
      },
      projectedSeats: { Democratic: 47, Republican: 53, Other: 0 },
      vpTiebreakParty: "Republican",
    });

    expect(screen.getByText("50-50 tie: 10.0%")).toBeTruthy();
    expect(screen.getByText(/Democratic 30.0%/)).toBeTruthy();
    expect(screen.getByText(/Republican 60.0%/)).toBeTruthy();
    expect(
      screen.getByText(
        /counts toward the party of the vice president, who breaks the tie, so it is included in the Republican share above/,
      ),
    ).toBeTruthy();
    // Neutral wording: the note never calls either party's share an "advantage".
    expect(document.body.textContent).not.toMatch(/advantage/i);
  });

  it("names the Democratic share when the vice president is a Democrat", () => {
    render(ForecastControlBar, {
      activeTab: "senate",
      outcomeProbabilities: {
        Democratic: 0.6,
        Republican: 0.4,
        tie_50_50: 0.1,
      },
      projectedSeats: { Democratic: 51, Republican: 49, Other: 0 },
      vpTiebreakParty: "Democratic",
    });

    expect(
      screen.getByText(/so it is included in the Democratic share above/),
    ).toBeTruthy();
  });

  it("does not assume a party when the tie-break party is unknown", () => {
    render(ForecastControlBar, {
      activeTab: "senate",
      outcomeProbabilities: {
        Democratic: 0.6,
        Republican: 0.4,
        tie_50_50: 0.1,
      },
      projectedSeats: { Democratic: 51, Republican: 49, Other: 0 },
    });

    expect(
      screen.getByText(/included in the vice president's party's share/),
    ).toBeTruthy();
    expect(screen.queryByText(/Republican share above/)).toBeNull();
  });

  it("omits the tie callout once the projection is already a 50-50 split", () => {
    render(ForecastControlBar, {
      activeTab: "senate",
      outcomeProbabilities: {
        Democratic: 0.45,
        Republican: 0.45,
        tie_50_50: 0.1,
      },
      projectedSeats: { Democratic: 50, Republican: 50, Other: 0 },
    });

    expect(screen.queryByText(/counts toward the party/)).toBeNull();
  });

  it("uses the chamber label for governors and skips rendering when no data is available", () => {
    const { container } = render(ForecastControlBar, {
      activeTab: "governors",
      outcomeProbabilities: undefined,
      projectedSeats: { Democratic: 24, Republican: 26, Other: 0 },
    });

    expect(screen.getByText("Control Probabilities")).toBeTruthy();
    expect(container.querySelector("[role=img]")).toBeNull();
  });
});
