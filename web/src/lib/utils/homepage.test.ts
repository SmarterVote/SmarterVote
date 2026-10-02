import { describe, expect, it } from "vitest";
import type { RaceSummary } from "$lib/types";
import {
  featuredHomepageRaceIds,
  nationalElectionRaces,
  toFeaturedComparisonRace,
} from "./homepage";

const race = (id: string, updated: string, state = "Iowa"): RaceSummary => ({
  id,
  election_date: "2026-11-03",
  updated_utc: updated,
  state,
  candidates: [
    { name: "Alex Example", incumbent: false },
    { name: "alex example", incumbent: false },
    { name: "Jordan Example", incumbent: false },
  ],
});

describe("homepage data", () => {
  it("keeps Texas Senate first in the curated featured races", () => {
    expect(featuredHomepageRaceIds).toEqual([
      "tx-senate-2026",
      "me-senate-2026",
      "nv-governor-2026",
      "co-house-08-2026",
      "ia-senate-2026",
    ]);
  });

  it("keeps federal and gubernatorial contests in launch coverage", () => {
    const federal = {
      ...race("house", "2026-01-01T00:00:00Z"),
      office: "U.S. House of Representatives",
    };
    const state = {
      ...race("governor", "2026-01-01T00:00:00Z"),
      office: "Governor of Iowa",
    };
    expect(nationalElectionRaces([state, federal])).toEqual([state, federal]);
  });
});

describe("toFeaturedComparisonRace", () => {
  const full = JSON.parse(
    JSON.stringify({
      id: "tx-senate-2026",
      title: "2026 Texas U.S. Senate Election",
      office: "U.S. Senate",
      jurisdiction: "Texas",
      state: "Texas",
      election_date: "2026-11-03",
      updated_utc: "2026-09-01T00:00:00Z",
      contest_stage: "general",
      schema_version: "0.3",
      generator: ["x"],
      polling: [{ pollster: "P", matchups: [] }],
      reviews: [{ model: "m", verdict: "approved" }],
      pipeline_state: { complete: true },
      run_audit: { steps: [] },
      validation_grade: { grade: "A", score: 93, passed: true },
      forecast: {
        predicted_winner_name: "Jane Doe",
        predicted_winner_party: "Democratic",
        win_probability: 0.57,
        party_probabilities: { Democratic: 0.57, Republican: 0.43 },
        rating: "tilt_d",
        rationale: "Long rationale",
        key_reasons: ["a"],
        source_urls: ["https://example.com"],
      },
      candidates: [
        {
          name: "Jane Doe",
          party: "Democratic",
          incumbent: false,
          withdrawn: false,
          image_url: "https://example.com/jane.jpg",
          summary: "Summary",
          summary_sources: [{ url: "https://example.com/s" }],
          roster_sources: [{ url: "https://example.com/r" }],
          website: "https://jane.example",
          social_media: { x: "https://x.com/jane" },
          links: [{ url: "https://example.com/l" }],
          issues: {
            Healthcare: {
              issue: "Healthcare",
              stance: "Supports X.",
              confidence: "high",
              research_audit: { attempts: 3 },
              sources: [
                {
                  url: "https://example.com/h",
                  title: "Health plan",
                  type: "website",
                  description: "long",
                  last_accessed: "2026-01-01",
                  checksum: "abc",
                  is_fresh: false,
                },
              ],
            },
          },
          career_history: [{ title: "Teacher" }],
          education: [{ institution: "UT" }],
          donor_summary: "Donors",
          donor_source_url: "https://fec.gov/x",
          donor_sources: [{ url: "https://fec.gov/y" }],
          voting_summary: "Votes",
          voting_source_url: "https://congress.gov/x",
          voting_sources: [{ url: "https://congress.gov/y" }],
        },
      ],
    }),
  );

  it("keeps what the homepage comparison renders and drops the rest", () => {
    const compact = toFeaturedComparisonRace(full);
    expect(compact).not.toHaveProperty("reviews");
    expect(compact).not.toHaveProperty("polling");
    expect(compact).not.toHaveProperty("pipeline_state");
    expect(compact).not.toHaveProperty("run_audit");
    expect(compact.validation_grade).toEqual(full.validation_grade);
    expect(compact.forecast).toEqual({
      predicted_winner_name: "Jane Doe",
      predicted_winner_party: "Democratic",
      win_probability: 0.57,
      party_probabilities: { Democratic: 0.57, Republican: 0.43 },
      rating: "tilt_d",
    });
    const [candidate] = compact.candidates;
    expect(candidate).not.toHaveProperty("roster_sources");
    expect(candidate).not.toHaveProperty("summary_sources");
    expect(candidate).not.toHaveProperty("social_media");
    expect(candidate.summary).toBe("Summary");
    expect(candidate.donor_summary).toBe("Donors");
    expect(candidate.voting_source_url).toBe("https://congress.gov/x");
    expect(candidate.career_history).toEqual([{ title: "Teacher" }]);
    expect(candidate.issues.Healthcare).toEqual({
      issue: "Healthcare",
      stance: "Supports X.",
      confidence: "high",
      sources: [
        { url: "https://example.com/h", title: "Health plan", type: "website" },
      ],
    });
  });
});
