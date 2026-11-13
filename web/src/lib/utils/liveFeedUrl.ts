import { cleanUrl } from "$lib/config/api";

/**
 * Where a live feed ("results-live.json" / "forecast-live.json") is served.
 * VITE_LIVE_FEEDS_URL points at the public bucket the races API writes the
 * static files to; unset, the feeds come from the Cloudflare Pages Functions
 * at the site root, which is how the site worked before the bucket existed.
 */
export function liveFeedUrl(file: string): string {
  const base = cleanUrl(import.meta.env.VITE_LIVE_FEEDS_URL);
  return base ? `${base}/${file}` : `/${file}`;
}

/**
 * Fetches a live feed from the static URL, falling back to the Function route
 * when the static copy is unreachable or not yet written (a CORS or network
 * failure, 404, or 5xx). With no static URL configured, it is one plain fetch.
 */
export async function fetchLiveFeed(
  file: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const url = liveFeedUrl(file);
  const fallback = `/${file}`;
  if (url === fallback) return fetchFn(url);
  try {
    const response = await fetchFn(url);
    if (response.ok) return response;
  } catch {
    // fall through to the Function route
  }
  return fetchFn(fallback);
}
