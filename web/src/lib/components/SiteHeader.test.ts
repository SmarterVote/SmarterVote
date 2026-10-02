import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceSummary } from "$lib/types";
import SiteHeader from "./SiteHeader.svelte";

const {
  goto,
  replaceState,
  afterNavigateCallbacks,
  getRaceSummaries,
  pageControl,
} = vi.hoisted(() => ({
  goto: vi.fn(),
  replaceState: vi.fn(),
  afterNavigateCallbacks: [] as Array<(nav: { to: { url: URL } }) => void>,
  getRaceSummaries: vi.fn(),
  // Filled in by the $app/stores factory below so tests can drive the route.
  pageControl: { setUrl: (_: string) => {} },
}));

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$app/navigation", () => ({
  goto,
  replaceState,
  afterNavigate: (cb: (nav: { to: { url: URL } }) => void) =>
    afterNavigateCallbacks.push(cb),
}));
vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");
  const store = writable({ url: new URL("https://smarter.vote/elections/") });
  pageControl.setUrl = (href: string) => store.set({ url: new URL(href) });
  return { page: store };
});
// The header loads the compact search index; build it from the mocked
// summaries so these tests keep exercising the "first search loads data" path.
vi.mock("$lib/api", async () => {
  const { buildSearchIndex } = await import("$lib/utils/searchIndex");
  return {
    getSearchIndex: async () => buildSearchIndex(await getRaceSummaries()),
  };
});

/**
 * On "/" the header adopts the URL's `?q=` only on real navigations
 * (`afterNavigate`); its own writes go through shallow `replaceState` so they
 * never echo back into the box. `navigateTo` stands in for a real navigation:
 * it moves the page store and fires the afterNavigate callbacks.
 */
const NON_HOME_ROUTE = "https://smarter.vote/elections/";

function navigateTo(href: string) {
  pageControl.setUrl(href);
  for (const cb of afterNavigateCallbacks) cb({ to: { url: new URL(href) } });
}

// jsdom has no ResizeObserver, and onMount observes the header for height.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function race(overrides: Partial<RaceSummary> = {}): RaceSummary {
  return {
    id: "mo-senate-2024",
    title: "2024 Missouri U.S. Senate Election",
    office: "U.S. Senate",
    state: "Missouri",
    jurisdiction: "Missouri",
    election_date: "2024-11-05",
    updated_utc: "2024-06-01T12:00:00Z",
    candidates: [{ name: "Jane Doe", party: "Democratic", incumbent: false }],
    ...overrides,
  } as RaceSummary;
}

function renderHeader(props: Record<string, unknown> = {}) {
  return render(SiteHeader, {
    races: [race()],
    isAuthenticated: false,
    darkMode: false,
    onToggleDark: vi.fn(),
    ...props,
  });
}

function searchBox(container: HTMLElement): HTMLInputElement {
  return container.querySelector("#site-search") as HTMLInputElement;
}

async function type(input: HTMLInputElement, value: string) {
  await fireEvent.input(input, { target: { value } });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  pageControl.setUrl(NON_HOME_ROUTE);
  afterNavigateCallbacks.length = 0;
  goto.mockReset();
  replaceState.mockReset();
  getRaceSummaries.mockReset();
  getRaceSummaries.mockResolvedValue([race()]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SiteHeader search matching", () => {
  it("shows no results panel until something is typed", () => {
    const { container } = renderHeader();

    expect(container.querySelector("#site-search-results")).toBeNull();
  });

  it("matches a race by title", async () => {
    const { container } = renderHeader();

    await type(searchBox(container), "Missouri");

    await waitFor(() =>
      expect(container.textContent).toContain("Missouri U.S. Senate"),
    );
  });

  it("matches a candidate by name", async () => {
    const { container } = renderHeader();

    await type(searchBox(container), "Jane");

    await waitFor(() => expect(container.textContent).toContain("Jane Doe"));
  });

  it("caps race results at five", async () => {
    const races = Array.from({ length: 9 }, (_, i) =>
      race({
        id: `race-${i}`,
        title: `Senate Race ${i}`,
        candidates: [],
      }),
    );
    const { container } = renderHeader({ races });

    await type(searchBox(container), "Senate");

    await waitFor(() => {
      const links = Array.from(container.querySelectorAll("li, button")).filter(
        (el) => el.textContent?.includes("Senate Race"),
      );
      expect(links.length).toBeLessThanOrEqual(5);
    });
  });

  it("finds nothing for a query that matches no race or candidate", async () => {
    const { container } = renderHeader();

    await type(searchBox(container), "zzzzz-no-match");

    await waitFor(() => {
      expect(container.textContent).not.toContain("Jane Doe");
    });
  });
});

