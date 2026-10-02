import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { loadPrerenderSummaries } from "$lib/prerenderData";
import { buildSearchIndex } from "$lib/utils/searchIndex";

// Written to build/search-index.json at build time, so every build script
// (build, build:crawl, build:cloudflare) produces it without extra plumbing.
// In `vite dev` the same handler runs on request.
export const prerender = true;

export const GET: RequestHandler = async ({ fetch }) => {
  const races = await loadPrerenderSummaries(fetch).catch((error) => {
    // An empty index makes the header fall back to summaries.json.
    console.warn("Could not load race summaries for the search index:", error);
    return [];
  });
  return json(buildSearchIndex(races));
};
