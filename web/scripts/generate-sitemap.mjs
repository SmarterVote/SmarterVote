import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_URL = "https://smarter.vote";
const PREVIOUS_SITEMAP_URL =
  process.env.SITEMAP_PREVIOUS_URL || `${SITE_URL}/sitemap.xml`;
/**
 * Where the URLs whose lastmod changed since the deployed sitemap are
 * written for scripts/submit-indexnow.mjs. node_modules/.cache is never
 * committed or deployed.
 */
export const INDEXNOW_CHANGES_PATH = path.resolve(
  process.env.INDEXNOW_CHANGES_PATH ||
    "node_modules/.cache/smartervote/indexnow-urls.json",
);

/**
 * Static pages with the source they are built from: their lastmod is the
 * last commit that touched that source. `data: true` pages also show
 * published race data, so they take the newer of that and the latest race.
 */
const STATIC_PAGES = [
  { path: "/", source: "src/routes/+page.svelte", data: true },
  { path: "/elections/", source: "src/routes/elections", data: true },
  { path: "/forecast/", source: "src/routes/forecast", data: true },
  { path: "/my-ballot/", source: "src/routes/my-ballot", data: true },
  { path: "/about/", source: "src/routes/about" },
  { path: "/support/", source: "src/routes/support" },
  { path: "/partners/", source: "src/routes/partners" },
  { path: "/corrections/", source: "src/routes/corrections" },
  {
    path: "/funding-and-editorial-independence/",
    source: "src/routes/funding-and-editorial-independence",
  },
  { path: "/privacy/", source: "src/routes/privacy" },
  { path: "/terms/", source: "src/routes/terms" },
];

/**
 * YYYY-MM-DD of the last commit touching `source`, or null outside git. In a
 * shallow CI checkout this is the deployed commit's date for every page.
 * @param {string} source
 */
function gitLastModified(source) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", "--", source],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** @param {Array<string | null | undefined>} dates */
function latestDate(...dates) {
  return (
    dates
      .filter(Boolean)
      .map((date) => String(date).slice(0, 10))
      .sort()
      .at(-1) ?? null
  );
}

/**
 * Map of <loc> to <lastmod> ("" when absent) from sitemap XML.
 * @param {string} xml
 * @returns {Map<string, string>}
 */
export function parseSitemap(xml) {
  const entries = new Map();
  for (const [, body] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = body.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) continue;
    const lastmod = body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "";
    entries.set(unescapeXml(loc.trim()), lastmod.trim());
  }
  return entries;
}

/**
 * URLs that are new or whose lastmod differs from the previous sitemap.
 * @param {Map<string, string>} current
 * @param {Map<string, string>} previous
 */
export function changedSitemapUrls(current, previous) {
  return [...current]
    .filter(([loc, lastmod]) => previous.get(loc) !== lastmod)
    .map(([loc]) => loc);
}

/** @param {string} value */
function unescapeXml(value) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

/** @param {string} xml */
export function sitemapHash(xml) {
  return createHash("sha256").update(xml).digest("hex");
}

