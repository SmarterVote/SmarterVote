import { describe, expect, it } from "vitest";
import type { Candidate, Race, RaceForecast } from "$lib/types";
import {
  candidateForecastProbability,
  candidateJsonLd,
  candidateShareImage,
  contestStageNotice,
  isPreviousCyclePoll,
  isUncontestedRace,
  pollAgeLabel,
  politicalPartyName,
  senateSeatLabel,
  cleanDisplayText,
  comparePreview,
  forecastHeadline,
  formatPollDate,
  formatWinProbability,
  pollDateLabel,
  isNoPositionStance,
  isNotFoundError,
  jsonLdScript,
  partyProbabilityAriaLabel,
  partyProbabilitySegments,
  raceJsonLd,
  raceLocationLabel,
  resolveCandidate,
  selectComparedCandidates,
  sortPollsByDate,
  splitSentences,
  splitSourcedText,
  tidySpacing,
  unescapeLeakedJson,
} from "./racePage";

function candidate(name: string, overrides: Partial<Candidate> = {}) {
  return {
    name,
    incumbent: false,
    withdrawn: false,
    ...overrides,
  } as Candidate;
}

function forecast(overrides: Partial<RaceForecast> = {}): RaceForecast {
  return {
    party_probabilities: {},
    rating: "lean_d",
    confidence: "medium",
    rationale: "",
    key_reasons: [],
    based_on_poll_count: 0,
    generated_at: "2026-01-01T00:00:00Z",
    model: "test",
    source_urls: [],
    market_signals: [],
    ...overrides,
  };
}

describe("sortPollsByDate", () => {
  it("orders newest first with undated polls last", () => {
    const polls = [
      { pollster: "Old", date: "2026-03-01" },
      { pollster: "Undated" },
      { pollster: "New", date: "2026-09-14" },
      { pollster: "Middle", date: "2026-06-30T00:00:00Z" },
    ];
    expect(sortPollsByDate(polls).map((p) => p.pollster)).toEqual([
      "New",
      "Middle",
      "Old",
      "Undated",
    ]);
  });

  it("does not mutate its input", () => {
    const polls = [{ date: "2026-01-01" }, { date: "2026-02-01" }];
    sortPollsByDate(polls);
    expect(polls[0].date).toBe("2026-01-01");
  });
});

describe("formatPollDate", () => {
  // `new Date("2026-09-14")` is midnight UTC, i.e. Sept 13 in US time zones.
  it("keeps a date-only string on its calendar day", () => {
    expect(formatPollDate("2026-09-14")).toBe("Sep 14, 2026");
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatPollDate(undefined)).toBe("");
    expect(formatPollDate("sometime")).toBe("");
  });
});

describe("isNotFoundError", () => {
  it("recognises 404/410 responses", () => {
    expect(isNotFoundError(new Error("Static data request failed: 404"))).toBe(
      true,
    );
    expect(isNotFoundError(new Error("Failed to fetch draft race: 410"))).toBe(
      true,
    );
    expect(isNotFoundError(new Error("Static data request failed: 500"))).toBe(
      false,
    );
  });
});

describe("forecastHeadline", () => {
  it("names the predicted winner when known", () => {
    expect(
      forecastHeadline(forecast({ predicted_winner_name: "Jane Doe" })).title,
    ).toBe("Jane Doe favored");
  });

  it("uses the real party label, including third parties", () => {
    expect(
      forecastHeadline(forecast({ predicted_winner_party: "Independent" })),
    ).toEqual({
      title: "Independent candidate favored",
      leader: "Independent candidate",
    });
  });

  // It must not guess a party from the incumbent or from D/R probabilities.
  it("stays neutral when the forecast names no winner", () => {
    expect(
      forecastHeadline(
        forecast({ party_probabilities: { Democratic: 0.7, Republican: 0.3 } }),
      ),
    ).toEqual({ title: "No clear favorite", leader: null });
  });

  it("calls a toss-up a toss-up", () => {
    expect(
      forecastHeadline(
        forecast({ rating: "tossup", predicted_winner_name: "Jane Doe" }),
      ).title,
    ).toBe("Toss-up");
  });
});

