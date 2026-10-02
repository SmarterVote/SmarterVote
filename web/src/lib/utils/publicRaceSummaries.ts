import type { RaceForecast, RaceSummary } from "$lib/types";

/**
 * Keep directory and ballot payloads limited to fields their cards, filters,
 * and race picker use. Forecast rationale and pipeline metrics can dominate the
 * published summary index and do not belong in those pages' serialized data.
 */
export function toDirectoryRaceSummaries(races: RaceSummary[]): RaceSummary[] {
  return races.map((race) => ({
    id: race.id,
    title: race.title,
    office: race.office,
    jurisdiction: race.jurisdiction,
    state: race.state,
    contest_stage: race.contest_stage,
    election_date: race.election_date,
    updated_utc: race.updated_utc,
    candidates: race.candidates,
  }));
}

/** First sentence of a rationale, the collapsed card's fallback takeaway. */
function firstSentence(text: string | undefined): string | undefined {
  const sentence = text?.split(/[.!?]/)[0]?.trim();
  return sentence ? `${sentence}.` : undefined;
}

/**
 * The forecast fields the collapsed race cards, map tooltips, key races and
 * chamber aggregates read. The analysis drawer's long fields (rationale, key
 * reasons, uncertainty, market signals, sources, model panel, evidence
 * lineage) are fetched from the race file when a card is expanded, so they
 * stay out of the page's serialized data.
 */
export function toForecastSummary(
  forecast: RaceForecast | null | undefined,
): RaceForecast | null | undefined {
  if (!forecast) return forecast;
  const compact: Partial<RaceForecast> = {
    predicted_winner_name: forecast.predicted_winner_name,
    predicted_winner_party: forecast.predicted_winner_party,
    win_probability: forecast.win_probability,
    party_probabilities: forecast.party_probabilities,
    margin_estimate: forecast.margin_estimate,
    rating: forecast.rating,
    takeaway: forecast.takeaway || firstSentence(forecast.rationale),
    based_on_poll_count: forecast.based_on_poll_count,
  };
  // Drop absent keys so the payload carries no `undefined` placeholders.
  return Object.fromEntries(
    Object.entries(compact).filter(([, value]) => value !== undefined),
  ) as unknown as RaceForecast;
}

/**
 * Forecast page payload: the race identity fields, a slim roster (party is
 * all the projections read; photos are not shown), and the compact forecast.
 * Internal pipeline cost metadata is never included.
 */
export function toForecastRaceSummaries(races: RaceSummary[]): RaceSummary[] {
  return races.map((race) => ({
    id: race.id,
    title: race.title,
    office: race.office,
    jurisdiction: race.jurisdiction,
    state: race.state,
    contest_stage: race.contest_stage,
    election_date: race.election_date,
    updated_utc: race.updated_utc,
    candidates: (race.candidates ?? []).map((candidate) => ({
      name: candidate.name,
      party: candidate.party,
      incumbent: candidate.incumbent,
    })),
    ...(race.forecast ? { forecast: toForecastSummary(race.forecast) } : {}),
  }));
}