/** The deployed sitemap, or null when it cannot be fetched. */
async function fetchPreviousSitemap() {
  try {
    const res = await fetch(PREVIOUS_SITEMAP_URL, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.log(
      `Could not fetch the deployed sitemap (${err instanceof Error ? err.message : String(err)}); IndexNow will submit every URL.`,
    );
    return null;
  }
}
const API_BASE = process.env.VITE_RACES_API_URL;
const PUBLIC_DATA_URL = process.env.VITE_PUBLIC_DATA_URL;

// Keep in sync with candidateSlug in src/lib/utils/format.ts
// (src/lib/utils/sitemapSlug.test.ts checks the two agree).
/** @type {Record<string, string>} */
const LETTER_FOLDS = {
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ł: "l",
  Ł: "L",
  ß: "ss",
  þ: "th",
  Þ: "TH",
  ı: "i",
};
const LETTER_FOLD_PATTERN = /[øØđĐðÐæÆœŒłŁßþÞı]/g;

/** @param {string} name */
export function candidateSlug(name) {
  const folded = String(name)
    .replace(LETTER_FOLD_PATTERN, (ch) => LETTER_FOLDS[ch] ?? ch)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (folded) return folded;
  const hex = Array.from(String(name).trim())
    .map((ch) => (ch.codePointAt(0) ?? 0).toString(16))
    .join("");
  return hex ? `c-${hex}` : "candidate";
}

/** @param {unknown} value */
function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * @param {string} loc
 * @param {string} [lastmod]
 */
function urlEntry(loc, lastmod) {
  const lines = ["  <url>", `    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod)
    lines.push(`    <lastmod>${escapeXml(lastmod.slice(0, 10))}</lastmod>`);
  lines.push("  </url>");
  return lines.join("\n");
}

/** Write static/sitemap.xml from the published race summaries. */
async function main() {
  /** @type {Array<{ id: string, updated_utc?: string, candidates?: Array<{ name: string }> }>} */
  let races;
  const localPath = path.resolve("static", "summaries.json");
  try {
    const content = await fs.readFile(localPath, "utf8");
    races = JSON.parse(content);
    console.log(
      `Loaded ${races.length} races from local path ${localPath} for sitemap.`,
    );
  } catch (err) {
    console.log(
      `Could not read local sitemap source: ${err instanceof Error ? err.message : String(err)}. Fetching from network...`,
    );

    const summariesUrl = PUBLIC_DATA_URL
      ? `${PUBLIC_DATA_URL.replace(/\/$/, "")}/summaries.json`
      : API_BASE
        ? `${API_BASE.replace(/\/$/, "")}/races/summaries`
        : null;

    if (!summariesUrl) {
      throw new Error(
        "Set VITE_PUBLIC_DATA_URL or VITE_RACES_API_URL to generate the sitemap from published race data.",
      );
    }

    const res = await fetch(summariesUrl);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch race summaries for sitemap: ${res.status}`,
      );
    }

    races = await res.json();
  }
  const buildDate = new Date().toISOString().slice(0, 10);
  const latestRaceUpdate = latestDate(...races.map((race) => race.updated_utc));
  const entries = STATIC_PAGES.map((page) => {
    const sourceDate = gitLastModified(page.source) ?? buildDate;
    return urlEntry(
      `${SITE_URL}${page.path}`,
      page.data
        ? (latestDate(sourceDate, latestRaceUpdate) ?? buildDate)
        : sourceDate,
    );
  });

  for (const race of races) {
    entries.push(urlEntry(`${SITE_URL}/races/${race.id}/`, race.updated_utc));
    // A duplicated roster entry is one page, so list its URL once.
    const slugs = new Set(
      (race.candidates ?? []).map((candidate) => candidateSlug(candidate.name)),
    );
    for (const slug of slugs) {
      entries.push(
        urlEntry(`${SITE_URL}/races/${race.id}/${slug}/`, race.updated_utc),
      );
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join(
    "\n",
  )}\n</urlset>\n`;
  const previousXml =
    process.env.SITEMAP_SKIP_PREVIOUS === "true"
      ? null
      : await fetchPreviousSitemap();
  const sitemapPath = path.resolve("static", "sitemap.xml");
  await fs.writeFile(sitemapPath, xml, "utf8");
  console.log(`Generated ${sitemapPath} with ${entries.length} URLs`);

  // Record what changed against the deployed sitemap, so IndexNow is only
  // told about new or updated pages. null = unknown, submit everything.
  const changed = previousXml
    ? changedSitemapUrls(parseSitemap(xml), parseSitemap(previousXml))
    : null;
  await fs.mkdir(path.dirname(INDEXNOW_CHANGES_PATH), { recursive: true });
  await fs.writeFile(
    INDEXNOW_CHANGES_PATH,
    JSON.stringify({ sitemapSha256: sitemapHash(xml), urls: changed }),
    "utf8",
  );
  if (changed)
    console.log(
      `${changed.length} sitemap URLs are new or changed since the deployed sitemap.`,
    );
}

// Importing this module (the slug parity test does) must not write files.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