describe("partyProbabilitySegments", () => {
  it("includes every positive party, largest first, with party colours", () => {
    const segments = partyProbabilitySegments({
      Republican: 0.3,
      Democratic: 0.6,
      Independent: 0.1,
      Green: 0,
    });
    expect(segments.map((s) => [s.party, s.key, s.label])).toEqual([
      ["Democratic", "dem", "60%"],
      ["Republican", "rep", "30%"],
      ["Independent", "ind", "10%"],
    ]);
    expect(partyProbabilityAriaLabel(segments)).toBe(
      "Party win probabilities: Democratic 60%, Republican 30%, Independent 10%",
    );
  });
});

describe("candidateForecastProbability", () => {
  const dem = candidate("Ann Alpha", { party: "Democratic" });
  const rep = candidate("Bo Beta", { party: "Republican" });

  it("matches a party probability by canonical key", () => {
    expect(
      candidateForecastProbability(
        dem,
        forecast({ party_probabilities: { D: 0.4 } }),
        [dem, rep],
      ),
    ).toBe(0.4);
  });

  it("returns nothing for an empty party", () => {
    const blank = candidate("No Party", { party: "" });
    expect(
      candidateForecastProbability(
        blank,
        forecast({ party_probabilities: { Democratic: 0.4 } }),
        [blank],
      ),
    ).toBeUndefined();
  });

  it("returns nothing when another active candidate shares the party", () => {
    const dem2 = candidate("Cy Gamma", { party: "Democrat" });
    expect(
      candidateForecastProbability(
        dem,
        forecast({ party_probabilities: { Democratic: 0.9 } }),
        [dem, dem2],
      ),
    ).toBeUndefined();
  });
});

describe("candidateForecastProbability null win probability", () => {
  it("normalizes a null predicted-winner probability to undefined", () => {
    const dem = candidate("Ann Alpha", { party: "Democratic" });
    expect(
      candidateForecastProbability(
        dem,
        forecast({
          predicted_winner_name: "Ann Alpha",
          win_probability: null as unknown as number,
        }),
        [dem],
      ),
    ).toBeUndefined();
  });
});

describe("resolveCandidate", () => {
  const race = {
    candidates: [
      candidate("José Peña", { party: "Independent" }),
      candidate("Jane Doe", { party: "Democratic" }),
      candidate("Gone Away", { withdrawn: true }),
    ],
  };

  it("resolves the canonical slug", () => {
    const resolved = resolveCandidate(race, "jose-pena");
    expect(resolved.candidate?.name).toBe("José Peña");
    expect(resolved.isLegacySlug).toBe(false);
    expect(resolved.others.map((c) => c.name)).toEqual(["Jane Doe"]);
  });

  it("accepts a legacy slug and reports the canonical one", () => {
    const resolved = resolveCandidate(race, "jos-pe-a");
    expect(resolved.candidate?.name).toBe("José Peña");
    expect(resolved.isLegacySlug).toBe(true);
    expect(resolved.canonicalSlug).toBe("jose-pena");
  });

  it("returns no candidate for an unknown slug", () => {
    expect(resolveCandidate(race, "nobody").candidate).toBeNull();
  });
});

describe("selectComparedCandidates", () => {
  const race = {
    candidates: [
      candidate("José Peña", { party: "Independent" }),
      candidate("Jane Doe", { party: "Democratic" }),
      candidate("John Roe", { party: "Republican" }),
    ],
  };

  it("accepts legacy slugs in ?candidates=", () => {
    expect(
      selectComparedCandidates(race, "jos-pe-a,jane-doe").map((c) => c.name),
    ).toEqual(["Jane Doe", "José Peña"]);
  });

  it("falls back to every active candidate", () => {
    expect(selectComparedCandidates(race, null)).toHaveLength(3);
    expect(selectComparedCandidates(race, "nobody")).toHaveLength(3);
  });
});

