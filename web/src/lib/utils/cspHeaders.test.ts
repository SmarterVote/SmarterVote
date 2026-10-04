import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONNECT_SRC_PLACEHOLDER,
  DEFAULT_RACES_API_URL,
  dataConnectSrcOrigins,
  renderHeaders,
  urlOrigin,
} from "../../../scripts/csp-headers.mjs";

// Vitest runs from web/; import.meta.url is not a file: URL under jsdom.
const template = readFileSync(
  resolve(process.cwd(), "static/_headers"),
  "utf8",
);

function connectSrc(headers: string): string {
  const match = headers.match(/connect-src ([^;]+);/);
  if (!match) throw new Error("no connect-src directive");
  return match[1];
}

describe("CSP _headers generator", () => {
  it("falls back to the production races API when no env is set", () => {
    expect(dataConnectSrcOrigins({})).toEqual([DEFAULT_RACES_API_URL]);
    const rendered = renderHeaders(template, {});
    expect(rendered).not.toContain(CONNECT_SRC_PLACEHOLDER);
    expect(connectSrc(rendered)).toContain(
      `'self' ${DEFAULT_RACES_API_URL} https://places.googleapis.com`,
    );
    expect(connectSrc(rendered)).not.toContain("storage.googleapis.com");
  });

  it("uses the configured races API origin, ignoring path and trailing slash", () => {
    expect(
      dataConnectSrcOrigins({
        VITE_RACES_API_URL: " https://api.example.org/v1/ ",
      }),
    ).toEqual(["https://api.example.org"]);
  });

  it("adds the GCS origin only when the public data URL points there", () => {
    expect(
      dataConnectSrcOrigins({
        VITE_RACES_API_URL: "https://api.example.org",
        VITE_PUBLIC_DATA_URL: "https://storage.googleapis.com/bucket/races",
      }),
    ).toEqual(["https://api.example.org", "https://storage.googleapis.com"]);
    expect(dataConnectSrcOrigins({ VITE_PUBLIC_DATA_URL: "/data" })).toEqual([
      DEFAULT_RACES_API_URL,
    ]);
  });

  it("dedupes identical origins and ignores non-http values", () => {
    expect(
      dataConnectSrcOrigins({
        VITE_RACES_API_URL: "https://x.example/api",
        VITE_PUBLIC_DATA_URL: "https://x.example/data",
      }),
    ).toEqual(["https://x.example"]);
    expect(urlOrigin("javascript:alert(1)")).toBeUndefined();
    expect(urlOrigin("not a url")).toBeUndefined();
    expect(urlOrigin("   ")).toBeUndefined();
    expect(
      dataConnectSrcOrigins({ VITE_RACES_API_URL: "ftp://x.example" }),
    ).toEqual([DEFAULT_RACES_API_URL]);
  });

  it("leaves the rest of the policy, including script-src, untouched", () => {
    const rendered = renderHeaders(template, {});
    expect(
      rendered.replace(DEFAULT_RACES_API_URL, CONNECT_SRC_PLACEHOLDER),
    ).toBe(template);
    expect(rendered).toContain(
      "script-src 'self' 'unsafe-inline' https://maps.googleapis.com",
    );
  });

  it("fails loudly when the placeholder is missing", () => {
    expect(() => renderHeaders("/*\n  X-Frame-Options: DENY\n", {})).toThrow(
      /placeholder/,
    );
  });
});
