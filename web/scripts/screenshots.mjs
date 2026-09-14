/**
 * Smarter.Vote screenshot sweep.
 *
 * Drives the live (or any) deployment with Playwright and captures every view in
 * both desktop and mobile form factors, including a first set of interactive
 * permutations (filters, tabs, expanded panels, dark mode, mobile menus).
 *
 * Usage:
 *   node scripts/screenshots.mjs
 *   BASE_URL=http://127.0.0.1:4173 node scripts/screenshots.mjs
 *   OUT_DIR=/tmp/shots node scripts/screenshots.mjs --only=elections,forecast
 *   node scripts/screenshots.mjs --viewport=mobile
 *
 * Env / flags:
 *   BASE_URL     deployment to shoot (default https://smarter.vote)
 *   OUT_DIR      output directory (default ./screenshots/<timestamp>)
 *   --only=a,b   only run shots whose name contains one of these substrings
 *   --viewport=  desktop | mobile (default: both)
 *   --headed     run with a visible browser
 *
 * TODO (future permutations — intentionally not yet covered):
 *   - /my-ballot address entry -> "exploring" results layout (needs a stubbed
 *     Google Places + Census Geocoder response or a canned address)
 *   - race detail draft preview banner (?draft=true, needs admin auth)
 *   - discovery-only "Limited Data" banner (no prod race currently triggers it)
 *   - withdrawn-candidate expanded list on race detail
 *   - IssueTable expanded rows / source popovers on candidate detail
 *   - compare page: toggling individual issue rows, 2-vs-3 candidate subsets
 *   - forecast: per-state drill-down list, holdovers, missing-races sections
 *   - admin/pipeline dashboard (needs Auth0 login)
 *   - error/500 view, offline/fallback ("Using Sample Data") states
 */

import { chromium, devices } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL || "https://smarter.vote").replace(
  /\/$/,
  "",
);
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) || "")
  .replace("--only=", "")
  .split(",")
  .filter(Boolean);
const viewportFilter = (
  args.find((a) => a.startsWith("--viewport=")) || ""
).replace("--viewport=", "");
const headed = args.includes("--headed");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR =
  process.env.OUT_DIR || path.join(process.cwd(), "screenshots", stamp);

// Representative race slugs on the live deployment.
const FULL_RACE = "ga-senate-2026"; // issues + polls + forecast + donor/voting record
const FULL_RACE_CANDIDATE = "jon-ossoff"; // incumbent -> voting record + donors
const MULTI_RACE = "ak-governor-2026"; // 4 candidates -> richer compare grid

/** @typedef {{ page: import('@playwright/test').Page, viewport: 'desktop'|'mobile', isMobile: boolean }} Ctx */

const settle = async (page, ms = 600) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};

// Walk the page top-to-bottom so lazy-loaded images below the fold start
// fetching, then return to the top for the capture.
const autoScroll = async (page) => {
  await page
    .evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0;
        const step = () => {
          window.scrollBy(0, window.innerHeight);
          y += window.innerHeight;
          if (y < document.body.scrollHeight) setTimeout(step, 80);
          else {
            window.scrollTo(0, 0);
            resolve();
          }
        };
        step();
      });
    })
    .catch(() => {});
};

// Block until images have actually decoded (or a 3s per-image ceiling) so
// avatars aren't captured as their alt text mid-fetch.
const waitForImages = async (page) => {
  await page
    .evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalWidth > 0
            ? img.decode().catch(() => {})
            : new Promise((res) => {
                img.addEventListener("load", res, { once: true });
                img.addEventListener("error", res, { once: true });
                setTimeout(res, 3000);
              }),
        ),
      );
    })
    .catch(() => {});
};

// Scroll a hash target under the sticky header and hold the viewport there.
const scrollToAnchor = async (page, id) => {
  await page
    .evaluate((anchorId) => {
      const el =
        document.getElementById(anchorId) ||
        document.querySelector(`[id*="${anchorId}" i]`);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo(0, Math.max(0, y));
      }
    }, id)
    .catch(() => {});
};

const setDark = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("darkMode", "true");
    } catch {}
  });
};

const openMobileSearch = async (page, query) => {
  await page.getByRole("button", { name: "Open search" }).click();
  const box = page.getByRole("combobox", {
    name: "Search elections and candidates",
  });
  await box.fill(query);
  await settle(page, 900);
};

/**
 * Shot definitions. `viewports` restricts a shot; omit for both.
 * `action(ctx)` runs after navigation + settle, before capture.
 * `path` is appended to BASE_URL. `noFullPage` captures the viewport only.
 */