describe("raceJsonLd", () => {
  const race = {
    id: "ga-senate-2026",
    title: "Georgia Senate",
    office: "U.S. Senate",
    state: "Georgia",
    jurisdiction: "Georgia",
    election_date: "2026-11-03",
    forecast: forecast({ predicted_winner_name: "Jane Doe" }),
    candidates: [
      candidate("Jane Doe", { party: "Democratic" }),
      candidate("Gone Away", { withdrawn: true }),
    ],
  } as unknown as Race;

  it("describes the page with an Elections › Race breadcrumb and no ratings", () => {
    const data = raceJsonLd(race);
    const graph = data["@graph"] as Record<string, unknown>[];
    expect(graph[0]["@type"]).toBe("WebPage");
    expect(graph[0].url).toBe("https://smarter.vote/races/ga-senate-2026/");
    expect(graph[1]).toEqual({
      "@type": "BreadcrumbList",
      "@id": "https://smarter.vote/races/ga-senate-2026/#breadcrumb",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Elections",
          item: "https://smarter.vote/elections/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "2026 Georgia U.S. Senate Election",
          item: "https://smarter.vote/races/ga-senate-2026/",
        },
      ],
    });
    const json = JSON.stringify(data);
    expect(json).not.toContain("Event");
    expect(json).not.toContain("performer");
    expect(json).not.toContain("lean_d");
  });

  it("escapes markup so the script tag cannot be closed early", () => {
    const html = jsonLdScript({ name: "</script><script>alert(1)" });
    expect(html).not.toContain("</script><script>");
    expect(html.endsWith("</script>")).toBe(true);
  });
});

describe("cleanDisplayText", () => {
  it("unescapes leaked JSON quotes and unicode escapes", () => {
    expect(
      cleanDisplayText('Backs a public option (\\"Medicare for Y\\\'all\\").'),
    ).toBe('Backs a public option ("Medicare for Y\'all").');
    expect(cleanDisplayText("Alaska\\u2019s universities")).toBe(
      "Alaska\u2019s universities",
    );
  });

  it("drops URL-only citations but keeps other parentheticals", () => {
    expect(
      cleanDisplayText(
        "He won in 2024 (https://a.gov/x; https://b.com/y). He serves (since 2025).",
      ),
    ).toBe("He won in 2024. He serves (since 2025).");
  });

  it("returns an empty string for missing text", () => {
    expect(cleanDisplayText(undefined)).toBe("");
    expect(cleanDisplayText(null)).toBe("");
  });
});

describe("splitSentences", () => {
  it("does not split on titles, initials, or abbreviated months", () => {
    expect(
      splitSentences(
        "Gov. Mike DeWine appointed J.D. Vance's successor on Aug. 6. Sen. Brown ran again. The U.S. Senate race is close.",
      ),
    ).toEqual([
      "Gov. Mike DeWine appointed J.D. Vance's successor on Aug. 6.",
      "Sen. Brown ran again.",
      "The U.S. Senate race is close.",
    ]);
  });
});

describe("splitSourcedText", () => {
  const text =
    "First point about the race (https://www.ohiosos.gov/a; https://news.example.com/b). " +
    "Second point adds context about the candidates in the field. " +
    "Third point covers polling (https://news.example.com/b). Fourth point closes.";

  it("collects cited URLs once, labelled by hostname", () => {
    expect(splitSourcedText(text).sources).toEqual([
      { url: "https://www.ohiosos.gov/a", label: "ohiosos.gov" },
      { url: "https://news.example.com/b", label: "news.example.com" },
    ]);
  });

  it("removes the inline URLs and splits long prose into paragraphs", () => {
    const { paragraphs } = splitSourcedText(text, 80);
    expect(paragraphs.join(" ")).not.toContain("http");
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs[0].startsWith("First point about the race.")).toBe(true);
  });

  it("keeps short text as one paragraph", () => {
    expect(splitSourcedText("Just one sentence.").paragraphs).toEqual([
      "Just one sentence.",
    ]);
    expect(splitSourcedText(undefined)).toEqual({
      paragraphs: [],
      sources: [],
    });
  });
});

