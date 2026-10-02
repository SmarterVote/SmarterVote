import fs from "node:fs/promises";
import path from "node:path";
import { INDEXNOW_CHANGES_PATH, sitemapHash } from "./generate-sitemap.mjs";

const DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_HOST = "smarter.vote";
const MAX_URLS_PER_REQUEST = 10000;

const key = process.env.INDEXNOW_KEY;
const host = process.env.INDEXNOW_HOST || DEFAULT_HOST;
const endpoint = process.env.INDEXNOW_ENDPOINT || DEFAULT_ENDPOINT;
const keyLocation =
  process.env.INDEXNOW_KEY_LOCATION ||
  (key ? `https://${host}/${key}.txt` : undefined);
const sitemapPath = path.resolve(
  process.env.INDEXNOW_SITEMAP_PATH || "static/sitemap.xml",
);
const dryRun = process.env.INDEXNOW_DRY_RUN === "true";

if (!key) {
  console.log("Skipping IndexNow submission: INDEXNOW_KEY is not set.");
  process.exit(0);
}

const sitemapXml = await fs.readFile(sitemapPath, "utf8");
const allUrls = Array.from(
  sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g),
  (match) => unescapeXml(match[1]),
);

/**
 * generate-sitemap.mjs records which URLs are new or changed compared with
 * the sitemap deployed before this build. Use that list when it was made for
 * exactly this sitemap; otherwise (or with INDEXNOW_SUBMIT_ALL=true) submit
 * every URL.
 */
async function changedUrls() {
  if (process.env.INDEXNOW_SUBMIT_ALL === "true") return null;
  try {
    const record = JSON.parse(await fs.readFile(INDEXNOW_CHANGES_PATH, "utf8"));
    if (
      record?.sitemapSha256 === sitemapHash(sitemapXml) &&
      Array.isArray(record.urls)
    )
      return record.urls.map(String);
  } catch {
    // No usable record: submit everything.
  }
  return null;
}

const changed = await changedUrls();
if (changed === null) {
  console.log(
    "Submitting every sitemap URL (no change record for this sitemap).",
  );
}
const candidates = changed ?? allUrls;
const urls = candidates.filter((url) => {
  try {
    return new URL(url).host === host;
  } catch {
    return false;
  }
});

if (allUrls.length === 0) {
  throw new Error(`No URLs for ${host} found in ${sitemapPath}`);
}

if (urls.length === 0) {
  console.log("No new or changed sitemap URLs since the last deployment.");
  process.exit(0);
}

for (let start = 0; start < urls.length; start += MAX_URLS_PER_REQUEST) {
  const urlList = urls.slice(start, start + MAX_URLS_PER_REQUEST);
  const payload = {
    host,
    key,
    keyLocation,
    urlList,
  };

  if (dryRun) {
    console.log(
      `IndexNow dry run: would submit ${urlList.length} URLs to ${endpoint}`,
    );
    continue;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    if (
      response.status === 403 &&
      body.includes("SiteVerificationNotCompleted")
    ) {
      console.warn(
        `Skipping IndexNow submission: site verification is still pending (${body}).`,
      );
      continue;
    }

    throw new Error(
      `IndexNow submission failed with ${response.status}: ${body}`,
    );
  }

  console.log(`Submitted ${urlList.length} URLs to IndexNow.`);
}

function unescapeXml(value) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}
