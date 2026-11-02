// Cloudflare Pages Function: serves election results from the edge cache so
// Election Night traffic does not reach the races API. `wrangler pages deploy`
// picks up ./functions relative to the repo root, where the deploy step runs.
const DEFAULT_RACES_API_URL = "https://races-api-dev-ddsvfazica-uc.a.run.app";
const FRESH_MS = 60_000;
const STALE_CACHE_SECONDS = 86_400;

function respond(body, fetchedAt) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30",
      "X-Results-Fetched-At": String(fetchedAt),
    },
  });
}

export async function onRequestGet({ env, request, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + "/results-live.json");
  const cached = await cache.match(key);
  const fetchedAt = Number(cached?.headers.get("X-Results-Fetched-At") ?? 0);
  // Rebuilt, not returned as stored: the stored copy's day-long max-age is for
  // this cache only and must never reach a visitor's browser.
  if (cached && Date.now() - fetchedAt < FRESH_MS) {
    return respond(await cached.text(), fetchedAt);
  }

  try {
    const base = (env.RACES_API_URL || DEFAULT_RACES_API_URL).replace(
      /\/$/,
      "",
    );
    const upstream = await fetch(`${base}/public/results`);
    if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
    const body = await upstream.text();
    const now = Date.now();
    const stored = respond(body, now);
    stored.headers.set(
      "Cache-Control",
      `public, max-age=${STALE_CACHE_SECONDS}`,
    );
    waitUntil(cache.put(key, stored));
    return respond(body, now);
  } catch (error) {
    // An older count with its as_of timestamp beats an error on Election Night.
    if (cached) return respond(await cached.text(), fetchedAt);
    return new Response(JSON.stringify({ error: "Results unavailable" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
}