describe("raceLocationLabel", () => {
  it('drops a district the data spelled as the string "null"', () => {
    expect(
      raceLocationLabel({
        office: "Governor of Massachusetts",
        district: "null",
        jurisdiction: "Massachusetts",
      }),
    ).toBe("Governor of Massachusetts");
  });

  it("does not repeat the same place twice", () => {
    expect(
      raceLocationLabel({
        office: "United States Senate",
        district: "Ohio",
        jurisdiction: "Ohio",
      }),
    ).toBe("United States Senate · Ohio");
  });

  it("drops a district already named by the jurisdiction", () => {
    expect(
      raceLocationLabel({
        office: "United States House of Representatives",
        district: "10th Congressional District",
        jurisdiction: "Florida's 10th Congressional District",
      }),
    ).toBe(
      "United States House of Representatives · Florida's 10th Congressional District",
    );
  });
});

describe("comparePreview", () => {
  it("keeps short text verbatim", () => {
    expect(comparePreview("Short stance.")).toBe("Short stance.");
  });

  it("previews whole sentences up to the limit", () => {
    const sentence =
      "This sentence is about sixty characters long, give or take.";
    const text = Array.from({ length: 8 }, () => sentence).join(" ");
    const preview = comparePreview(text, 200);
    expect(preview.length).toBeLessThanOrEqual(200);
    expect(preview.endsWith(".")).toBe(true);
  });

  it("hard-caps a single run-on sentence at a word boundary", () => {
    const text = `${"word ".repeat(120).trim()}.`;
    const preview = comparePreview(text, 100);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(101);
  });
});

describe("isNoPositionStance", () => {
  it("recognises the pipeline marker", () => {
    expect(isNoPositionStance("No public position found")).toBe(true);
    expect(isNoPositionStance("No public position found.")).toBe(true);
    expect(isNoPositionStance("Supports expanding coverage.")).toBe(false);
  });

  // Wordings seen in published data (audit 4, data/findings.json).
  it.each([
    "No specific public position was identified on election administration, voting access, ballot rules, election security, or campaign-finance regulation.",
    "No public stance found on immigration publicly stated by Eric Michael Foreman as of latest credible sources; Libertarian platforms generally advocate fewer restrictions.",
    "No publicly stated stance found in campaign materials as of latest available sources.",
    "No public position could be found.",
    "No public stance published on Tech & AI by Eric Foreman's campaign.",
    "No public foreign policy position is stated on Stefany Shaheen's official campaign materials.",
    "No specific public position published after August 24, 2026 was found on district-specific local issues.",
    "No public position on technology or artificial intelligence was located in Meline's campaign materials.",
    "no publicly stated position on technology and artificial intelligence policy found.",
    "No explicit public position on healthcare policy is published on the candidate's official channels.",
  ])("recognises the variant %j", (stance) => {
    expect(isNoPositionStance(stance)).toBe(true);
  });

  it.each([
    "Supports a public option. No public position found on drug pricing.",
    "No newer healthcare position was found after August 26, 2026. In a 2018 questionnaire, she backed a public option.",
    "No explicit Tech & AI policy is listed on the campaign issues page. In Congress, she serves on the Cyber subcommittee.",
    "No to new taxes: opposes any public position that raises rates.",
  ])("does not swallow the substantive stance %j", (stance) => {
    expect(isNoPositionStance(stance)).toBe(false);
  });
});

