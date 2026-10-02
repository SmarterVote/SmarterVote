import type {
  Candidate,
  IssueStance,
  Race,
  RaceSummary,
  Source,
} from "$lib/types";
import { toDirectoryRaceSummaries } from "./publicRaceSummaries";

// Editorial order for the homepage. Keep this list explicit so publishing or
// refreshing another race does not unexpectedly change the featured section.
export const featuredHomepageRaceIds = [
  "tx-senate-2026",
  "me-senate-2026",
  "nv-governor-2026",
  "co-house-08-2026",
  "ia-senate-2026",
] as const;

export function nationalElectionRaces(races: RaceSummary[]): RaceSummary[] {
  return races.filter((race) => {
    const office = race.office?.toLocaleLowerCase() ?? "";
    return (
      office.includes("united states") ||
      office.includes("u.s.") ||
      office.includes("president") ||
      office.includes("governor") ||
      office.includes("gubernatorial")
    );
  });
}

/** National races trimmed to the fields the directory and ballot pages use. */
export function directoryRaces(races: RaceSummary[]): RaceSummary[] {
  return toDirectoryRaceSummaries(nationalElectionRaces(races));
}

/** Source fields a comparison cell's source link renders. */
function compactSource(source: Source): Source {
  return {
    url: source.url,
    title: source.title,
    type: source.type,
    ...(source.is_official_campaign !== undefined
      ? { is_official_campaign: source.is_official_campaign }
      : {}),
  } as Source;
}

function compactStance(stance: IssueStance): IssueStance {
  return {
    issue: stance.issue,
    stance: stance.stance,
    confidence: stance.confidence,
    sources: (stance.sources ?? []).map(compactSource),
  };
}

function compactCandidate(candidate: Candidate): Candidate {
  return {
    name: candidate.name,
    party: candidate.party,
    incumbent: candidate.incumbent,
    withdrawn: candidate.withdrawn,
    image_url: candidate.image_url,
    summary: candidate.summary,
    website: candidate.website,
    issues: Object.fromEntries(
      Object.entries(candidate.issues ?? {}).map(([key, stance]) => [
        key,
        stance ? compactStance(stance) : stance,
      ]),
    ),
    career_history: candidate.career_history,
    education: candidate.education,
    donor_summary: candidate.donor_summary,
    donor_source_url: candidate.donor_source_url,
    voting_summary: candidate.voting_summary,
    voting_source_url: candidate.voting_source_url,
  } as Candidate;
}

/**
 * A featured homepage race reduced to what the homepage comparison
 * (InteractiveRaceCompare -> CandidateComparison / MobileCandidateComparison)
 * renders: identity and grade, the forecast fields behind the per-candidate
 * win probability, and each candidate's photo, summary, stances with source
 * links, background and finance/voting summaries. Reviews, polling, pipeline
 * state, run audits and source metadata stay out of the serialized page.
 */
export function toFeaturedComparisonRace(race: Race): Race {
  const forecast = race.forecast;
  return {
    id: race.id,
    title: race.title,
    office: race.office,
    jurisdiction: race.jurisdiction,
    state: race.state,
    district: race.district,
    election_date: race.election_date,
    updated_utc: race.updated_utc,
    contest_stage: race.contest_stage,
    validation_grade: race.validation_grade,
    ...(forecast
      ? {
          forecast: {
            predicted_winner_name: forecast.predicted_winner_name,
            predicted_winner_party: forecast.predicted_winner_party,
            win_probability: forecast.win_probability,
            party_probabilities: forecast.party_probabilities,
            rating: forecast.rating,
          },
        }
      : {}),
    candidates: (race.candidates ?? []).map(compactCandidate),
  } as Race;
}
