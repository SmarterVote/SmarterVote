// Templates the Cloudflare Pages `_headers` file at build time so the CSP
// connect-src list follows the same env vars the app reads at runtime
// (VITE_RACES_API_URL / VITE_PUBLIC_DATA_URL, see src/lib/config/api.ts).
// static/_headers carries CONNECT_SRC_PLACEHOLDER; the Vite plugin below
// rewrites build/_headers after the adapter has copied static files.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const CONNECT_SRC_PLACEHOLDER = "%DATA_CONNECT_SRC%";

// Keep in sync with PRODUCTION_RACES_API_URL in src/lib/config/api.ts.
export const DEFAULT_RACES_API_URL =
  "https://races-api-dev-ddsvfazica-uc.a.run.app";

/**
 * Origin of an absolute http(s) URL, or undefined for blank/relative/invalid
 * values (a relative data URL is same-origin and already covered by 'self').
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function urlOrigin(value) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return url.origin;
}

/**
 * Data hosts the app fetches from: the races API (falling back to the
 * production default, as the built app does) plus the public data bucket
 * origin when VITE_PUBLIC_DATA_URL points off-site (e.g. storage.googleapis.com).
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function dataConnectSrcOrigins(env) {
  const origins = [
    urlOrigin(env.VITE_RACES_API_URL) ?? urlOrigin(DEFAULT_RACES_API_URL),
    urlOrigin(env.VITE_PUBLIC_DATA_URL),
  ].filter(/** @returns {o is string} */ (o) => Boolean(o));
  return [...new Set(origins)];
}

/**
 * @param {string} template
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function renderHeaders(template, env) {
  if (!template.includes(CONNECT_SRC_PLACEHOLDER)) {
    throw new Error(
      `_headers is missing the ${CONNECT_SRC_PLACEHOLDER} connect-src placeholder`,
    );
  }
  return template.replaceAll(
    CONNECT_SRC_PLACEHOLDER,
    dataConnectSrcOrigins(env).join(" "),
  );
}

/**
 * Vite plugin: after SvelteKit's adapter writes the static build (its
 * closeBundle runs first because this plugin is ordered after sveltekit()),
 * replace the placeholder in <outDir>/_headers.
 * @param {{ env: Record<string, string | undefined>, outDir?: string }} options
 * @returns {import("vite").Plugin}
 */
export function cspHeadersPlugin({ env, outDir = "build" }) {
  let isSsrBuild = false;
  let root = process.cwd();
  return {
    name: "smartervote-csp-headers",
    apply: "build",
    configResolved(config) {
      isSsrBuild = Boolean(config.build.ssr);
      root = config.root;
    },
    closeBundle: {
      sequential: true,
      order: "post",
      handler() {
        if (!isSsrBuild) return;
        const file = resolve(root, outDir, "_headers");
        if (!existsSync(file)) {
          throw new Error(`Expected ${file} after the adapter ran`);
        }
        writeFileSync(file, renderHeaders(readFileSync(file, "utf8"), env));
      },
    },
  };
}
