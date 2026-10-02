import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression: a failing `?draft=true` fetch used to fall back with a shallow
// `replaceState()`, which leaves `$page.url` unchanged, so the reactive load
// guard refetched the draft in a tight loop (~80 requests/second).

const h = vi.hoisted(() => ({
  getRace: vi.fn(),
  getDraftRace: vi.fn(),
  goto: vi.fn(),
  url: "https://smarter.vote/races/x-race/?draft=true",
  params: { slug: "x-race" } as Record<string, string>,
}));

vi.mock("$app/environment", () => ({
  browser: true,
  dev: false,
  building: false,
}));
vi.mock("$app/navigation", () => ({
  goto: h.goto,
  replaceState: vi.fn(),
}));
vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");
  return {
    page: {
      // The URL never changes here, exactly like a shallow replaceState.
      subscribe: (fn: (value: unknown) => void) =>
        readable({ params: h.params, url: new URL(h.url) }).subscribe(fn),
    },
  };
});
vi.mock("$lib/api", () => ({
  getRace: h.getRace,
  getDraftRace: h.getDraftRace,
}));

const race = {
  id: "x-race",
  title: "X Race",
  office: "Senate",
  jurisdiction: "GA",
  election_date: "2026-11-03",
  updated_utc: "2026-09-01T00:00:00Z",
  candidates: [
    { name: "Jane Doe", party: "Democratic", issues: {} },
    { name: "John Roe", party: "Republican", issues: {} },
  ],
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("draft preview fallback", () => {
  beforeEach(() => {
    h.getRace.mockReset();
    h.getDraftRace.mockReset();
    h.goto.mockReset();
    h.goto.mockResolvedValue(undefined);
    let calls = 0;
    h.getDraftRace.mockImplementation(() => {
      calls += 1;
      // Stop a runaway loop from hanging the test runner.
      if (calls > 50) return new Promise(() => undefined);
      return Promise.reject(new Error("401 Unauthorized"));
    });
    h.getRace.mockResolvedValue(race);
  });
  afterEach(cleanup);

  it("race page requests the draft once and drops ?draft=true", async () => {
    h.url = "https://smarter.vote/races/x-race/?draft=true";
    h.params = { slug: "x-race" };
    const Page = (await import("./+page.svelte")).default;
    render(Page, { props: { data: { prerenderedRace: null } } });
    await settle();
    expect(h.getDraftRace).toHaveBeenCalledTimes(1);
    expect(h.getRace.mock.calls.length).toBeLessThanOrEqual(2);
    expect(h.goto).toHaveBeenCalledWith(
      "/races/x-race/",
      expect.objectContaining({ replaceState: true }),
    );
  });

  it("candidate page requests the draft once and drops ?draft=true", async () => {
    h.url = "https://smarter.vote/races/x-race/jane-doe/?draft=true";
    h.params = { slug: "x-race", candidate: "jane-doe" };
    const Page = (await import("./[candidate]/+page.svelte")).default;
    render(Page, { props: { data: { prerenderedRace: null } } });
    await settle();
    expect(h.getDraftRace).toHaveBeenCalledTimes(1);
    expect(h.getRace.mock.calls.length).toBeLessThanOrEqual(2);
    expect(h.goto).toHaveBeenCalledWith(
      "/races/x-race/jane-doe/",
      expect.objectContaining({ replaceState: true }),
    );
  });

  it("compare page requests the draft once", async () => {
    h.url =
      "https://smarter.vote/races/x-race/compare/?candidates=jane-doe,john-roe&draft=true";
    h.params = { slug: "x-race" };
    const Page = (await import("./compare/+page.svelte")).default;
    render(Page, { props: { data: { prerenderedRace: null } } });
    await settle();
    expect(h.getDraftRace).toHaveBeenCalledTimes(1);
  });
});

describe("duplicate roster entries", () => {
  // A duplicated candidate used to crash the page in production with Svelte's
  // each_key_duplicate error, because every list was keyed by slug alone.
  const duplicated = {
    ...race,
    candidates: [
      { name: "Jane Doe", party: "Democratic", issues: {} },
      { name: "Jane Doe", party: "Democratic", issues: {} },
      { name: "José Peña", party: "Independent", issues: {} },
      { name: "Jose Pena", party: "Independent", issues: {} },
      { name: "John Roe", party: "Republican", issues: {} },
    ],
  };

  beforeEach(() => {
    h.getRace.mockReset();
    h.getDraftRace.mockReset();
    h.getRace.mockResolvedValue(duplicated);
  });
  afterEach(cleanup);

  it("race page renders each candidate once", async () => {
    h.url = "https://smarter.vote/races/x-race/";
    h.params = { slug: "x-race" };
    const Page = (await import("./+page.svelte")).default;
    const { getAllByRole } = render(Page, {
      props: { data: { prerenderedRace: duplicated as never } },
    });
    await settle();
    const names = getAllByRole("heading", { level: 3 }).map(
      (heading) => heading.textContent?.trim() ?? "",
    );
    expect(names.filter((name) => name === "Jane Doe")).toHaveLength(1);
    // Distinct names that share a slug both render.
    expect(names).toContain("José Peña");
    expect(names).toContain("Jose Pena");
  });

  it("candidate and compare pages render with colliding slugs", async () => {
    h.url = "https://smarter.vote/races/x-race/jane-doe/";
    h.params = { slug: "x-race", candidate: "jane-doe" };
    const CandidatePage = (await import("./[candidate]/+page.svelte")).default;
    const candidate = render(CandidatePage, {
      props: { data: { prerenderedRace: duplicated as never } },
    });
    await settle();
    expect(
      candidate.getAllByRole("heading", { name: "Jane Doe" }),
    ).toHaveLength(1);
    candidate.unmount();

    h.url =
      "https://smarter.vote/races/x-race/compare/?candidates=jane-doe,jose-pena";
    h.params = { slug: "x-race" };
    const ComparePage = (await import("./compare/+page.svelte")).default;
    const compare = render(ComparePage, {
      props: { data: { prerenderedRace: duplicated as never } },
    });
    await settle();
    expect(compare.getAllByRole("checkbox").length).toBe(4);
  });
});
