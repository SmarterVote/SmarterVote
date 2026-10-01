import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ForecastUnavailable from "./ForecastUnavailable.svelte";

describe("ForecastUnavailable", () => {
  afterEach(cleanup);

  it("renders the empty-state message", () => {
    render(ForecastUnavailable);

    expect(screen.getByText("Forecast Data Unavailable")).toBeTruthy();
    expect(
      screen.getByText(/currently updating our election models/),
    ).toBeTruthy();
  });

  it("renders an error state when the data failed to load", () => {
    render(ForecastUnavailable, { loadError: true });
    expect(screen.getByText("Forecast data could not be loaded")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