const shots = [
  // ---- Core pages -------------------------------------------------------
  { name: "home", path: "/" },
  { name: "home-dark", path: "/", dark: true },
  {
    name: "home-search-results",
    path: "/",
    viewports: ["desktop"],
    action: async ({ page }) => {
      const box = page.getByRole("combobox", {
        name: "Search elections and candidates",
      });
      await box.click();
      await box.fill("ossoff");
      await settle(page, 900);
    },
  },
  { name: "elections", path: "/elections/" },
  { name: "elections-dark", path: "/elections/", dark: true },
  {
    name: "elections-office-filter",
    path: "/elections/",
    // On mobile the interactive map is collapsed by default, so expand it after
    // filtering or the office highlight this shot exists to show never appears.
    action: async ({ page, isMobile }) => {
      await page.getByRole("button", { name: "Senate", exact: true }).click();
      if (isMobile) {
        await page
          .getByRole("button", { name: "Show interactive map" })
          .click()
          .catch(() => {});
      }
      await settle(page, 500);
    },
  },
  {
    name: "elections-state-selected",
    path: "/elections/",
    action: async ({ page, isMobile }) => {
      if (isMobile) {
        await page
          .locator("#mobile-state-select")
          .selectOption("Georgia")
          .catch(() => {});
        await page
          .getByRole("button", { name: "Show interactive map" })
          .click()
          .catch(() => {});
      } else {
        await page
          .getByRole("button", { name: /^Georgia, \d+ race/ })
          .click()
          .catch(() => {});
      }
      await settle(page, 500);
    },
  },
  {
    name: "elections-search-hits",
    path: "/elections/?q=senate",
    action: async ({ page }) => {
      await settle(page, 600);
      await waitForImages(page);
    },
  },
  {
    name: "elections-search-empty",
    path: "/elections/?q=zzzznotarealquery",
    action: async ({ page }) => settle(page, 600),
  },
  {
    name: "elections-map-expanded-mobile",
    path: "/elections/",
    viewports: ["mobile"],
    action: async ({ page }) => {
      await page
        .getByRole("button", { name: "Show interactive map" })
        .click()
        .catch(() => {});
      await settle(page, 400);
    },
  },

  // ---- Forecast --------------------------------------------------------
  { name: "forecast-house", path: "/forecast/" },
  { name: "forecast-house-dark", path: "/forecast/", dark: true },
  { name: "forecast-senate", path: "/forecast/?tab=senate" },
  { name: "forecast-governors", path: "/forecast/?tab=governors" },
  {
    name: "forecast-state-selected",
    path: "/forecast/?tab=senate&state=Georgia",
    action: async ({ page }) => settle(page, 700),
  },

  // ---- My ballot ------------------------------------------------------
  { name: "my-ballot", path: "/my-ballot/" },
  { name: "my-ballot-dark", path: "/my-ballot/", dark: true },

  // ---- Trust / legal / info pages -----------------------------------
  { name: "about", path: "/about/" },
  {
    // A full-page screenshot ignores the hash, so this must be a viewport-only
    // capture scrolled to the #methodology section — otherwise it is a
    // pixel-identical duplicate of `about`.
    name: "about-methodology",
    path: "/about/#methodology",
    noFullPage: true,
    action: async ({ page }) => {
      await settle(page, 400);
      await scrollToAnchor(page, "methodology");
      await settle(page, 400);
    },
  },
  { name: "support", path: "/support/" },
  { name: "support-success", path: "/support/success/" },
  { name: "support-cancel", path: "/support/cancel/" },
  { name: "corrections", path: "/corrections/" },
  {
    name: "funding-and-editorial-independence",
    path: "/funding-and-editorial-independence/",
  },
  { name: "partners", path: "/partners/" },
  { name: "privacy", path: "/privacy/" },
  { name: "terms", path: "/terms/" },
  { name: "not-found", path: "/this-route-does-not-exist" },

  // ---- Race detail ---------------------------------------------------
  {
    name: "race-detail",
    path: `/races/${FULL_RACE}/`,
    action: async ({ page }) => settle(page, 900),
  },
  {
    name: "race-detail-dark",
    path: `/races/${FULL_RACE}/`,
    dark: true,
    action: async ({ page }) => settle(page, 900),
  },
  {
    name: "race-detail-forecast-expanded",
    path: `/races/${FULL_RACE}/`,
    action: async ({ page }) => {
      await settle(page, 900);
      await page
        .getByRole("button", { name: /Show details/i })
        .first()
        .click()
        .catch(() => {});
      await settle(page, 500);
    },
  },
  {
    name: "race-detail-compare-drawer",
    path: `/races/${FULL_RACE}/`,
    viewports: ["desktop"],
    action: async ({ page }) => {
      await settle(page, 900);
      const checks = page.getByRole("checkbox");
      const n = await checks.count();
      for (let i = 0; i < Math.min(n, 2); i++)
        await checks
          .nth(i)
          .check()
          .catch(() => {});
      await settle(page, 400);
    },
  },

  // ---- Candidate detail --------------------------------------------
  {
    name: "candidate-detail",
    path: `/races/${FULL_RACE}/${FULL_RACE_CANDIDATE}/`,
    action: async ({ page }) => settle(page, 900),
  },
  {
    name: "candidate-detail-dark",
    path: `/races/${FULL_RACE}/${FULL_RACE_CANDIDATE}/`,
    dark: true,
    action: async ({ page }) => settle(page, 900),
  },
  {
    name: "candidate-detail-others-expanded",
    path: `/races/${FULL_RACE}/${FULL_RACE_CANDIDATE}/`,
    // Expand each collapsible independently — a loose /Show \d+ more/ matches the
    // biography toggle *and* every per-issue "show more sources" button, which
    // trips strict mode and leaves everything collapsed.
    action: async ({ page }) => {
      await settle(page, 900);
      await page
        .getByRole("button", { name: /Other Candidates \(/ })
        .click()
        .catch(() => {});
      await page
        .getByRole("button", { name: /more biography sources/ })
        .first()
        .click()
        .catch(() => {});
      await page
        .getByRole("button", { name: /more sources for /i })
        .first()
        .click()
        .catch(() => {});
      await settle(page, 400);
    },
  },

  // ---- Compare ----------------------------------------------------
  {
    name: "compare",
    path: `/races/${FULL_RACE}/compare/`,
    action: async ({ page }) => settle(page, 900),
  },
  {
    name: "compare-dark",
    path: `/races/${FULL_RACE}/compare/`,
    dark: true,
    action: async ({ page }) => settle(page, 900),
  },
  {
    name: "compare-multi",
    path: `/races/${MULTI_RACE}/compare/`,
    action: async ({ page }) => settle(page, 900),
  },

  // ---- Global chrome (header/nav/search) ------------------------
  {
    name: "header-mobile-nav-open",
    path: "/",
    viewports: ["mobile"],
    noFullPage: true,
    action: async ({ page }) => {
      await page.getByRole("button", { name: "Open navigation menu" }).click();
      await settle(page, 300);
    },
  },
  {
    name: "header-mobile-search-open",
    path: "/",
    viewports: ["mobile"],
    noFullPage: true,
    action: async ({ page }) => openMobileSearch(page, "ossoff"),
  },
  {
    name: "admin-signin",
    path: "/admin/",
    action: async ({ page }) => settle(page, 1500),
  },
];

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: !headed });

  const targets = [
    {
      viewport: "desktop",
      opts: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    { viewport: "mobile", opts: { ...devices["Pixel 7"] } },
  ].filter((t) => !viewportFilter || t.viewport === viewportFilter);

  const manifest = [];

  for (const target of targets) {
    const dir = path.join(OUT_DIR, target.viewport);
    await mkdir(dir, { recursive: true });
    const isMobile = target.viewport === "mobile";

    for (const shot of shots) {
      if (only.length && !only.some((s) => shot.name.includes(s))) continue;
      if (shot.viewports && !shot.viewports.includes(target.viewport)) continue;

      const context = await browser.newContext(target.opts);
      const page = await context.newPage();
      const record = {
        name: shot.name,
        viewport: target.viewport,
        path: shot.path,
        url: BASE_URL + shot.path,
      };
      try {
        if (shot.dark) await setDark(page);
        await page.goto(BASE_URL + shot.path, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await settle(page);
        if (shot.action)
          await shot.action({ page, viewport: target.viewport, isMobile });
        if (!shot.noFullPage) {
          await autoScroll(page);
          await waitForImages(page);
          await page.waitForTimeout(250);
        }
        const file = path.join(dir, `${shot.name}.png`);
        await page.screenshot({ path: file, fullPage: !shot.noFullPage });
        record.file = path.relative(OUT_DIR, file);
        record.ok = true;
        console.log(`  ✓ ${target.viewport}/${shot.name}`);
      } catch (err) {
        record.ok = false;
        record.error = String(err?.message || err);
        console.log(`  ✗ ${target.viewport}/${shot.name} — ${record.error}`);
      } finally {
        manifest.push(record);
        await context.close();
      }
    }
  }

  await browser.close();
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        generatedAt: new Date().toISOString(),
        shots: manifest,
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(OUT_DIR, "index.html"), contactSheet(manifest));

  const ok = manifest.filter((m) => m.ok).length;
  console.log(`\n${ok}/${manifest.length} shots captured → ${OUT_DIR}`);
  if (ok < manifest.length) process.exitCode = 1;
}

