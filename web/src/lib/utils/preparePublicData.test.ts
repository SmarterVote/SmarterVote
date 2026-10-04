import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  forecastDetailsPayload,
  legacyCandidateSlug as scriptLegacySlug,
  mergeRedirects,
  preparePublicData,
  removedCandidateRedirects,
} from "../../../scripts/prepare-public-data.mjs";
import { candidateSlug, legacyCandidateSlug } from "./format";

const race = (overrides: Record<string, unknown> = {}) => ({
  id: "mi-governor-2026",
  updated_utc: "2026-09-01T00:00:00Z",
  candidates: [
    { name: "Jocelyn Benson", withdrawn: false },
    { name: "José Peña", withdrawn: true },
  ],
  pipeline_state: {
    race_identity: {
      known_ineligible_or_not_running: ["Mike Cox", "Chris Swanson"],
    },
  },
  ...overrides,
});

describe("legacy slug parity", () => {
  it.each(["José Peña", "Søren Łukasz", "O'Brien-Smith Jr.", ""])(
    "matches legacyCandidateSlug for %j",
    (name) => {
      expect(scriptLegacySlug(name)).toBe(legacyCandidateSlug(name));
    },
  );
});

describe("removedCandidateRedirects", () => {
  it("redirects recorded not-running candidates to the race page", () => {
    expect(removedCandidateRedirects(race())).toEqual([
      "/races/mi-governor-2026/chris-swanson /races/mi-governor-2026/ 301",
      "/races/mi-governor-2026/chris-swanson/ /races/mi-governor-2026/ 301",
      "/races/mi-governor-2026/mike-cox /races/mi-governor-2026/ 301",
      "/races/mi-governor-2026/mike-cox/ /races/mi-governor-2026/ 301",
    ]);
  });

  it("uses the site's slug scheme, including the legacy slug", () => {
    const lines = removedCandidateRedirects(
      race({
        pipeline_state: {
          race_identity: { known_ineligible_or_not_running: ["Linda Sánchez"] },
        },
      }),
    );
    const sources = lines.map((line: string) => line.split(" ")[0]);
    expect(sources).toContain(
      `/races/mi-governor-2026/${candidateSlug("Linda Sánchez")}`,
    );
    expect(sources).toContain(
      `/races/mi-governor-2026/${legacyCandidateSlug("Linda Sánchez")}`,
    );
  });

  it("never shadows a published candidate page or the compare route", () => {
    const lines = removedCandidateRedirects(
      race({
        pipeline_state: {
          race_identity: {
            known_ineligible_or_not_running: [
              "Jocelyn Benson",
              "Jose Pena",
              "jos pe a",
              "Compare",
            ],
          },
        },
      }),
    );
    expect(lines).toEqual([]);
  });

  it("ignores races without a recorded list or with a bad id", () => {
    expect(removedCandidateRedirects(race({ pipeline_state: null }))).toEqual(
      [],
    );
    expect(
      removedCandidateRedirects(
        race({ pipeline_state: { race_identity: null } }),
      ),
    ).toEqual([]);
    expect(removedCandidateRedirects(race({ id: "../etc" }))).toEqual([]);
    expect(
      removedCandidateRedirects(
        race({
          pipeline_state: {
            race_identity: { known_ineligible_or_not_running: [" ", 7] },
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("mergeRedirects", () => {
  const manual =
    "# Manual\n/races/mi-governor-2026/mike-cox /races/mi-governor-2026/ 301\n";

  it("keeps manual lines, skips duplicates and appends new rules", () => {
    const merged = mergeRedirects(manual, [
      "/races/mi-governor-2026/mike-cox /races/elsewhere/ 301",
      "/races/a/b /races/a/ 301",
      "/races/a/b /races/a/ 301",
    ]);
    expect(merged.added).toBe(1);
    expect(merged.text.startsWith(manual)).toBe(true);
    expect(merged.text).toContain("# Generated at deploy");
    expect(merged.text.match(/\/races\/a\/b /g)).toHaveLength(1);
    expect(merged.text).not.toContain("/races/elsewhere/");
  });

  it("leaves the file untouched when nothing is new", () => {
    expect(mergeRedirects(manual, [])).toMatchObject({
      text: manual,
      added: 0,
    });
  });
});

describe("forecastDetailsPayload", () => {
  it("keeps only the drawer fields plus identity and version", () => {
    expect(
      forecastDetailsPayload({
        id: "a",
        updated_utc: "2026-09-01T00:00:00Z",
        candidates: [{ name: "X" }],
        forecast: {
          rating: "lean_d",
          rationale: "Why.",
          key_reasons: ["One"],
          panel_spread: 0,
        },
      }),
    ).toEqual({
      id: "a",
      updated_utc: "2026-09-01T00:00:00Z",
      forecast: { rationale: "Why.", key_reasons: ["One"], panel_spread: 0 },
    });
  });

  it("returns null without a forecast", () => {
    expect(forecastDetailsPayload({ id: "a", forecast: null })).toBeNull();
  });
});

describe("preparePublicData", () => {
  let dir = "";
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes forecast payloads and redirects, then strips private fields", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-public-"));
    const write = (name: string, data: unknown) =>
      fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
    const read = (name: string) =>
      JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));

    write(
      "mi-governor-2026.json",
      race({
        forecast: { rationale: "Why.", rating: "lean_d" },
        agent_metrics: { cost: 1 },
        run_audit: {},
      }),
    );
    write("no-forecast-2026.json", { id: "no-forecast-2026", candidates: [] });
    write("summaries.json", [
      { id: "mi-governor-2026", agent_metrics: { cost: 1 } },
    ]);
    const chamber = { schema_version: "x", agent_metrics: "kept" };
    write("chamber_forecasts.json", chamber);
    fs.writeFileSync(path.join(dir, "_redirects"), "/old /new 301\n");

    const result = preparePublicData(dir, { log: () => {} });

    expect(result).toEqual({ forecasts: 1, redirectsAdded: 4 });
    expect(read("forecast/mi-governor-2026.json")).toEqual({
      id: "mi-governor-2026",
      updated_utc: "2026-09-01T00:00:00Z",
      forecast: { rationale: "Why." },
    });
    expect(
      fs.existsSync(path.join(dir, "forecast/no-forecast-2026.json")),
    ).toBe(false);
    const published = read("mi-governor-2026.json");
    expect(published).not.toHaveProperty("pipeline_state");
    expect(published).not.toHaveProperty("agent_metrics");
    expect(published).not.toHaveProperty("run_audit");
    expect(published.forecast.rating).toBe("lean_d");
    expect(read("summaries.json")).toEqual([{ id: "mi-governor-2026" }]);
    expect(read("chamber_forecasts.json")).toEqual(chamber);
    const redirects = fs.readFileSync(path.join(dir, "_redirects"), "utf8");
    expect(redirects.startsWith("/old /new 301\n")).toBe(true);
    expect(redirects).toContain(
      "/races/mi-governor-2026/mike-cox/ /races/mi-governor-2026/ 301",
    );
  });

  it("rejects an unexpected summaries shape", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-public-"));
    fs.writeFileSync(path.join(dir, "summaries.json"), JSON.stringify({}));
    expect(() => preparePublicData(dir, { log: () => {} })).toThrow(
      "Unexpected summaries.json shape",
    );
  });
});