describe("cleanDisplayText regex safety", () => {
  it("strips multi-URL citation groups", () => {
    expect(
      cleanDisplayText(
        "Seat is open (https://a.gov/x; https://b.com/y). Next.",
      ),
    ).toBe("Seat is open. Next.");
  });

  it("stays linear on adversarial citation-like input", () => {
    const evil = "(http://" + "!http://".repeat(5000);
    const start = performance.now();
    cleanDisplayText(evil);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("poll dates that are not plain ISO days", () => {
  it("reads a fieldwork range as its end date", () => {
    expect(formatPollDate("2026-09-12 to 2026-09-15")).toBe("Sep 15, 2026");
    expect(pollDateLabel("2026-09-12 to 2026-09-15")).toBe("Sep 15, 2026");
  });

  it("parses a written-out date", () => {
    expect(formatPollDate("Sep 14, 2026")).toBe("Sep 14, 2026");
    expect(formatPollDate("September 10 – September 13, 2026")).toBe(
      "Sep 13, 2026",
    );
  });

  it("shows unreadable dates as written instead of dropping them", () => {
    expect(pollDateLabel("Mid-September")).toBe("Mid-September");
    expect(pollDateLabel(undefined)).toBe("");
    expect(pollDateLabel("   ")).toBe("");
  });

  it("sorts ranges and written dates with ISO dates", () => {
    const polls = [
      { pollster: "A", date: "2026-09-01" },
      { pollster: "Range", date: "2026-09-12 to 2026-09-15" },
      { pollster: "Written", date: "Sep 14, 2026" },
      { pollster: "Unknown", date: "soon" },
    ];
    expect(sortPollsByDate(polls).map((p) => p.pollster)).toEqual([
      "Range",
      "Written",
      "A",
      "Unknown",
    ]);
  });
});

describe("formatWinProbability", () => {
  it("never rounds to certainty", () => {
    expect(formatWinProbability(0.996)).toBe(">99%");
    expect(formatWinProbability(1)).toBe(">99%");
    expect(formatWinProbability(0.004)).toBe("<1%");
    expect(formatWinProbability(0)).toBe("<1%");
  });

  it("rounds everything else to a whole percent", () => {
    expect(formatWinProbability(0.994)).toBe("99%");
    expect(formatWinProbability(0.625)).toBe("63%");
    expect(formatWinProbability(0.005)).toBe("1%");
  });

  it("reports missing values", () => {
    expect(formatWinProbability(undefined)).toBe("n/a");
    expect(formatWinProbability(null)).toBe("n/a");
    expect(formatWinProbability(Number.NaN)).toBe("n/a");
  });
});

describe("raceJsonLd description", () => {
  const race = {
    id: "oh-senate-2026",
    title: "Ohio Senate",
    election_date: "2026-11-03",
    description:
      "Open seat (https://www.ohiosos.gov/a; https://news.example.com/b). Next.",
    candidates: [candidate("Jane Doe")],
  } as unknown as Race;

  it("uses the cleaned description without inline URLs", () => {
    const page = (raceJsonLd(race)["@graph"] as Record<string, unknown>[])[0];
    expect(page.description).toBe("Open seat. Next.");
  });
});

describe("candidateJsonLd", () => {
  const race = {
    id: "tx-house-12-2026",
    office: "U.S. House",
    state: "Texas",
    district: "12",
    updated_utc: "2026-09-30T00:00:00Z",
    candidates: [],
  } as unknown as Race;

  it("is a ProfilePage about the candidate with a three-level breadcrumb", () => {
    const data = candidateJsonLd(
      race,
      candidate("José Peña", {
        party: "Republican",
        image_url:
          "https://upload.wikimedia.org/wikipedia/commons/a/ab/Jose.jpg",
        website: "https://pena.example.com",
        social_media: { x: "https://x.com/pena", bad: "javascript:alert(1)" },
      }),
    );
    const [page, crumbs] = data["@graph"] as Record<string, unknown>[];
    expect(page["@type"]).toBe("ProfilePage");
    expect(page.mainEntity).toEqual({
      "@type": "Person",
      name: "José Peña",
      url: "https://smarter.vote/races/tx-house-12-2026/jose-pena/",
      image:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Jose.jpg/250px-Jose.jpg",
      affiliation: { "@type": "PoliticalParty", name: "Republican Party" },
      sameAs: ["https://pena.example.com", "https://x.com/pena"],
    });
    expect(
      (crumbs.itemListElement as { name: string }[]).map((item) => item.name),
    ).toEqual([
      "Elections",
      "2026 Texas's 12th Congressional District Election",
      "José Peña",
    ]);
  });

  it("leaves independents without a party and escapes markup", () => {
    const data = candidateJsonLd(
      race,
      candidate("</script><b>", { party: "Independent" }),
    );
    const page = (data["@graph"] as Record<string, unknown>[])[0];
    expect(page.mainEntity).not.toHaveProperty("affiliation");
    expect(jsonLdScript(data)).not.toContain("</script><b>");
  });

  it.each([
    ["Democratic", "Democratic Party"],
    ["Green Party", "Green Party"],
    ["Working Families", "Working Families Party"],
    ["Unaffiliated", null],
    ["", null],
  ])("party %j -> %j", (party, expected) => {
    expect(politicalPartyName(party)).toBe(expected);
  });
});

describe("candidateShareImage", () => {
  it("uses a known-good headshot as a summary card", () => {
    expect(
      candidateShareImage({
        image_url:
          "https://s3.amazonaws.com/ballotpedia-api4/files/thumbs/200/300/Jane.jpg",
      }),
    ).toEqual({
      image:
        "https://s3.amazonaws.com/ballotpedia-api4/files/thumbs/200/300/Jane.jpg",
      card: "summary",
    });
  });

  it.each([
    undefined,
    "https://campaign.example.com/photo.jpg",
    "http://upload.wikimedia.org/x.jpg",
  ])("falls back to the site image for %j", (image_url) => {
    expect(candidateShareImage({ image_url })).toEqual({
      image: "https://smarter.vote/og-image.png",
      card: "summary_large_image",
    });
  });
});

describe("poll age and cycle", () => {
  const now = new Date(2026, 9, 1);
  it("labels polls older than 60 days", () => {
    expect(pollAgeLabel("2026-09-01", now)).toBe("");
    expect(pollAgeLabel("2026-07-01", now)).toBe("3 months old");
    expect(pollAgeLabel("2025-09-01", now)).toBe("over a year old");
    expect(pollAgeLabel("2024-07-21", now)).toBe("over 2 years old");
    expect(pollAgeLabel(undefined, now)).toBe("");
  });

  it("treats polls 18+ months before Election Day as a previous cycle", () => {
    expect(isPreviousCyclePoll("2024-07-21", "2026-11-03")).toBe(true);
    expect(isPreviousCyclePoll("2025-05-02", "2026-11-03")).toBe(true);
    expect(isPreviousCyclePoll("2025-12-19", "2026-11-03")).toBe(false);
    expect(isPreviousCyclePoll("2024-07-21", undefined)).toBe(false);
  });
});

describe("contest stage", () => {
  const base = {
    id: "fl-house-10-2026",
    office: "U.S. House",
    state: "Florida",
    contest_stage: "post_primary_general",
  } as Race;
  const one = [{ name: "Maxwell Frost" }];
  const two = [{ name: "A B" }, { name: "C D" }];

  it("treats a canceled race or a one-candidate general as uncontested", () => {
    expect(isUncontestedRace({ contest_stage: "uncontested" }, 1)).toBe(true);
    expect(isUncontestedRace(base, 1)).toBe(true);
    expect(isUncontestedRace(base, 2)).toBe(false);
    expect(isUncontestedRace({ contest_stage: "pre_primary" }, 1)).toBe(false);
    expect(contestStageNotice(base, one)).toMatchObject({
      kind: "uncontested",
      title: "Uncontested race",
    });
    expect(contestStageNotice(base, one)?.body).toContain(
      "Maxwell Frost is the only candidate",
    );
    expect(contestStageNotice(base, two)).toBeNull();
  });

  it("explains Louisiana's open primary and other pre-primary races", () => {
    expect(
      contestStageNotice(
        {
          ...base,
          id: "la-house-05-2026",
          state: "Louisiana",
          contest_stage: "pre_primary",
        },
        two,
      )?.title,
    ).toBe("Nov 3 is an open primary for this seat");
    expect(
      contestStageNotice({ ...base, contest_stage: "pre_primary" }, two)?.title,
    ).toBe("The primary hasn't happened yet");
  });

  it("explains ranked-choice general elections in Alaska and Maine federal races", () => {
    expect(
      contestStageNotice(
        {
          ...base,
          id: "ak-house-2026",
          state: "Alaska",
          contest_stage: "top_four_rcv",
        },
        two,
      )?.kind,
    ).toBe("ranked_choice");
    expect(
      contestStageNotice(
        {
          ...base,
          id: "me-senate-2026",
          office: "U.S. Senate",
          state: "Maine",
        },
        two,
      )?.kind,
    ).toBe("ranked_choice");
    expect(
      contestStageNotice(
        { ...base, id: "me-governor-2026", office: "Governor", state: "Maine" },
        two,
      ),
    ).toBeNull();
  });
});

describe("senateSeatLabel", () => {
  it.each([
    ["tx-senate-2026", "Texas", "Class II seat"],
    ["ga-senate-2026", "Georgia", "Class II seat"],
    ["oh-senate-2026-special", "Ohio", "Class III seat (special election)"],
    ["fl-senate-2026-special", "Florida", "Class III seat (special election)"],
    ["ca-senate-2026", "California", null],
    ["tx-senate-2028", "Texas", null],
  ])("%s -> %j", (id, state, expected) => {
    expect(senateSeatLabel({ id, state, office: "U.S. Senate" })).toBe(
      expected,
    );
  });

  it("replaces the research text's seat class in the location label", () => {
    expect(
      raceLocationLabel({
        id: "tx-senate-2026",
        office: "United States Senate",
        district: "Statewide (Class 1 seat)",
        jurisdiction: "Texas",
        state: "Texas",
      }),
    ).toBe("United States Senate · Class II seat · Texas");
  });
});

describe("slug ambiguity and duplicate rosters", () => {
  // "Jos Pe A" owns "jos-pe-a" as its current slug, which is also José
  // Peña's legacy slug.
  const race = {
    candidates: [
      candidate("José Peña", { party: "Independent" }),
      candidate("Jos Pe A", { party: "Republican" }),
      candidate("Jane Doe", { party: "Democratic" }),
      candidate("Jane Doe", { party: "Democratic" }),
    ],
  };

  it("prefers an exact current-slug match over a legacy one", () => {
    const resolved = resolveCandidate(race, "jos-pe-a");
    expect(resolved.candidate?.name).toBe("Jos Pe A");
    expect(resolved.isLegacySlug).toBe(false);
  });

  it("drops exact duplicate names from the rest of the field", () => {
    const resolved = resolveCandidate(race, "jose-pena");
    expect(resolved.others.map((c) => c.name)).toEqual([
      "Jos Pe A",
      "Jane Doe",
    ]);
  });

  it("selects by current slug before legacy slug in ?candidates=", () => {
    expect(
      selectComparedCandidates(race, "jos-pe-a").map((c) => c.name),
    ).toEqual(["Jos Pe A"]);
    expect(selectComparedCandidates(race, null)).toHaveLength(3);
  });
});

describe("inline citation forms", () => {
  it("keeps commas and balanced parentheses inside cited URLs", () => {
    const text =
      "Rated a Toss Up (https://ballotpedia.org/United_States_Senate_election_in_Michigan,_2026). " +
      "He served before (https://en.wikipedia.org/wiki/Mike_Rogers_(politician); https://a.gov/x).";
    expect(cleanDisplayText(text)).toBe("Rated a Toss Up. He served before.");
    expect(splitSourcedText(text).sources.map((s) => s.url)).toEqual([
      "https://ballotpedia.org/United_States_Senate_election_in_Michigan,_2026",
      "https://en.wikipedia.org/wiki/Mike_Rogers_(politician)",
      "https://a.gov/x",
    ]);
  });

  it("strips labelled and bracketed citations", () => {
    expect(
      cleanDisplayText(
        "Backs tariffs. [Source: https://weareindependentusa.org/tisha]",
      ),
    ).toBe("Backs tariffs.");
    expect(
      cleanDisplayText(
        "Supports the agenda. (Official campaign policy page: https://www.example.com/issues; campaign homepage content recovered from that page: https://www.example.com/)",
      ),
    ).toBe("Supports the agenda.");
    expect(
      cleanDisplayText(
        "Invests in tech. (Sources: https://a.house.gov/news?DocumentID=1; https://a.house.gov/news?DocumentID=2)",
      ),
    ).toBe("Invests in tech.");
  });

  it("strips a trailing Sources: list joined by semicolons or 'and'", () => {
    expect(
      cleanDisplayText(
        "No changes to Medicare. Sources: https://a.com/x ; https://b.org/y",
      ),
    ).toBe("No changes to Medicare.");
    expect(
      cleanDisplayText(
        "Supports vaccination. Sources: https://a.com/issues and https://b.com/survey",
      ),
    ).toBe("Supports vaccination.");
    const sourced = splitSourcedText(
      "Seat is safe. Sources: https://www.nbcnews.com/r; https://ballotpedia.org/Wisconsin%27s_2nd_Congressional_District_election,_2026",
    );
    expect(sourced.paragraphs).toEqual(["Seat is safe."]);
    expect(sourced.sources.map((s) => s.label)).toEqual([
      "nbcnews.com",
      "ballotpedia.org",
    ]);
  });

  it("leaves prose parentheticals and mid-sentence colons alone", () => {
    expect(
      cleanDisplayText("He serves (since 2025). Note: the seat is open."),
    ).toBe("He serves (since 2025). Note: the seat is open.");
    expect(cleanDisplayText("See (https://a.com/x for details).")).toBe(
      "See (https://a.com/x for details).",
    );
  });

  it("stays linear on adversarial citation-like input", () => {
    const patterns = [
      "(http://" + "!http://".repeat(5000),
      "(http://".repeat(5000),
      "[Source: http://" + "a".repeat(40000),
      "(" + "https://a.b/(".repeat(4000),
      "Sources: " + "https://a.b/x ; ".repeat(4000) + "!",
      "(" + "label: ".repeat(8000) + "https://a.b",
      "((((((((((".repeat(4000) + "https://a.b",
    ];
    for (const evil of patterns) {
      const start = performance.now();
      cleanDisplayText(evil);
      splitSourcedText(evil);
      expect(performance.now() - start).toBeLessThan(250);
    }
  });
});

describe("text helpers", () => {
  it("unescapes leaked newline escapes but not path-like backslashes", () => {
    expect(unescapeLeakedJson("First point.\\nSecond point.")).toBe(
      "First point.\nSecond point.",
    );
    expect(cleanDisplayText("First point.\\n\\nSecond point.")).toBe(
      "First point.\n\nSecond point.",
    );
    expect(unescapeLeakedJson("Saved to C:\\new\\tests")).toBe(
      "Saved to C:\\new\\tests",
    );
    expect(unescapeLeakedJson('He said \\"yes\\".\\nThen left')).toBe(
      'He said "yes".\nThen left',
    );
  });

  it("keeps emoticons and brackets while closing gaps before punctuation", () => {
    expect(tidySpacing("Keep smiling :) and wave ;)")).toBe(
      "Keep smiling :) and wave ;)",
    );
    expect(tidySpacing("The seat is open .  Next , please")).toBe(
      "The seat is open. Next, please",
    );
  });

  it("documents the accepted abbreviation merges in splitSentences", () => {
    // "no." and initials are not sentence ends, so these stay joined.
    expect(splitSentences("He voted no. The bill passed.")).toEqual([
      "He voted no. The bill passed.",
    ]);
    expect(splitSentences("It moved to the U.S. The vote followed.")).toEqual([
      "It moved to the U.S. The vote followed.",
    ]);
    expect(splitSentences("Plan B. It failed.")).toEqual([
      "Plan B. It failed.",
    ]);
    expect(splitSentences("Born in 1970. Raised in Ohio.")).toEqual([
      "Born in 1970.",
      "Raised in Ohio.",
    ]);
    expect(splitSentences("See e.g. Smith v. Jones. Then vote.")).toEqual([
      "See e.g. Smith v. Jones.",
      "Then vote.",
    ]);
  });
});

describe("isNoPositionStance", () => {
  it("matches stances that open with the no-position finding", () => {
    expect(
      isNoPositionStance(
        "No public position on healthcare policy found. The campaign site is silent.",
      ),
    ).toBe(true);
    expect(
      isNoPositionStance(
        "No publicly stated position on technology and artificial intelligence policy found.",
      ),
    ).toBe(true);
  });

  it("does not match a substantive stance that mentions a gap", () => {
    expect(
      isNoPositionStance(
        "Backs concealed carry reciprocity. No public position found on red-flag laws.",
      ),
    ).toBe(false);
  });
});