describe("SiteHeader navigation", () => {
  it("navigates to a race when its result is chosen", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);

    await type(input, "Missouri");
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/races/mo-senate-2024/");
  });

  it("slugifies a candidate name into the profile url", async () => {
    const { container } = renderHeader({
      races: [
        race({
          title: "No Match Here",
          office: "",
          state: "",
          jurisdiction: "",
          candidates: [
            { name: "Jane Q. Doe", party: "Democratic", incumbent: false },
          ],
        }),
      ],
    });
    const input = searchBox(container);

    await type(input, "Jane");
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/races/mo-senate-2024/jane-q-doe/");
  });

  it("falls back to the elections page when nothing is highlighted", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);

    await type(input, "Missouri");
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/elections/?q=Missouri");
  });

  it("url-encodes the fallback query", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);

    await type(input, "a & b");
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/elections/?q=a%20%26%20b");
  });

  it("does not navigate on Enter with an empty query", async () => {
    const { container } = renderHeader();

    await fireEvent.keyDown(searchBox(container), { key: "Enter" });

    expect(goto).not.toHaveBeenCalled();
  });
});

describe("SiteHeader keyboard navigation", () => {
  it("wraps around the end of the result list", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);
    await type(input, "Missouri");

    // One race + one candidate = two results; three downs wraps to the first.
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/races/mo-senate-2024/");
  });

  // NOTE: with nothing highlighted (activeIndex === -1), ArrowUp computes
  // (-1 - 1 + total) % total, which lands on the FIRST result, not the last.
  // Conventional combobox behaviour would wrap to the last item. Pinned as-is
  // rather than "fixed" here — it is a deliberate-looking formula and changing
  // it is a UX decision, not a test concern.
  it("selects the first result when ArrowUp is pressed with nothing highlighted", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);
    await type(input, "Missouri");

    await fireEvent.keyDown(input, { key: "ArrowUp" });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/races/mo-senate-2024/");
  });

  it("steps backwards through results once one is highlighted", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);
    await type(input, "Missouri");

    // Down to the race (0), down to the candidate (1), up back to the race (0).
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowUp" });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/races/mo-senate-2024/");
  });

  it("closes the panel on Escape", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);

    await type(input, "Missouri");
    await waitFor(() =>
      expect(container.querySelector("#site-search-results")).not.toBeNull(),
    );

    await fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() =>
      expect(container.querySelector("#site-search-results")).toBeNull(),
    );
  });

  it("ignores arrow keys when there are no matches", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);

    await type(input, "zzzzz-no-match");
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });

    // Falls through to the elections fallback rather than selecting nothing.
    expect(goto).toHaveBeenCalledWith("/elections/?q=zzzzz-no-match");
  });
});

describe("SiteHeader lazy race loading", () => {
  it("does not fetch summaries when races were supplied", async () => {
    const { container } = renderHeader({ races: [race()] });

    await type(searchBox(container), "Missouri");

    expect(getRaceSummaries).not.toHaveBeenCalled();
  });

  it("fetches summaries on first search when none were supplied", async () => {
    const { container } = renderHeader({ races: [] });

    await type(searchBox(container), "Missouri");

    await waitFor(() => expect(getRaceSummaries).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(container.textContent).toContain("Missouri U.S. Senate"),
    );
  });

  it("fetches only once across repeated searches", async () => {
    const { container } = renderHeader({ races: [] });
    const input = searchBox(container);

    await type(input, "Mis");
    await waitFor(() => expect(getRaceSummaries).toHaveBeenCalledTimes(1));
    await type(input, "Missouri");
    await type(input, "Missouri S");

    expect(getRaceSummaries).toHaveBeenCalledTimes(1);
  });

  // A failed summaries fetch must leave the header usable rather than throwing.
  it("survives a failed summaries fetch", async () => {
    getRaceSummaries.mockRejectedValue(new Error("offline"));
    const { container } = renderHeader({ races: [] });

    await type(searchBox(container), "Missouri");

    await waitFor(() => expect(getRaceSummaries).toHaveBeenCalled());
    expect(searchBox(container)).not.toBeNull();
  });
});

