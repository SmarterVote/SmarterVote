import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
}));

vi.mock("$app/environment", () => ({
  browser: true,
  dev: false,
  building: false,
}));
vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
  replaceState: vi.fn(),
}));
vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");
  return {
    page: {
      subscribe: (fn: (value: unknown) => void) =>
        readable({
          params: {},
          url: new URL("https://smarter.vote/forecast/"),
          data: h.data,
        }).subscribe(fn),
    },
  };
});

function summary(id: string, election_date: string) {
  return {
    id,
    title: id,
    office: "U.S. Senate",
    jurisdiction: "GA",
    election_date,
    updated_utc: "2026-10-30T00:00:00Z",
    candidates: [],
  };
}

const COPY =
  /2026 election archive: final pre-election research and forecasts, no\s+longer updated\./;

vi.setConfig({ testTimeout: 30_000 });

describe("forecast page archive notice", () => {
  afterEach(cleanup);

  it("shows the notice for the 2026 cycle", async () => {
    h.data = {
      races: [summary("ga-senate-2026", "2026-11-03")],
      chamberForecasts: null,
    };
    const Page = (await import("./+page.svelte")).default;
    const page = render(Page, { props: { data: h.data as never } });
    expect(page.getByRole("note").textContent).toMatch(COPY);
  });

  it("omits it for a later cycle", async () => {
    h.data = {
      races: [summary("ga-senate-2028", "2028-11-07")],
      chamberForecasts: null,
    };
    const Page = (await import("./+page.svelte")).default;
    const page = render(Page, { props: { data: h.data as never } });
    expect(page.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(page.queryByText(/election archive/)).toBeNull();
  });
});