function contactSheet(manifest) {
  const cards = manifest
    .map((m) => {
      if (!m.ok)
        return `<figure class="bad"><figcaption>${m.viewport} / ${m.name}<br><small>${m.error || "failed"}</small></figcaption></figure>`;
      return `<figure><a href="${m.file}" target="_blank"><img loading="lazy" src="${m.file}" alt="${m.name}"></a><figcaption>${m.viewport} / ${m.name}<br><small>${m.path}</small></figcaption></figure>`;
    })
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Smarter.Vote screenshot sweep</title>
<style>
  body{font:14px system-ui;margin:24px;background:#0b0b0c;color:#e5e5e5}
  h1{font-size:18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
  figure{margin:0;background:#161618;border:1px solid #2a2a2e;border-radius:10px;overflow:hidden}
  figure.bad{border-color:#b91c1c;padding:16px;color:#fca5a5}
  img{display:block;width:100%;height:auto;border-bottom:1px solid #2a2a2e}
  figcaption{padding:8px 10px;font-weight:600}
  small{font-weight:400;color:#9ca3af}
</style>
<h1>Smarter.Vote screenshot sweep — ${manifest[0]?.viewport ? "" : ""}${new Date().toISOString()}</h1>
<div class="grid">
${cards}
</div>`;
}

run();
