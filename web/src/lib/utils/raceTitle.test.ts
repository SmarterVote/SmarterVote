import { describe, expect, it } from "vitest";
import {
  candidateMetaDescription,
  candidatePageTitle,
  compareMetaDescription,
  comparePageTitle,
  raceDisplayTitle,
  raceMetaDescription,
  racePageTitle,
} from "./raceTitle";
import { STATE_NAMES_BY_CODE } from "./states";

describe("raceDisplayTitle", () => {
  it("normalizes Senate titles and special elections", () => {
    expect(
      raceDisplayTitle({
        id: "ga-senate-2026",
        title: "old",
        office: "United States Senate",
        state: "Georgia",
      }),
    ).toBe("2026 Georgia U.S. Senate Election");
    expect(
      raceDisplayTitle({
        id: "fl-senate-2026-special",
        title: "old",
        office: "U.S. Senate",
        state: "Florida",
      }),
    ).toBe("2026 Florida U.S. Senate Special Election");
  });

  it("normalizes House and governor titles", () => {
    expect(
      raceDisplayTitle({
        id: "ga-house-10-2026",
        title: "old",
        office: "U.S. House of Representatives",
        state: "Georgia",
      }),
    ).toBe("2026 Georgia's 10th Congressional District Election");
    expect(
      raceDisplayTitle({
        id: "wa-01-house-2026",
        title: "old",
        office: "U.S. Representative",
        state: "Washington",
      }),
    ).toBe("2026 Washington's 1st Congressional District Election");
    expect(
      raceDisplayTitle({
        id: "e2e-oh-house-05-2026",
        title: "old",
        office: "U.S. House",
        state: "Ohio",
        jurisdiction: "Ohio's 5th Congressional District",
      }),
    ).toBe("2026 Ohio's 5th Congressional District Election");
    expect(
      raceDisplayTitle({
        id: "de-house-at-large-2026",
        title: "old",
        office: "U.S. House",
        state: "Delaware",
      }),
    ).toBe("2026 Delaware's At-Large Congressional District Election");
    expect(
      raceDisplayTitle({
        id: "ga-governor-2026",
        title: "old",
        office: "Governor of Georgia",
        state: "Georgia",
      }),
    ).toBe("2026 Georgia Governor Election");
    expect(
      raceDisplayTitle({
        id: "md-governor-2026",
        title: "old",
        office: "Governor and Lieutenant Governor of Maryland",
        state: "Maryland",
      }),
    ).toBe("2026 Maryland Governor and Lieutenant Governor Election");
  });

  it("keeps unsupported offices' source title", () => {
    expect(
      raceDisplayTitle({
        id: "ar-supreme-court-2026",
        title: "Arkansas Supreme Court associate justice election, 2026",
        office: "Arkansas Supreme Court associate justice",
        state: "Arkansas",
      }),
    ).toBe("Arkansas Supreme Court associate justice election, 2026");
  });

  it("builds short voter-focused page titles", () => {
    expect(
      racePageTitle({
        id: "tx-senate-2026",
        office: "U.S. Senate",
        state: "Texas",
      }),
    ).toBe("Texas Senate race 2026 | Smarter.Vote");
    expect(
      racePageTitle({
        id: "tx-house-12-2026",
        office: "U.S. House",
        state: "Texas",
        district: "12th Congressional District",
      }),
    ).toBe("TX-12 House race 2026 | Smarter.Vote");
    expect(
      racePageTitle({
        id: "ak-house-2026",
        office: "U.S. House",
        state: "Alaska",
        district: "At-Large",
      }),
    ).toBe("AK-AL House race 2026 | Smarter.Vote");
    expect(
      racePageTitle({
        id: "oh-senate-2026-special",
        office: "U.S. Senate",
        state: "Ohio",
      }),
    ).toBe("Ohio Senate special election 2026 | Smarter.Vote");
    expect(
      racePageTitle({
        id: "ga-governor-2026",
        office: "Governor of Georgia",
        state: "Georgia",
      }),
    ).toBe("Georgia Governor race 2026 | Smarter.Vote");
    expect(
      comparePageTitle({
        id: "tx-senate-2026",
        office: "U.S. Senate",
        state: "Texas",
      }),
    ).toBe("Compare Texas Senate candidates 2026 | Smarter.Vote");
  });

  it("names the field in neutral display order in the race description", () => {
    const race = {
      id: "ga-senate-2026",
      title: "old",
      office: "U.S. Senate",
      state: "Georgia",
      election_date: "2026-11-03",
      // The independent is first in the roster, but the description names
      // candidates in display order: major-party candidates first, then
      // alphabetical by last name.
      candidates: [
        { name: "Alex Taylor", party: "Independent" },
        { name: "John Smith", party: "Republican" },
        { name: "Jane Doe", party: "Democratic" },
      ],
    };
    expect(raceMetaDescription(race)).toBe(
      "Compare Jane Doe (D), John Smith (R), and Alex Taylor (I) in the 2026 Georgia Senate race: sourced issue positions, polls and forecast.",
    );
    expect(
      raceMetaDescription({ ...race, candidates: [race.candidates[1]] }),
    ).toBe(
      "John Smith (R) is the only candidate in the 2026 Georgia Senate race. Sourced profile, positions and voter resources. Election Day: Nov 3, 2026.",
    );
  });

  it("describes researched candidates by the issues covered", () => {
    const race = {
      id: "ga-senate-2026",
      office: "U.S. Senate",
      state: "Georgia",
    };
    expect(
      candidateMetaDescription(
        {
          name: "Jane Doe",
          party: "Democratic",
          summary: "Candidate biography",
          issues: {
            Healthcare: {
              stance: "Supports a policy.",
              sources: [],
              confidence: "high",
            },
            Economy: {
              stance: "Supports another policy.",
              sources: [],
              confidence: "medium",
            },
            Immigration: {
              stance: "Supports a third policy.",
              sources: [],
              confidence: "medium",
            },
          },
          donor_summary: "Donor summary",
        },
        race,
      ),
    ).toBe(
      "Jane Doe (D) in the 2026 Georgia Senate race: sourced positions on Healthcare, Economy and 1 more issue, plus top donors.",
    );
    expect(
      candidatePageTitle({ name: "Jane Doe", party: "Democratic" }, race),
    ).toBe("Jane Doe (D) – Georgia Senate 2026 | Smarter.Vote");
  });

  it("describes discovery-only candidates by party, incumbency and office", () => {
    const race = {
      id: "tx-house-12-2026",
      office: "U.S. House",
      state: "Texas",
      district: "12",
    };
    const markerOnly = {
      Healthcare: {
        stance: "No public position found",
        sources: [],
        confidence: "low" as const,
      },
      Economy: {
        stance: "No specific public position was identified on tax policy.",
        sources: [],
        confidence: "low" as const,
      },
    };
    expect(
      candidateMetaDescription(
        {
          name: "Jane Doe",
          party: "Republican",
          incumbent: true,
          issues: markerOnly,
        },
        race,
      ),
    ).toBe(
      "Jane Doe is the Republican incumbent in the 2026 House race in TX-12 (Texas 12th District).",
    );
    expect(
      candidateMetaDescription(
        { name: "Sam Roe", party: "Independent", summary: "Bio" },
        race,
      ),
    ).toBe(
      "Sam Roe is an independent candidate in the 2026 House race in TX-12 (Texas 12th District). See background and campaign links.",
    );
    expect(candidateMetaDescription({ name: "Jane Doe" }, race)).not.toMatch(
      /biography|cited sources/,
    );
  });

  it("keeps every title within 60 and every description within 155 characters", () => {
    const names = [
      "Jo Li",
      "Maxwell Alejandro Frost",
      "Alexandria Ocasio-Cortez",
      'Robert Francis "Beto" O\'Rourke-Villanueva III',
      "Christopher Jonathan Montgomery-Fitzgerald Jr.",
    ];
    const parties = [
      "Democratic",
      "Republican",
      "Working Class Party",
      "Independent",
      undefined,
    ];
    const issues = Object.fromEntries(
      [
        "Healthcare",
        "Economy",
        "Climate/Energy",
        "Abortion & Reproductive Health",
        "Firearms & Second Amendment",
      ].map((key) => [
        key,
        {
          stance: "Supports a policy.",
          sources: [],
          confidence: "high" as const,
        },
      ]),
    );
    const races = Object.entries(STATE_NAMES_BY_CODE).flatMap(
      ([code, state]) => [
        { id: `${code}-senate-2026`, office: "U.S. Senate", state },
        { id: `${code}-senate-2026-special`, office: "U.S. Senate", state },
        { id: `${code}-house-14-2026`, office: "U.S. House", state },
        {
          id: `${code}-governor-2026`,
          office: "Governor and Lieutenant Governor",
          state,
        },
        {
          id: `${code}-supreme-court-2026`,
          office: "Supreme Court associate justice",
          title: `${state} Supreme Court associate justice position 3 nonpartisan election, 2026`,
          state,
        },
      ],
    );
    for (const base of races) {
      const race = {
        ...base,
        election_date: "2026-11-03",
        candidates: names.map((name, index) => ({
          name,
          party: parties[index],
        })),
      };
      expect(racePageTitle(race).length).toBeLessThanOrEqual(60);
      expect(comparePageTitle(race).length).toBeLessThanOrEqual(60);
      expect(raceMetaDescription(race).length).toBeLessThanOrEqual(155);
      expect(compareMetaDescription(race).length).toBeLessThanOrEqual(155);
      names.forEach((name, index) => {
        const candidate = {
          name,
          party: parties[index],
          incumbent: index === 1,
        };
        expect(candidatePageTitle(candidate, race).length).toBeLessThanOrEqual(
          60,
        );
        expect(
          candidateMetaDescription(candidate, race).length,
        ).toBeLessThanOrEqual(155);
        expect(
          candidateMetaDescription(
            { ...candidate, issues, donor_summary: "x", voting_summary: "y" },
            race,
          ).length,
        ).toBeLessThanOrEqual(155);
      });
    }
  });
});
