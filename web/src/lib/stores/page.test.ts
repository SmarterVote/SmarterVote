import { flushSync } from "svelte";
import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

vi.mock("$app/state", async () => {
  const { testPage } = await import("../../test-support/pageState.svelte");
  return { page: testPage };
});

import { testPage } from "../../test-support/pageState.svelte";
import { page } from "./page.svelte";

describe("page store shim", () => {
  it("mirrors $app/state and follows later navigations", () => {
    testPage.params = { slug: "a" };
    const seen: string[] = [];
    const unsubscribe = page.subscribe((value) =>
      seen.push(`${value.params.slug}|${value.url.pathname}`),
    );
    flushSync();
    expect(get(page).params.slug).toBe("a");

    testPage.params = { slug: "b" };
    testPage.url = new URL("https://smarter.vote/races/b/");
    flushSync();

    expect(seen.at(-1)).toBe("b|/races/b/");
    unsubscribe();
  });
});
