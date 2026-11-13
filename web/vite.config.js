import adapter from "@sveltejs/adapter-static";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { cspHeadersPlugin } from "./scripts/csp-headers.mjs";
import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "node:fs";
import { svelteTesting } from "@testing-library/svelte/vite";
import { sveltekit } from "@sveltejs/kit/vite";
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
  ...appTemplate.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi),
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
  // Header search loads this prebuilt index instead of the 2 MB summaries.json.
  "/search-index.json",
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
  "/results/",
  "/support/",
  "/support/cancel/",
  "/support/success/",
  "/terms/",
];

/** @type {import('@sveltejs/kit').Config} */
const svelteKitOptions = {
  preprocess: vitePreprocess(),
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
        // The Census geocoder is called through the races API
        // (POST /geocode/census) with fetch, never as JSONP: its JSONP
        // endpoint runs any callback= and would defeat this hash policy.
        "https://static.cloudflareinsights.com",
      ],
    },
  },
  // Kit 3 no longer predefines $lib; `alias` is deprecated in favour of
  // package.json `imports` (#lib/*), which would rewrite every $lib import.
  alias: {
    $lib: "src/lib",
  },
  paths: {
    relative: false,
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    sveltekit(svelteKitOptions),
    svelteTesting(),
    // Must follow sveltekit(): rewrites build/_headers after the adapter runs.
    cspHeadersPlugin({ env: { ...loadEnv(mode, process.cwd(), "VITE_") } }),
  ],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.{ts,svelte}"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/**/*.d.ts",
        "src/lib/types.ts",
        "src/lib/sampleData.ts",
        "src/lib/config/modelCatalog.ts",
      ],
      // Ratchet floors: set a couple of points under measured coverage so a real
      // regression fails the build while ordinary variance does not. They were
      // 35/25/35/40, which measured coverage had outgrown by ~20 points — a
      // floor that far below actual stops being a guard and just reports a
      // number. Raise these whenever coverage climbs; never lower them to make
      // a red build green.
      // Measured at the time of writing: 81.32 / 67.97 / 81.24 / 82.35.
      thresholds: {
        statements: 80,
        branches: 66,
        functions: 79,
        lines: 81,
      },
      reporter: ["text", "json-summary"],
    },
  },
}));
