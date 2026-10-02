import { describe, expect, it } from "vitest";
import {
  changedSitemapUrls,
  parseSitemap,
} from "../../../scripts/generate-sitemap.mjs";

const xml = (entries: Array<[string, string?]>) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n${entries
    .map(
      ([loc, lastmod]) =>
        `  <url>\n    <loc>${loc}</loc>\n${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ""}  </url>`,
    )
    .join("\n")}\n</urlset>\n`;

describe("IndexNow sitemap diff", () => {
  it("parses locations with and without lastmod", () => {
    const parsed = parseSitemap(
      xml([
        ["https://smarter.vote/", "2026-09-30"],
        ["https://smarter.vote/a&amp;b/"],
      ]),
    );
    expect([...parsed]).toEqual([
      ["https://smarter.vote/", "2026-09-30"],
      ["https://smarter.vote/a&b/", ""],
    ]);
  });

  it("lists only new URLs and URLs whose lastmod changed", () => {
    const previous = parseSitemap(
      xml([
        ["https://smarter.vote/", "2026-09-30"],
        ["https://smarter.vote/races/a/", "2026-09-01"],
        ["https://smarter.vote/races/gone/", "2026-09-01"],
      ]),
    );
    const current = parseSitemap(
      xml([
        ["https://smarter.vote/", "2026-09-30"],
        ["https://smarter.vote/races/a/", "2026-10-01"],
        ["https://smarter.vote/races/new/", "2026-10-01"],
      ]),
    );
    expect(changedSitemapUrls(current, previous)).toEqual([
      "https://smarter.vote/races/a/",
      "https://smarter.vote/races/new/",
    ]);
  });
});
