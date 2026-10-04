import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceSummary } from "$lib/types";
import ElectionDirectory from "./ElectionDirectory.svelte";

const { replaceState, afterNavigateCallbacks, pageControl } = vi.hoisted(
  () => ({
    replaceState: vi.fn(),
    afterNavigateCallbacks: [] as Array<(nav: { to: { url: URL } }) => void>,
    pageControl: { setUrl: (_: string) => {} },
  }),
);

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$app/navigation", () => ({
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

const ROUTE = "https://smarter.vote/elections/";

/** Stand-in for a real navigation: move the page store, fire afterNavigate. */
function navigateTo(href: string) {
  pageControl.setUrl(href);
  for (const cb of afterNavigateCallbacks) cb({ to: { url: new URL(href) } });
}

/**
 * The embedded USMap fetches the bundled us-atlas states-10m.json asset in onMount with no try/catch, so
 * an unstubbed fetch produces an unhandled rejection that has nothing to do
 * with the directory. An empty-but-valid topology lets the map mount and settle
 * without drawing anything.
 */
const EMPTY_TOPOLOGY = {
  type: "Topology",
  objects: { states: { type: "GeometryCollection", geometries: [] } },
  arcs: [],
};

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

function renderDirectory(races: RaceSummary[] = [race()]) {
  return render(ElectionDirectory, { races });
}

function searchBox(container: HTMLElement): HTMLInputElement {
  return container.querySelector(
    'input[placeholder^="Search by candidate name"]',
  ) as HTMLInputElement;
}

function cards(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll(
    '#election-results-grid a[href^="/races/"]',
  );
}

function officeChip(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
}

