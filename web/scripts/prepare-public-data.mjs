/**
 * Deploy-time preparation of the published race files synced into static/.
 *
 * Run by .github/workflows/cloudflare-deploy.yaml right after the GCS sync:
 *
 *   1. Writes static/forecast/<race_id>.json: just the forecast fields the
 *      /forecast/ analysis drawer reads, so expanding a card no longer pulls
 *      the full race file (candidates, issues, sources, reviews).
 *   2. Appends 301s to static/_redirects for candidates a pipeline run recorded
 *      as not running (pipeline_state.race_identity.known_ineligible_or_not_running)
 *      and who are no longer on the published roster, so shared links to their
 *      old pages land on the race overview instead of a 404.
 *   3. Strips the internal pipeline fields the public site never reads
 *      (pipeline_state, agent_metrics, run_audit) from every served copy.
 *
 * Step 2 must read pipeline_state before step 3 removes it.
 *
 * Usage: node scripts/prepare-public-data.mjs [staticDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { candidateSlug } from "./generate-sitemap.mjs";

export const PRIVATE_KEYS = ["pipeline_state", "agent_metrics", "run_audit"];

/**
 * Forecast fields the analysis drawer reads (ForecastRaceCard). Kept in sync
 * with FORECAST_DETAIL_FIELDS in src/lib/prerenderData.ts by a parity test.
 */
export const FORECAST_DETAIL_FIELDS = [
  "rationale",
  "key_reasons",
  "uncertainty",
  "market_signals",
  "evidence_lineage",
  "source_urls",
  "panel",
  "panel_spread",
  "model",
  "generated_at",
];

/** Directory, relative to the static root, holding the per-race payloads. */
export const FORECAST_DIR = "forecast";

const NON_RACE_FILES = new Set(["summaries.json", "chamber_forecasts.json"]);
/** Child routes of /races/<race>/ that are not candidate pages. */
const RESERVED_CANDIDATE_SLUGS = new Set(["compare"]);
const RACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const GENERATED_HEADER =
  "# Generated at deploy (scripts/prepare-public-data.mjs): candidates recorded\n# as not running who are no longer on the published roster.";
/** Cloudflare Pages honours at most this many static redirect rules. */
const CLOUDFLARE_STATIC_REDIRECT_LIMIT = 2000;

/**
 * Pre-accent-folding slug, mirroring legacyCandidateSlug in
 * src/lib/utils/format.ts. Candidate pages still answer on it.
 * @param {string} name
 */
export function legacyCandidateSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** @param {unknown} value */
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The drawer payload for one race, or null when it has no forecast.
 * `updated_utc` lets the client detect a payload older than the race it is
 * showing (e.g. when VITE_PUBLIC_DATA_URL serves fresher data) and fall back.
 * @param {Record<string, any>} race
 */
export function forecastDetailsPayload(race) {
  if (!isObject(race) || !isObject(race.forecast)) return null;
  /** @type {Record<string, unknown>} */
  const forecast = {};
  for (const key of FORECAST_DETAIL_FIELDS) {
    if (race.forecast[key] !== undefined) forecast[key] = race.forecast[key];
  }
  return { id: race.id, updated_utc: race.updated_utc, forecast };
}

/**
 * Redirect rules for candidates the pipeline recorded as not running whose
 * pages are gone from the published roster. Slugs that still address a
 * published candidate (current or legacy scheme, withdrawn included) are
 * never redirected: Cloudflare applies _redirects before static files, so
 * such a rule would hide a live page.
 * @param {Record<string, any>} race
 * @returns {string[]}
 */
export function removedCandidateRedirects(race) {
  if (!isObject(race) || !RACE_ID_PATTERN.test(String(race.id ?? "")))
    return [];
  const identity = isObject(race.pipeline_state)
    ? race.pipeline_state.race_identity
    : null;
  const removed = isObject(identity)
    ? identity.known_ineligible_or_not_running
    : null;
  if (!Array.isArray(removed) || removed.length === 0) return [];

  const live = new Set(RESERVED_CANDIDATE_SLUGS);
  for (const candidate of Array.isArray(race.candidates)
    ? race.candidates
    : []) {
    const name = isObject(candidate) ? String(candidate.name ?? "") : "";
    if (!name.trim()) continue;
    live.add(candidateSlug(name));
    live.add(legacyCandidateSlug(name));
  }

  const target = `/races/${race.id}/`;
  const slugs = new Set();
  for (const name of removed) {
    if (typeof name !== "string" || !name.trim()) continue;
    for (const slug of [candidateSlug(name), legacyCandidateSlug(name)]) {
      if (slug && !live.has(slug)) slugs.add(slug);
    }
  }
  const lines = [];
  for (const slug of [...slugs].sort()) {
    const from = `/races/${race.id}/${slug}`;
    lines.push(`${from} ${target} 301`, `${from}/ ${target} 301`);
  }
  return lines;
}

