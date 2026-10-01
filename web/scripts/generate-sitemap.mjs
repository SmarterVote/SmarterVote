import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_URL = "https://smarter.vote";
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
  const entries = [
    urlEntry(`${SITE_URL}/`),
    urlEntry(`${SITE_URL}/elections/`),
    urlEntry(`${SITE_URL}/forecast/`),
    urlEntry(`${SITE_URL}/my-ballot/`),
    urlEntry(`${SITE_URL}/about/`),
    urlEntry(`${SITE_URL}/support/`),
    urlEntry(`${SITE_URL}/partners/`),
    urlEntry(`${SITE_URL}/corrections/`),
    urlEntry(`${SITE_URL}/funding-and-editorial-independence/`),
    urlEntry(`${SITE_URL}/privacy/`),
    urlEntry(`${SITE_URL}/terms/`),
  ];

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
  const sitemapPath = path.resolve("static", "sitemap.xml");
  await fs.writeFile(sitemapPath, xml, "utf8");
  console.log(`Generated ${sitemapPath} with ${entries.length} URLs`);
}

// Importing this module (the slug parity test does) must not write files.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
