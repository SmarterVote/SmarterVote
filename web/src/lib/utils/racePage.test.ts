import { describe, expect, it } from "vitest";
import type { Candidate, Race, RaceForecast } from "$lib/types";
import {
  candidateForecastProbability,
  cleanDisplayText,
  comparePreview,
  forecastHeadline,
  formatPollDate,
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

  it("describes the election and its active candidates without ratings", () => {
    const data = raceJsonLd(race);
    expect(data["@type"]).toBe("Event");
    expect(data.startDate).toBe("2026-11-03");
    expect(data.performer).toEqual([
      {
        "@type": "Person",
        name: "Jane Doe",
        url: "https://smarter.vote/races/ga-senate-2026/jane-doe/",
        affiliation: { "@type": "Organization", name: "Democratic" },
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("lean_d");
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
