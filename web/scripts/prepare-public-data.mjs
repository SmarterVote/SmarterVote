/**
 * Deploy-time preparation of the published race files synced into static/.
 *
 * Run by .github/workflows/cloudflare-deploy.yaml right after the GCS sync:
 *
 *   1. Writes static/forecast/<race_id>.json: just the forecast fields the
 *      /forecast/ analysis drawer reads, so expanding a card no longer pulls
 *      the full race file (candidates, issues, sources, reviews).
 *   2. Writes static/races/<race_id>/<slug>/index.html redirect stubs for
 *      candidates a pipeline run recorded as not running
 *      (pipeline_state.race_identity.known_ineligible_or_not_running) who are
 *      no longer on the published roster, so shared links to their old pages
 *      land on the race overview instead of a 404. Stubs rather than
 *      _redirects rules: there are thousands of these, and Cloudflare Pages
 *      caps _redirects at 2,000 static rules.
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
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Longest candidate slug a redirect page is written for. */
const MAX_SLUG_LENGTH = 80;

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
 * Slugs of candidates the pipeline recorded as not running whose pages are
 * gone from the published roster. Slugs that still address a published
 * candidate (current or legacy scheme, withdrawn included) are skipped so a
 * stub never stands in for a live page.
 * @param {Record<string, any>} race
 * @returns {string[]}
 */
export function removedCandidateSlugs(race) {
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

  const slugs = new Set();
  for (const entry of removed) {
    const name = removedCandidateName(entry);
    if (!name) continue;
    for (const slug of [candidateSlug(name), legacyCandidateSlug(name)]) {
      if (
        slug &&
        slug.length <= MAX_SLUG_LENGTH &&
        SAFE_SLUG_PATTERN.test(slug) &&
        !live.has(slug)
      )
        slugs.add(slug);
    }
  }
  return [...slugs].sort();
}

/**
 * The candidate's name from a known_ineligible_or_not_running entry. Entries
 * are usually a bare name, but the agent sometimes writes a note instead
 * ("Brian Shortsleeve lost the September 1 primary ... sources: https://...")
 * or a name with a parenthetical. Keep the text before the first bracket or
 * separator, then its leading run of 2-5 capitalised words; an entry that
 * doesn't open with a name yields null.
 * @param {unknown} entry
 * @returns {string | null}
 */
export function removedCandidateName(entry) {
  if (typeof entry !== "string") return null;
  const head = entry.split(/\s*(?:[([{:;,]|\s[-–—]\s|https?:\/\/)/u)[0].trim();
  const words = head.split(/\s+/);
  const name = [];
  for (const word of words) {
    if (!/^\p{Lu}[\p{L}\p{M}.'’-]*$/u.test(word)) break;
    name.push(word);
    if (name.length === 5) break;
  }
  return name.length >= 2 ? name.join(" ") : null;
}

/**
 * A static page that sends visitors (and crawlers, which treat an immediate
 * meta refresh as a permanent redirect) to `target`.
 * @param {string} target site-relative path
 */
export function redirectStubHtml(target) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${target}">
<link rel="canonical" href="${target}">
<title>Candidate no longer on the ballot</title>
</head>
<body>
<p>This candidate is no longer on the ballot. <a href="${target}">See the race overview</a>.</p>
</body>
</html>
`;
}

/**
 * Write redirect stubs for a race's removed candidates under
 * `<staticDir>/races/<race_id>/<slug>/index.html`, never overwriting a file
 * that is already there. Returns the number written.
 * @param {string} staticDir
 * @param {Record<string, any>} race
 */
export function writeRemovedCandidateStubs(staticDir, race) {
  let written = 0;
  const target = `/races/${race.id}/`;
  for (const slug of removedCandidateSlugs(race)) {
    const dir = path.join(staticDir, "races", String(race.id), slug);
    const file = path.join(dir, "index.html");
    if (fs.existsSync(file)) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, redirectStubHtml(target));
      written += 1;
    } catch (error) {
      // One unwritable stub must never block the whole site deploy.
      console.warn(`Skipped redirect page ${dir}: ${error}`);
    }
  }
  return written;
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
  let forecasts = 0;
  let stubs = 0;

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
        try {
          stubs += writeRemovedCandidateStubs(staticDir, data);
        } catch (error) {
          // Redirect pages are a nicety; never let one race's data block the deploy.
          log(`Skipped redirect pages for ${data.id}: ${error}`);
        }
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

  log(
    `Wrote ${forecasts} forecast payloads and ${stubs} removed-candidate redirect pages.`,
  );
  return { forecasts, redirectStubs: stubs };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  preparePublicData(path.resolve(process.argv[2] || "static"));
}
