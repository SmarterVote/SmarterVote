import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, it, expect } from "vitest";
import CandidateCard from "./CandidateCard.svelte";
import type { Candidate, CanonicalIssue, IssueStance } from "$lib/types";

const candidate: Candidate = {
  name: "Jane Doe",
  party: "Independent",
  incumbent: true,
  summary: "Test summary",
  issues: {} as Record<CanonicalIssue, IssueStance>,
  career_history: [],
  education: [],
  links: [],
  website: "https://example.com",
  social_media: {},
  summary_sources: [],
  roster_sources: [],
  voting_sources: [],
  donor_sources: [],
  withdrawn: false,
};

describe("CandidateCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders candidate details", () => {
    const { container } = render(CandidateCard, { candidate });
    const text = container.textContent || "";
    expect(text).toContain("Jane Doe");
    // Party is abbreviated in the card (e.g. "Independent" → "I")
    expect(text).toMatch(/Independent|I\b/);
    expect(text).toContain("Incumbent");
  });

  it("renders background source links when career and education entries include sources", async () => {
    const candidateWithSources: Candidate = {
      ...candidate,
      career_history: [
        {
          title: "Strategy Consultant",
          organization: "Example Group",
          source: {
            url: "https://example.com/career",
            type: "news",
            title: "Career Source",
            last_accessed: "2026-04-04T00:00:00Z",
            is_fresh: false,
          },
        },
      ],
      education: [
        {
          institution: "Example University",
          degree: "BA",
          field: "Politics",
          source: {
            url: "https://example.com/education",
            type: "website",
            title: "Education Source",
            last_accessed: "2026-04-04T00:00:00Z",
            is_fresh: false,
          },
        },
      ],
    };

    const { getByText } = render(CandidateCard, {
      candidate: candidateWithSources,
    });
    await fireEvent.click(getByText("Show more"));
    await fireEvent.click(getByText("Background"));

    expect(getByText("Career Source")).toBeTruthy();
    expect(getByText("Education Source")).toBeTruthy();
  });

  it("never renders a dangling dash when the start year is null", async () => {
    const { getByText, container } = render(CandidateCard, {
      candidate: {
        ...candidate,
        career_history: [
          { title: "State Senator", start_year: null, end_year: 2020 },
        ],
      },
    });
    await fireEvent.click(getByText("Show more"));
    await fireEvent.click(getByText("Background"));

    const years = container.querySelector(".timeline-years");
    expect(years?.textContent?.trim()).toBe("Until 2020");
    expect(container.textContent).not.toMatch(/(^|\s)– 2020/);
  });
});
