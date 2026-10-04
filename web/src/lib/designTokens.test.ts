import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// design-system/ is a standalone React port of the site's look. Its semantic
// colour tokens are copied from app.css, which is where the WCAG AA tuning
// happens; this keeps the copy from silently falling behind.
function svTokens(file: string): Record<string, Record<string, string>> {
  const css = readFileSync(resolve(process.cwd(), file), "utf8");
  const blocks: Record<string, Record<string, string>> = {};
  for (const [, selector, body] of css.matchAll(
    /^(:root|\.dark)\s*\{([^}]*)\}/gm,
  )) {
    const tokens = (blocks[selector] ??= {});
    for (const [, name, value] of body.matchAll(/(--sv-[\w-]+):\s*([^;]+);/g))
      tokens[name] = value.trim();
  }
  return blocks;
}

describe("design-system tokens", () => {
  it("match the web app's --sv-* colour tokens in light and dark mode", () => {
    const web = svTokens("src/app.css");
    const ds = svTokens("../design-system/src/styles/tokens.css");
    expect(Object.keys(web[":root"] ?? {})).toContain("--sv-text-faint");
    expect(ds[":root"]).toEqual(web[":root"]);
    expect(ds[".dark"]).toEqual(web[".dark"]);
  });
});