describe("SiteHeader homepage query sync", () => {
  const HOME = "https://smarter.vote/";

  function renderAt(href: string, props: Record<string, unknown> = {}) {
    pageControl.setUrl(href);
    const result = renderHeader(props);
    navigateTo(href);
    return result;
  }

  it("seeds the search box from ?q= on the homepage", async () => {
    const { container } = renderAt(`${HOME}?q=Missouri`);

    await waitFor(() => expect(searchBox(container).value).toBe("Missouri"));
  });

  it("loads summaries when arriving with a query already in the url", async () => {
    renderAt(`${HOME}?q=Missouri`, { races: [] });

    await waitFor(() => expect(getRaceSummaries).toHaveBeenCalled());
  });

  it("does not seed the box from ?q= away from the homepage", async () => {
    const { container } = renderAt(
      "https://smarter.vote/elections/?q=Missouri",
    );

    expect(searchBox(container).value).toBe("");
  });

  it("writes the typed query into the homepage url shallowly", async () => {
    vi.useFakeTimers();
    const { container } = renderAt(HOME);

    await fireEvent.input(searchBox(container), {
      target: { value: "Missouri" },
    });
    await vi.advanceTimersByTimeAsync(400);

    expect(goto).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledTimes(1);
    const url = replaceState.mock.calls[0][0] as URL;
    expect(url.searchParams.get("q")).toBe("Missouri");
  });

  // Regression: a URL write that landed after further typing used to copy the
  // stale query back into the box, swallowing the newer keystrokes.
  it("never overwrites characters typed after a url write", async () => {
    vi.useFakeTimers();
    const { container } = renderAt(HOME);
    const input = searchBox(container);

    await fireEvent.input(input, { target: { value: "Miss" } });
    await vi.advanceTimersByTimeAsync(400);
    await fireEvent.input(input, { target: { value: "Missouri" } });
    await vi.advanceTimersByTimeAsync(400);

    expect(input.value).toBe("Missouri");
  });

  it("offers a clear button only while there is a query", async () => {
    const { container } = renderAt(HOME);
    expect(container.querySelector('[aria-label="Clear search"]')).toBeNull();
    cleanup();
    afterNavigateCallbacks.length = 0;

    const seeded = renderAt(`${HOME}?q=Missouri`);

    await waitFor(() =>
      expect(
        seeded.container.querySelector('[aria-label="Clear search"]'),
      ).not.toBeNull(),
    );
  });

  it("drops the q parameter when the search is cleared", async () => {
    const { container } = renderAt(`${HOME}?q=Missouri`);

    const clear = await waitFor(() => {
      const el = container.querySelector('[aria-label="Clear search"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    await fireEvent.click(clear);

    await waitFor(() => expect(searchBox(container).value).toBe(""));
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    const url = replaceState.mock.lastCall![0] as URL;
    expect(url.searchParams.has("q")).toBe(false);
  });
});

describe("SiteHeader global shortcuts", () => {
  it("opens search when '/' is pressed outside a text field", async () => {
    const { container } = renderHeader();

    await fireEvent.keyDown(window, { key: "/" });

    await waitFor(() =>
      expect(document.activeElement).toBe(searchBox(container)),
    );
  });

  it("ignores '/' while typing in the search box", async () => {
    const { container } = renderHeader();
    const input = searchBox(container);
    input.focus();

    await fireEvent.keyDown(window, { key: "/" });

    // Still focused, but the shortcut must not have hijacked the keystroke.
    expect(document.activeElement).toBe(input);
  });

  it("closes overlays on Escape", async () => {
    const { container } = renderHeader();

    await fireEvent.keyDown(window, { key: "/" });
    await fireEvent.keyDown(window, { key: "Escape" });

    expect(container.querySelector("#site-search-results")).toBeNull();
  });

  it("closes the results panel on an outside click", async () => {
    const { container } = renderHeader();

    await type(searchBox(container), "Missouri");
    await waitFor(() =>
      expect(container.querySelector("#site-search-results")).not.toBeNull(),
    );

    await fireEvent.click(document.body);

    await waitFor(() =>
      expect(container.querySelector("#site-search-results")).toBeNull(),
    );
  });

  it("closes the results and mobile search when Enter falls back to the directory", async () => {
    const { container, getByRole } = renderHeader();
    await fireEvent.click(getByRole("button", { name: "Open search" }));
    const input = searchBox(container);
    await type(input, "Missouri");
    await waitFor(() =>
      expect(container.querySelector("#site-search-results")).not.toBeNull(),
    );

    await fireEvent.keyDown(input, { key: "Enter" });

    expect(goto).toHaveBeenCalledWith("/elections/?q=Missouri");
    await waitFor(() =>
      expect(container.querySelector("#site-search-results")).toBeNull(),
    );
    expect(
      getByRole("button", { name: "Open search" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
  });

  it("returns focus to the search toggle when Escape closes the mobile panel", async () => {
    const { container, getByRole } = renderHeader();
    const toggle = getByRole("button", { name: "Open search" });
    await fireEvent.click(toggle);
    const input = searchBox(container);
    input.focus();

    await fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });

  it("groups results under labelled listbox groups", async () => {
    const { container } = renderHeader();
    await type(searchBox(container), "Missouri");
    await waitFor(() =>
      expect(container.querySelector("#site-search-results")).not.toBeNull(),
    );
    const groups = container.querySelectorAll(
      '#site-search-results [role="group"]',
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const labelId = group.getAttribute("aria-labelledby");
      expect(labelId && document.getElementById(labelId)).toBeTruthy();
    }
    expect(container.querySelector("#site-search-results > p")).toBeNull();
  });

  it("announces search status through one persistent live region", async () => {
    const { container } = renderHeader();
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    await type(searchBox(container), "zzzz-no-match");
    await waitFor(() =>
      expect(status?.textContent).toContain(
        "No matching elections or candidates.",
      ),
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("marks the current section's nav link with aria-current", () => {
    const { getByRole } = renderHeader();
    expect(
      getByRole("link", { name: "Elections" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      getByRole("link", { name: "Forecast" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("closes the mobile menu after a navigation", async () => {
    const { getByRole } = renderHeader();
    await fireEvent.click(
      getByRole("button", { name: "Open navigation menu" }),
    );
    navigateTo("https://smarter.vote/forecast/");
    await waitFor(() =>
      expect(
        getByRole("button", { name: "Open navigation menu" }).getAttribute(
          "aria-expanded",
        ),
      ).toBe("false"),
    );
  });
});

describe("SiteHeader result options", () => {
  it("ends the results with a 'See all' option linking to the directory", async () => {
    const { container, getByRole } = renderHeader();
    await type(searchBox(container), "Missouri");

    const seeAll = await waitFor(() =>
      getByRole("option", { name: /See all 1 result/ }),
    );
    await fireEvent.click(seeAll);

    expect(goto).toHaveBeenCalledWith("/elections/?q=Missouri");
  });

  it("offers browse and address links when nothing matches", async () => {
    const { container, getByRole } = renderHeader();
    await type(searchBox(container), "zzzz-no-match");

    await waitFor(() =>
      expect(
        getByRole("link", { name: "Browse all elections" }).getAttribute(
          "href",
        ),
      ).toBe("/elections/"),
    );
    expect(
      getByRole("link", { name: "Find races by address" }).getAttribute("href"),
    ).toBe("/my-ballot/");
  });

  it("ranks a state's Senate race ahead of its House seats", async () => {
    const races = [
      ...Array.from({ length: 8 }, (_, i) =>
        race({
          id: `tx-house-${String(i + 1).padStart(2, "0")}-2026`,
          title: `Texas House ${i + 1}`,
          office: "U.S. House",
          state: "Texas",
          jurisdiction: "Texas",
          candidates: [],
        }),
      ),
      race({
        id: "tx-senate-2026",
        title: "2026 Texas U.S. Senate Election",
        office: "U.S. Senate",
        state: "Texas",
        jurisdiction: "Texas",
        candidates: [],
      }),
    ];
    const { container } = renderHeader({ races });
    await type(searchBox(container), "Texas");

    await waitFor(() =>
      expect(
        container.querySelector("#site-search-option-0")?.textContent,
      ).toContain("Texas U.S. Senate"),
    );
  });
});