/**
 * Source path of a redirect rule line, or null for comments/blank lines.
 * @param {string} line
 */
function ruleSource(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  return trimmed.split(/\s+/)[0];
}

/**
 * Append generated rules to the hand-maintained _redirects text. Existing
 * lines are kept verbatim and win: a generated rule whose source path already
 * has a rule (or repeats an earlier generated one) is dropped.
 * @param {string} existing
 * @param {string[]} generated
 */
export function mergeRedirects(existing, generated) {
  const seen = new Set(
    existing
      .split("\n")
      .map(ruleSource)
      .filter((source) => source !== null),
  );
  const added = [];
  for (const line of generated) {
    const source = ruleSource(line);
    if (source === null || seen.has(source)) continue;
    seen.add(source);
    added.push(line);
  }
  if (added.length === 0) return { text: existing, added: 0, total: seen.size };
  const base =
    existing.endsWith("\n") || !existing ? existing : `${existing}\n`;
  return {
    text: `${base}\n${GENERATED_HEADER}\n${added.join("\n")}\n`,
    added: added.length,
    total: seen.size,
  };
}

/** @param {any} d */
function stripPrivate(d) {
  if (isObject(d)) {
    for (const key of PRIVATE_KEYS) delete d[key];
  }
}

/**
 * Prepare every published JSON file in `staticDir` in place.
 * @param {string} staticDir
 * @param {{ log?: (message: string) => void }} [options]
 */
export function preparePublicData(staticDir, { log = console.log } = {}) {
  const forecastDir = path.join(staticDir, FORECAST_DIR);
  const redirects = [];
  let forecasts = 0;

  for (const file of fs.readdirSync(staticDir).sort()) {
    if (!file.endsWith(".json") || file === "chamber_forecasts.json") continue;
    const filePath = path.join(staticDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (file === "summaries.json") {
      // summaries.json entries carry agent_metrics (run cost, model, token
      // counts) for the admin API; strip it from the public index too.
      const entries = Array.isArray(data)
        ? data
        : Array.isArray(data?.races)
          ? data.races
          : null;
      if (!entries) throw new Error("Unexpected summaries.json shape");
      entries.forEach(stripPrivate);
    } else if (!isObject(data)) {
      continue;
    } else {
      if (!NON_RACE_FILES.has(file) && RACE_ID_PATTERN.test(String(data.id))) {
        redirects.push(...removedCandidateRedirects(data));
        const payload = forecastDetailsPayload(data);
        if (payload) {
          fs.mkdirSync(forecastDir, { recursive: true });
          fs.writeFileSync(
            path.join(forecastDir, `${data.id}.json`),
            JSON.stringify(payload),
          );
          forecasts += 1;
        }
      }
      stripPrivate(data);
    }
    fs.writeFileSync(filePath, JSON.stringify(data));
  }

  const redirectsPath = path.join(staticDir, "_redirects");
  const existing = fs.existsSync(redirectsPath)
    ? fs.readFileSync(redirectsPath, "utf8")
    : "";
  const merged = mergeRedirects(existing, redirects);
  if (merged.added > 0) fs.writeFileSync(redirectsPath, merged.text);
  if (merged.total > CLOUDFLARE_STATIC_REDIRECT_LIMIT) {
    throw new Error(
      `_redirects has ${merged.total} rules; Cloudflare Pages allows ${CLOUDFLARE_STATIC_REDIRECT_LIMIT}`,
    );
  }
  log(
    `Wrote ${forecasts} forecast payloads; added ${merged.added} removed-candidate redirects.`,
  );
  return { forecasts, redirectsAdded: merged.added };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  preparePublicData(path.resolve(process.argv[2] || "static"));
}
