// @vitest-environment node
import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";
import type { RaceSummary } from "$lib/types";
import ForecastMissingRaces from "./ForecastMissingRaces.svelte";

// Vitest's SvelteKit shim reports browser=true; prerendering does not.
vi.mock("$app/environment", () => ({
  browser: false,
  building: true,
  dev: false,
  version: "test",
}));

// Forecast race links used to be href={browser ? ... : undefined}, so the
// prerendered HTML shipped <a> tags without an href: not crawlable, not
// keyboard-focusable, and dead until hydration. They must render server-side.
describe("forecast race links in server-rendered HTML", () => {
  it("emits the race href during SSR", () => {
    const races: RaceSummary[] = [
      {
        id: "va-senate-2026",
        title: "2026 U.S. Senate election in Virginia",
        state: "Virginia",
        election_date: "2026-11-03",
        updated_utc: "2026-07-01T00:00:00Z",
        candidates: [],
      },
    ];
    const { body } = render(ForecastMissingRaces, {
      props: { races, activeTab: "senate" },
    });
    expect(body).toContain('href="/races/va-senate-2026/"');
  });
});
