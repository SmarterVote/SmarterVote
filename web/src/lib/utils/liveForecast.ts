import { browser } from "$app/environment";
import { readable } from "svelte/store";
import type {
  LiveChamberProjection,
  LiveForecastFile,
  LiveSwingPosterior,
} from "$lib/types";
import type { ForecastTab } from "$lib/utils/forecast";
import { fetchLiveFeed } from "$lib/utils/liveFeedUrl";

const LIVE_FORECAST_FILE = "forecast-live.json";
const REFRESH_MS = 60_000;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * The live projection for one chamber, or null when the page should show only
 * the pre-election forecast: no file, no races called yet, or a malformed row.
 */
export function liveChamberProjection(
  file: LiveForecastFile | null | undefined,
  tab: ForecastTab,
  /** The results page shows the projection before the first call, too. */
  minCalled = 1,
): LiveChamberProjection | null {
  const row = file?.chambers?.[tab];
  if (!row || typeof row !== "object") return null;
  const probability = row.control_probability;
  if (
    !isCount(row.called_count) ||
    !isCount(row.total_count) ||
    row.called_count < minCalled ||
    row.called_count > row.total_count ||
    typeof probability !== "number" ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1 ||
    !row.seat_distribution ||
    typeof row.seat_distribution !== "object"
  ) {
    return null;
  }
  return row;
}

/**
 * One line on what the calls so far say about the polls, or null when the
 * feed has no swing update (too few informative calls, or an older feed).
 */
export function swingPosteriorNote(
  posterior: LiveSwingPosterior | null | undefined,
): string | null {
  if (!posterior || typeof posterior !== "object") return null;
  const calls = posterior.calls ?? posterior.informative_calls;
  const mean = posterior.mean_logit;
  if (
    !isCount(calls) ||
    calls === 0 ||
    typeof mean !== "number" ||
    !Number.isFinite(mean)
  ) {
    return null;
  }
  const direction =
    posterior.direction ??
    (Math.abs(mean) < 0.1
      ? "accurate"
      : mean > 0
        ? "Republican"
        : "Democratic");
  const finding =
    direction === "accurate"
      ? "polls being about right"
      : `polls underestimating ${direction === "Republican" ? "Republicans" : "Democrats"}`;
  return `Updated with ${calls} called ${calls === 1 ? "race" : "races"}: results so far point to ${finding}.`;
}

/** Like the pre-election card's format, except an outcome the calls settle reads 0% / 100%. */
export function formatLiveControlProbability(value: number): string {
  if (value >= 1) return "100%";
  if (value <= 0) return "0%";
  if (value >= 0.9995) return ">99.9%";
  if (value <= 0.0005) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

export async function fetchLiveForecast(
  fetchFn: typeof fetch = fetch,
): Promise<LiveForecastFile | null> {
  try {
    const response = await fetchLiveFeed(LIVE_FORECAST_FILE, fetchFn);
    if (!response.ok) return null;
    const file = (await response.json()) as LiveForecastFile;
    if (!file || typeof file !== "object" || !file.chambers) return null;
    if (typeof file.chambers !== "object") return null;
    return file;
  } catch {
    return null;
  }
}

/**
 * The live projection file, refreshed each minute while the tab is visible.
 * A failed fetch keeps the last good copy (it carries its own as-of time);
 * before any good copy it stays null, so the page shows only the forecast.
 */
export const liveForecast = readable<LiveForecastFile | null>(null, (set) => {
  if (!browser) return;
  const refresh = async () => {
    if (document.visibilityState !== "visible") return;
    const next = await fetchLiveForecast();
    if (next) set(next);
  };
  void refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", refresh);
  };
});
