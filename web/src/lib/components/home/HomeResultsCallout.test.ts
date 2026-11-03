import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeResultsCallout from "./HomeResultsCallout.svelte";

function respond(body: unknown, ok = true) {
  const fetchMock = vi.fn(
    async () => ({ ok, json: async () => body }) as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HomeResultsCallout", () => {
  it("is hidden before Election Day and does not fetch", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 2, 12), toFake: ["Date"] });
    const fetchMock = respond({ races: [] });
    render(HomeResultsCallout);
    expect(screen.queryByText("Election results")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links to results and shows the called count once loaded", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 3, 21), toFake: ["Date"] });
    respond({
      races: [
        { id: "a", status: "called" },
        { id: "b", status: "counting" },
        { id: "c", status: "certified" },
      ],
    });
    render(HomeResultsCallout);
    expect(screen.getByText("Election results")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /See results/ }).getAttribute("href"),
    ).toBe("/results/");
    expect(await screen.findByText(/2\s+races called/)).toBeTruthy();
  });

  it("omits the count when the live file fails", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 4), toFake: ["Date"] });
    const fetchMock = respond({}, false);
    render(HomeResultsCallout);
    expect(screen.getByText("Election results")).toBeTruthy();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/races? called/)).toBeNull();
  });
});
