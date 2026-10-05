import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  forecastDetailsPayload,
  legacyCandidateSlug as scriptLegacySlug,
  preparePublicData,
  redirectStubHtml,
  removedCandidateName,
  removedCandidateSlugs,
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

describe("removedCandidateSlugs", () => {
  it("redirects recorded not-running candidates to the race page", () => {
    expect(removedCandidateSlugs(race())).toEqual([
      "chris-swanson",
      "mike-cox",
    ]);
  });

  it("uses the site's slug scheme, including the legacy slug", () => {
    const lines = removedCandidateSlugs(
      race({
        pipeline_state: {
          race_identity: { known_ineligible_or_not_running: ["Linda Sánchez"] },
        },
      }),
    );
    expect(lines).toContain(candidateSlug("Linda Sánchez"));
    expect(lines).toContain(legacyCandidateSlug("Linda Sánchez"));
  });

  it("never shadows a published candidate page or the compare route", () => {
    const lines = removedCandidateSlugs(
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
    expect(removedCandidateSlugs(race({ pipeline_state: null }))).toEqual([]);
    expect(
      removedCandidateSlugs(race({ pipeline_state: { race_identity: null } })),
    ).toEqual([]);
    expect(removedCandidateSlugs(race({ id: "../etc" }))).toEqual([]);
    expect(
      removedCandidateSlugs(
        race({
          pipeline_state: {
            race_identity: { known_ineligible_or_not_running: [" ", 7] },
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("removedCandidateName", () => {
  it.each([
    ["Mike Cox", "Mike Cox"],
    ["Chris Swanson (withdrew May 2026)", "Chris Swanson"],
    ["José Peña - not on the ballot", "José Peña"],
    ["Mary O'Neil-Smith: lost primary", "Mary O'Neil-Smith"],
    ["J. Robert Smith Jr.", "J. Robert Smith Jr."],
    [
      "Brian Shortsleeve lost the September 1, 2026 Republican primary for Governor of Massachusetts to Michael Minogue 76.0% to 24.0% per Ballotpedia ... sources: https://ballotpedia.org/x",
      "Brian Shortsleeve",
    ],
  ])("extracts the name from %j", (entry, name) => {
    expect(removedCandidateName(entry)).toBe(name);
  });

  it.each(["lost the primary", "Cox", "", "   ", 7, null])(
    "returns null for %j",
    (entry) => {
      expect(removedCandidateName(entry)).toBeNull();
    },
  );
});

describe("redirectStubHtml", () => {
  it("refreshes immediately to the target and stays out of the index", () => {
    const html = redirectStubHtml("/races/mi-governor-2026/");
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0; url=/races/mi-governor-2026/">',
    );
    expect(html).toContain(
      '<link rel="canonical" href="/races/mi-governor-2026/">',
    );
    expect(html).toContain('<meta name="robots" content="noindex">');
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

  it("writes forecast payloads and redirect pages, then strips private fields", () => {
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
    const existingStub = path.join(
      dir,
      "races/mi-governor-2026/chris-swanson/index.html",
    );
    fs.mkdirSync(path.dirname(existingStub), { recursive: true });
    fs.writeFileSync(existingStub, "kept");

    const result = preparePublicData(dir, { log: () => {} });

    expect(result).toEqual({ forecasts: 1, redirectStubs: 1 });
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
    expect(fs.readFileSync(path.join(dir, "_redirects"), "utf8")).toBe(
      "/old /new 301\n",
    );
    expect(
      fs.readFileSync(
        path.join(dir, "races/mi-governor-2026/mike-cox/index.html"),
        "utf8",
      ),
    ).toContain('content="0; url=/races/mi-governor-2026/"');
    expect(fs.readFileSync(existingStub, "utf8")).toBe("kept");
  });

  it("rejects an unexpected summaries shape", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-public-"));
    fs.writeFileSync(path.join(dir, "summaries.json"), JSON.stringify({}));
    expect(() => preparePublicData(dir, { log: () => {} })).toThrow(
      "Unexpected summaries.json shape",
    );
  });
});