beforeEach(() => {
  pageControl.setUrl(ROUTE);
  afterNavigateCallbacks.length = 0;
  replaceState.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(EMPTY_TOPOLOGY),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ElectionDirectory rendering", () => {
  it("gives the search field a durable accessible label", () => {
    renderDirectory();

    expect(
      document.querySelector('label[for="election-directory-search"]')
        ?.textContent,
    ).toContain("Search elections and candidates");
  });

  it("renders a card per race", async () => {
    const { container } = renderDirectory([
      race({ id: "a", title: "Race A" }),
      race({ id: "b", title: "Race B" }),
    ]);

    await waitFor(() => expect(cards(container)).toHaveLength(2));
  });

  it("renders nothing in the grid when there are no races", async () => {
    const { container } = renderDirectory([]);

    await waitFor(() => expect(cards(container)).toHaveLength(0));
  });

  it("sorts races by state and title", async () => {
    const { container } = renderDirectory([
      race({ id: "ak", title: "Alaska Senate", state: "Alaska" }),
      race({ id: "al", title: "Alabama Senate", state: "Alabama" }),
    ]);

    await waitFor(() => expect(cards(container)).toHaveLength(2));
    expect(cards(container)[0].getAttribute("href")).toBe("/races/al/");
    expect(cards(container)[1].getAttribute("href")).toBe("/races/ak/");
  });

  it("keeps the mobile map collapsed until requested", async () => {
    const { getByRole } = renderDirectory();
    const toggle = getByRole("button", { name: "Show interactive map" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.click(toggle);
    expect(
      getByRole("button", { name: "Hide interactive map" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });

  it("does not mount the map (or fetch its topology) on a narrow screen until requested", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { getByRole, container } = renderDirectory();

    await waitFor(() => expect(cards(container)).toHaveLength(1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector(".map-container")).toBeNull();

    await fireEvent.click(
      getByRole("button", { name: "Show interactive map" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("states-10m.json"),
      ),
    );
  });

  // PAGE_SIZE is 24; anything beyond that waits for the load-more control.
  it("shows at most one page of races initially", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      race({ id: `race-${i}`, title: `Race ${i}` }),
    );
    const { container } = renderDirectory(many);

    await waitFor(() => expect(cards(container)).toHaveLength(24));
  });
});

describe("ElectionDirectory office filtering", () => {
  const mixed = [
    race({ id: "s", title: "Senate Race", office: "U.S. Senate" }),
    race({
      id: "h",
      title: "House Race",
      office: "U.S. House of Representatives",
    }),
    race({ id: "g", title: "Governor Race", office: "Governor of Missouri" }),
    race({ id: "o", title: "Coroner Race", office: "County Coroner" }),
  ];

  it("offers a chip per distinct office type", async () => {
    const { container } = renderDirectory(mixed);

    await waitFor(() => {
      expect(officeChip(container, "Senate")).toBeTruthy();
      expect(officeChip(container, "House")).toBeTruthy();
      expect(officeChip(container, "Governor")).toBeTruthy();
      expect(officeChip(container, "Other")).toBeTruthy();
    });
  });

  it("narrows the grid to the chosen office", async () => {
    const { container } = renderDirectory(mixed);

    await waitFor(() => expect(officeChip(container, "Senate")).toBeTruthy());
    const senate = officeChip(container, "Senate")!;
    expect(senate.getAttribute("aria-pressed")).toBe("false");
    await fireEvent.click(senate);

    await waitFor(() => expect(cards(container)).toHaveLength(1));
    expect(senate.getAttribute("aria-pressed")).toBe("true");
    // RaceCard renders a derived title, not race.title, so assert on the id.
    expect(cards(container)[0].getAttribute("href")).toBe("/races/s/");
  });

  it("buckets an unrecognised office under Other", async () => {
    const { container } = renderDirectory(mixed);

    await waitFor(() => expect(officeChip(container, "Other")).toBeTruthy());
    await fireEvent.click(officeChip(container, "Other")!);

    await waitFor(() => expect(cards(container)).toHaveLength(1));
    expect(cards(container)[0].getAttribute("href")).toBe("/races/o/");
  });
});

describe("ElectionDirectory search", () => {
  const searchable = [
    race({
      id: "mo",
      title: "Missouri Senate",
      jurisdiction: "Missouri",
      candidates: [{ name: "Jane Doe", party: "Democratic", incumbent: false }],
    }),
    race({
      id: "ks",
      title: "Kansas House",
      office: "U.S. House",
      state: "Kansas",
      jurisdiction: "Kansas",
      candidates: [{ name: "Bob Roe", party: "Republican", incumbent: true }],
    }),
  ];

  it("filters by candidate name", async () => {
    const { container } = renderDirectory(searchable);

    await fireEvent.input(searchBox(container), { target: { value: "Jane" } });

    await waitFor(() => expect(cards(container)).toHaveLength(1), {
      timeout: 2000,
    });
    expect(cards(container)[0].getAttribute("href")).toBe("/races/mo/");
  });

  it("filters by party", async () => {
    const { container } = renderDirectory(searchable);

    await fireEvent.input(searchBox(container), {
      target: { value: "Republican" },
    });

    await waitFor(() => expect(cards(container)).toHaveLength(1), {
      timeout: 2000,
    });
    expect(cards(container)[0].getAttribute("href")).toBe("/races/ks/");
  });

  it("filters by title", async () => {
    const { container } = renderDirectory(searchable);

    await fireEvent.input(searchBox(container), {
      target: { value: "Kansas" },
    });

    await waitFor(() => expect(cards(container)).toHaveLength(1), {
      timeout: 2000,
    });
  });

  it("seeds the box from ?q= in the url", async () => {
    const { container } = renderDirectory(searchable);
    navigateTo(`${ROUTE}?q=Kansas`);

    await waitFor(() => expect(searchBox(container).value).toBe("Kansas"));
    await waitFor(() => expect(cards(container)).toHaveLength(1));
  });

  it("writes the query into the url shallowly, without a navigation", async () => {
    const { container } = renderDirectory(searchable);

    await fireEvent.input(searchBox(container), { target: { value: "Jane" } });

    await waitFor(() => expect(replaceState).toHaveBeenCalled(), {
      timeout: 2000,
    });
    const url = replaceState.mock.lastCall![0] as URL;
    expect(url.searchParams.get("q")).toBe("Jane");
  });

  // Regression: a URL write that landed after further typing used to copy the
  // stale query back into the box, swallowing the newer keystrokes.
  it("never overwrites characters typed after a url write", async () => {
    const { container } = renderDirectory(searchable);
    const input = searchBox(container);

    await fireEvent.input(input, { target: { value: "Ja" } });
    await waitFor(() => expect(replaceState).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    await fireEvent.input(input, { target: { value: "Jane" } });
    await waitFor(() => expect(replaceState).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });

    expect(input.value).toBe("Jane");
  });

  it("matches state abbreviations and out-of-order terms", async () => {
    const { container } = renderDirectory(searchable);

    await fireEvent.input(searchBox(container), {
      target: { value: "doe mo" },
    });

    await waitFor(() => expect(cards(container)).toHaveLength(1), {
      timeout: 2000,
    });
    expect(cards(container)[0].getAttribute("href")).toBe("/races/mo/");
  });

  it("clears the query and drops it from the url", async () => {
    const { container } = renderDirectory(searchable);
    navigateTo(`${ROUTE}?q=Kansas`);

    const clear = await waitFor(() => {
      const el = container.querySelector('[aria-label="Clear search query"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    await fireEvent.click(clear);

    await waitFor(() => expect(searchBox(container).value).toBe(""));
    await waitFor(() => expect(cards(container)).toHaveLength(2));
  });

  it("matches case-insensitively", async () => {
    const { container } = renderDirectory(searchable);

    await fireEvent.input(searchBox(container), { target: { value: "jane" } });

    await waitFor(() => expect(cards(container)).toHaveLength(1), {
      timeout: 2000,
    });
  });
});

/**
 * USMap raises `stateClick` through createEventDispatcher, which Svelte 5 makes
 * unobservable from a direct render (component.$on is gone). These tests cover
 * the dispatch end-to-end instead: a real topology so the map draws clickable
 * paths, then a click, then the resulting filter change in the grid.
 *
 * ids are FIPS codes — 29 = Missouri, 20 = Kansas.
 */
const REAL_TOPOLOGY = {
  type: "Topology",
  arcs: [
    [
      [-95, 36],
      [-89, 36],
      [-89, 40],
      [-95, 40],
      [-95, 36],
    ],
    [
      [-102, 37],
      [-95, 37],
      [-95, 40],
      [-102, 40],
      [-102, 37],
    ],
  ],
  objects: {
    states: {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", id: 29, arcs: [[0]] },
        { type: "Polygon", id: 20, arcs: [[1]] },
      ],
    },
  },
};

describe("ElectionDirectory map selection", () => {
  const twoStates = [
    race({ id: "mo", title: "Missouri Senate", state: "Missouri" }),
    race({ id: "ks", title: "Kansas Senate", state: "Kansas" }),
  ];

  function statePath(container: HTMLElement, name: string) {
    return Array.from(container.querySelectorAll("path")).find((p) =>
      p.getAttribute("aria-label")?.startsWith(name),
    ) as SVGPathElement | undefined;
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(REAL_TOPOLOGY),
      }),
    );
  });

  it("filters the grid when a state is clicked on the map", async () => {
    const { container } = renderDirectory(twoStates);

    const kansas = await waitFor(() => {
      const el = statePath(container, "Kansas");
      expect(el).toBeTruthy();
      return el!;
    });

    await fireEvent.click(kansas);

    await waitFor(() => expect(cards(container)).toHaveLength(1));
    expect(cards(container)[0].getAttribute("href")).toBe("/races/ks/");
  });

  it("clears the state filter when the same state is clicked again", async () => {
    const { container } = renderDirectory(twoStates);

    const kansas = await waitFor(() => {
      const el = statePath(container, "Kansas");
      expect(el).toBeTruthy();
      return el!;
    });

    await fireEvent.click(kansas);
    await waitFor(() => expect(cards(container)).toHaveLength(1));

    await fireEvent.click(statePath(container, "Kansas")!);
    await waitFor(() => expect(cards(container)).toHaveLength(2));
  });
});

describe("ElectionDirectory state filtering", () => {
  const twoStates = [
    race({ id: "mo", title: "Missouri Senate", state: "Missouri" }),
    race({ id: "ks", title: "Kansas Senate", state: "Kansas" }),
  ];

  it("narrows to a state chosen from the mobile picker", async () => {
    const { container } = renderDirectory(twoStates);
    const select = (await waitFor(() => {
      const el = container.querySelector("#mobile-state-select");
      expect(el).not.toBeNull();
      return el as HTMLSelectElement;
    })) as HTMLSelectElement;

    await fireEvent.change(select, { target: { value: "Kansas" } });

    await waitFor(() => expect(cards(container)).toHaveLength(1));
    expect(cards(container)[0].getAttribute("href")).toBe("/races/ks/");
  });

  it("falls back to jurisdiction when a race has no explicit state", async () => {
    const { container } = renderDirectory([
      race({
        id: "legacy",
        title: "Legacy Race",
        state: undefined,
        jurisdiction: "Kansas",
      }),
    ]);

    const select = (await waitFor(() => {
      const el = container.querySelector("#mobile-state-select");
      expect(el).not.toBeNull();
      return el as HTMLSelectElement;
    })) as HTMLSelectElement;

    await fireEvent.change(select, { target: { value: "Kansas" } });

    await waitFor(() => expect(cards(container)).toHaveLength(1));
  });

  it("merges abbreviations and malformed geography into canonical states", async () => {
    const { container } = renderDirectory([
      race({ id: "ca-senate-2026", state: "CA", jurisdiction: "California" }),
      race({
        id: "ca-house-01-2026",
        state: "California",
        jurisdiction: "California's 1st Congressional District",
      }),
      race({
        id: "ut-house-04-2026",
        state: "Utah's 4th Congressional District",
        jurisdiction: "Utah's 4th Congressional District",
      }),
    ]);

    const select = container.querySelector(
      "#mobile-state-select",
    ) as HTMLSelectElement;
    const labels = Array.from(select.options).map(
      (option) => option.textContent,
    );

    expect(labels).toContain("California (2 races)");
    expect(labels).toContain("Utah (1 race)");
    expect(labels).not.toContain("CA (1 race)");
    expect(labels).not.toContain("Utah's 4th Congressional District (1 race)");
  });
});

describe("ElectionDirectory filter persistence", () => {
  const mixed = [
    race({ id: "mo", title: "Missouri Senate", state: "Missouri" }),
    race({
      id: "mo-gov",
      title: "Missouri Governor",
      office: "Governor",
      state: "Missouri",
    }),
    race({ id: "ks", title: "Kansas Senate", state: "Kansas" }),
  ];

  it("keeps the office filter when a state is chosen", async () => {
    const { container } = renderDirectory(mixed);
    await fireEvent.click(officeChip(container, "Senate")!);
    await waitFor(() => expect(cards(container)).toHaveLength(2));

    const select = container.querySelector(
      "#mobile-state-select",
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "Missouri" } });

    await waitFor(() => expect(cards(container)).toHaveLength(1));
    expect(cards(container)[0].getAttribute("href")).toBe("/races/mo/");
    expect(officeChip(container, "Senate")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("writes state and office to the url and reads them back", async () => {
    const { container } = renderDirectory(mixed);
    await fireEvent.click(officeChip(container, "Governor")!);
    const lastUrl = replaceState.mock.calls.at(-1)?.[0] as URL;
    expect(lastUrl.searchParams.get("office")).toBe("Governor");

    navigateTo(`${ROUTE}?state=Kansas&office=Senate`);
    await waitFor(() => expect(cards(container)).toHaveLength(1));
    expect(cards(container)[0].getAttribute("href")).toBe("/races/ks/");
  });

  it("canonicalizes a postal-code or lowercase state from a shared link", async () => {
    const { container } = renderDirectory(mixed);
    for (const state of ["KS", "kansas"]) {
      navigateTo(`${ROUTE}?state=${state}`);
      await waitFor(() => expect(cards(container)).toHaveLength(1));
      expect(cards(container)[0].getAttribute("href")).toBe("/races/ks/");
      navigateTo(ROUTE);
      await waitFor(() => expect(cards(container)).toHaveLength(3));
    }
  });

  it("keeps the selected state in the picker when search no longer matches it", async () => {
    const { container } = renderDirectory(mixed);
    navigateTo(`${ROUTE}?state=Kansas&q=Missouri`);
    await waitFor(() => {
      const select = container.querySelector(
        "#mobile-state-select",
      ) as HTMLSelectElement;
      expect(
        Array.from(select.options).map((option) => option.value),
      ).toContain("Kansas");
      expect(select.value).toBe("Kansas");
    });
  });

  it("shows an error state instead of 'nothing published' when loading failed", async () => {
    const { container } = render(ElectionDirectory, {
      races: [],
      loadError: true,
    });
    await waitFor(() =>
      expect(container.textContent).toContain(
        "We couldn’t load the election guides",
      ),
    );
    expect(container.textContent).not.toContain(
      "No races have been published yet",
    );
  });
});
