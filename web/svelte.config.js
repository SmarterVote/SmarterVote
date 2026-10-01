import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// `npm run build:crawl` (used by CI) sets CRAWL_BUILD so the prerenderer
// follows every internal link and fails the build on broken links/anchors.
// The other build scripts stay fast and only render the fixed entries.
const isCrawlBuild =
  process.env.CRAWL_BUILD === "true" ||
  process.env.npm_lifecycle_event === "build:crawl";
const isFastBuild =
  !isCrawlBuild &&
  (process.env.FAST_BUILD === "true" ||
    process.env.npm_lifecycle_event === "build" ||
    process.env.npm_lifecycle_event === "build:fast" ||
    process.env.npm_lifecycle_event === "build:cloudflare" ||
    process.argv.includes("fast") ||
    process.argv.includes("--mode=fast"));

// Hash the executable inline <script> blocks in app.html (the theme bootstrap)
// so the per-page CSP SvelteKit emits can drop 'unsafe-inline'. JSON-LD blocks
// carry a type attribute, are not executed, and are not subject to script-src.
const appTemplate = readFileSync(
  new URL("./src/app.html", import.meta.url),
  "utf8",
);
const templateScriptHashes = [
  ...appTemplate.matchAll(/<script>([\s\S]*?)<\/script>/g),
].map(
  ([, body]) =>
    /** @type {`sha256-${string}`} */ (
      `sha256-${createHash("sha256").update(body).digest("base64")}`
    ),
);

const prerenderDynamicRoutes = process.env.VITE_PRERENDER_RACES === "true";
const deploySha = process.env.DEPLOY_SHA?.trim();
if (deploySha && !/^[0-9a-f]{7,64}$/i.test(deploySha)) {
  throw new Error("DEPLOY_SHA must be a Git commit SHA");
}
const appDir = deploySha
  ? `_app-${deploySha.slice(0, 12).toLowerCase()}`
  : "_app";
const fixedPrerenderEntries = [
  "/",
  "/about/",
  "/admin/",
  "/admin/pipeline/",
  "/corrections/",
  "/elections/",
  "/forecast/",
  "/funding-and-editorial-independence/",
  "/methodology/",
  "/my-ballot/",
  "/partners/",
  "/privacy/",
  "/support/",
  "/support/cancel/",
  "/support/success/",
  "/terms/",
];

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // A release-specific namespace prevents an HTML response cached under an
    // older module URL from breaking hydration after a deployment.
    appDir,
    adapter: adapter({
      pages: "build",
      assets: "build",
      precompress: false,
      strict: true,
    }),
    prerender: {
      crawl: !isFastBuild,
      // Production publishes every known race route so Cloudflare can return a
      // real 404 for unknown URLs without relying on a catch-all SPA fallback.
      entries: prerenderDynamicRoutes ? ["*"] : fixedPrerenderEntries,
      handleUnseenRoutes: "ignore",
    },
    // Prerendered pages get a <meta http-equiv> CSP whose script-src lists the
    // hashes of SvelteKit's inline bootstrap script and the app.html theme
    // script, without 'unsafe-inline'. The broader policy (and the directives
    // a meta tag cannot carry, like frame-ancestors) lives in static/_headers.
    csp: {
      mode: "hash",
      directives: {
        "script-src": [
          "self",
          ...templateScriptHashes,
          // Svelte 5 SSR puts onload/onerror="this.__e=event" on <img> (and other
          // load/error targets) so events that fire before hydration are
          // replayed. 'unsafe-hashes' + that exact handler's hash allows only it.
          "unsafe-hashes",
          "sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I=",
          "https://maps.googleapis.com",
          "https://maps.gstatic.com",
          "https://geocoding.geo.census.gov",
          "https://static.cloudflareinsights.com",
        ],
      },
    },
    alias: {
      $lib: "src/lib",
    },
    paths: {
      relative: false,
    },
  },
};

export default config;
