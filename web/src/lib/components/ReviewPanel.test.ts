import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ReviewPanel from "./ReviewPanel.svelte";
import type { AgentReview, ReviewFlag } from "$lib/types";

function makeReview(overrides: Partial<AgentReview> = {}): AgentReview {
  return {
    model: "anthropic/claude-haiku-4.5",
    reviewed_at: "2026-01-15T00:00:00Z",
    verdict: "approved",
    score: 88,
    flags: [],
    summary: "Sources check out.",
    ...overrides,
  } as AgentReview;
}

function makeFlag(overrides: Partial<ReviewFlag> = {}): ReviewFlag {
  return {
    field: "candidates[0].summary",
    concern: "Summary lacks a citation.",
    severity: "warning",
    ...overrides,
  } as ReviewFlag;
}

/** The panel starts collapsed; most assertions need it open first. */
async function renderExpanded(reviews: AgentReview[]) {
  const result = render(ReviewPanel, { reviews });
  await fireEvent.click(result.container.querySelector(".review-title")!);
  return result;
}

afterEach(cleanup);

describe("ReviewPanel collapsing", () => {
  it("starts collapsed with nothing but the header", () => {
    const { container } = render(ReviewPanel, { reviews: [makeReview()] });

    expect(container.querySelector(".review-cards")).toBeNull();
    expect(
      container.querySelector(".review-title")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("expands and collapses on click", async () => {
    const { container } = render(ReviewPanel, { reviews: [makeReview()] });
    const toggle = container.querySelector(".review-title")!;

    await fireEvent.click(toggle);
    expect(container.querySelector(".review-cards")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await fireEvent.click(toggle);
    expect(container.querySelector(".review-cards")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("exposes an #ai-review anchor for the grade badge to scroll to", () => {
    const { container } = render(ReviewPanel, { reviews: [] });

    expect(container.querySelector("#ai-review")).not.toBeNull();
  });
});

describe("ReviewPanel review filtering", () => {
  // These two are internal automated checks, not model reviews — surfacing
  // them would misrepresent how many independent models looked at the race.
  it.each(["automated-link-validator", "automated-profile-quality"])(
    "hides the internal %s entry",
    async (model) => {
      const { container } = await renderExpanded([
        makeReview({ model }),
        makeReview({ model: "x-ai/grok-4.3" }),
      ]);

      expect(container.textContent).not.toContain(model);
      expect(container.textContent).toContain("x-ai/grok-4.3");
    },
  );

  it("counts only the visible reviews", () => {
    const { container } = render(ReviewPanel, {
      reviews: [
        makeReview({ model: "automated-link-validator" }),
        makeReview({ model: "x-ai/grok-4.3" }),
      ],
    });

    expect(container.querySelector(".review-count")?.textContent).toContain(
      "1 review",
    );
  });

  it.each([
    [1, "1 review"],
    [2, "2 reviews"],
  ])("pluralises a count of %i as %j", (count, expected) => {
    const { container } = render(ReviewPanel, {
      reviews: Array.from({ length: count }, (_, i) =>
        makeReview({ model: `model-${i}` }),
      ),
    });

    expect(container.querySelector(".review-count")?.textContent?.trim()).toBe(
      expected,
    );
  });

  it("omits the count entirely when nothing is visible", () => {
    const { container } = render(ReviewPanel, {
      reviews: [makeReview({ model: "automated-link-validator" })],
    });

    expect(container.querySelector(".review-count")).toBeNull();
  });

  it.each([
    ["an empty array", []],
    ["a null prop", null],
  ])("shows the empty state for %s", async (_label, reviews) => {
    const { container } = await renderExpanded(reviews as AgentReview[]);

    expect(container.querySelector(".review-empty")?.textContent).toContain(
      "No automated review has been run",
    );
  });
});

describe("ReviewPanel verdicts and scores", () => {
  it.each([
    ["approved", "review-verdict--approved"],
    ["needs_revision", "review-verdict--needs_revision"],
    ["flagged", "review-verdict--flagged"],
  ])("styles the %s verdict with %s", async (verdict, hue) => {
    const { container } = await renderExpanded([
      makeReview({ verdict: verdict as AgentReview["verdict"] }),
    ]);

    expect(container.querySelector(".review-verdict")?.className).toContain(
      hue,
    );
  });

  it("falls back to a neutral verdict style", async () => {
    const { container } = await renderExpanded([
      makeReview({ verdict: "unheard_of" as AgentReview["verdict"] }),
    ]);

    expect(container.querySelector(".review-verdict")?.className).toContain(
      "review-verdict--neutral",
    );
  });

  it("renders the verdict as words rather than a snake_case token", async () => {
    const { container } = await renderExpanded([
      makeReview({ verdict: "needs_revision" }),
    ]);

    expect(
      container.querySelector(".review-verdict")?.textContent?.trim(),
    ).toBe("needs revision");
  });

  it("shows a score when present", async () => {
    const { container } = await renderExpanded([makeReview({ score: 73 })]);

    expect(container.querySelector(".review-score")?.textContent).toContain(
      "73/100",
    );
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("hides the score when it is %s", async (_label, score) => {
    const { container } = await renderExpanded([
      makeReview({ score: score as number | undefined }),
    ]);

    expect(container.querySelector(".review-score")).toBeNull();
  });

  // 0 is a real score, not a missing one — the guard is `!= null`, so it must
  // survive. A truthiness check here would silently hide the worst reviews.
  it("shows a zero score rather than treating it as missing", async () => {
    const { container } = await renderExpanded([makeReview({ score: 0 })]);

    expect(container.querySelector(".review-score")?.textContent).toContain(
      "0/100",
    );
  });

  it("omits the summary paragraph when there is no summary", async () => {
    const { container } = await renderExpanded([makeReview({ summary: "" })]);

    expect(container.querySelector(".review-summary")).toBeNull();
  });
});

describe("ReviewPanel flags", () => {
  it("says so explicitly when a review raised nothing", async () => {
    const { container } = await renderExpanded([makeReview({ flags: [] })]);

    expect(container.querySelector(".review-all-clear")?.textContent).toContain(
      "No issues flagged",
    );
  });

  it.each([
    [1, "1 flag"],
    [3, "3 flags"],
  ])("pluralises %i flags as %j", async (count, expected) => {
    const { container } = await renderExpanded([
      makeReview({
        flags: Array.from({ length: count }, () => makeFlag()),
      }),
    ]);

    expect(container.querySelector(".flags-toggle")?.textContent?.trim()).toBe(
      expected,
    );
  });

  it.each([
    ["error", "Error", "flag-severity--error"],
    ["warning", "Warning", "flag-severity--warning"],
    ["info", "Note", "flag-severity--info"],
    ["anything-else", "Note", "flag-severity--info"],
  ])("labels %s severity as %s", async (severity, label, cls) => {
    const { container } = await renderExpanded([
      makeReview({
        flags: [makeFlag({ severity: severity as ReviewFlag["severity"] })],
      }),
    ]);

    const badge = container.querySelector(".flag-severity");
    expect(badge?.textContent?.trim()).toBe(label);
    expect(badge?.className).toContain(cls);
    // Text labels, not emoji, so screen readers and forced colors work.
    expect(container.textContent).not.toMatch(/[🔴🟡🔵💡]/u);
  });

  it("renders the flagged field and concern", async () => {
    const { container } = await renderExpanded([
      makeReview({
        flags: [
          makeFlag({ field: "polling[0]", concern: "Pollster missing." }),
        ],
      }),
    ]);

    expect(container.textContent).toContain("polling[0]");
    expect(container.textContent).toContain("Pollster missing.");
  });

  it("shows a suggestion when one is offered", async () => {
    const { container } = await renderExpanded([
      makeReview({ flags: [makeFlag({ suggestion: "Cite the pollster." })] }),
    ]);

    expect(container.querySelector(".flag-suggestion")?.textContent).toContain(
      "Cite the pollster.",
    );
  });

  it("omits the suggestion line when none is offered", async () => {
    const { container } = await renderExpanded([
      makeReview({ flags: [makeFlag({ suggestion: undefined })] }),
    ]);

    expect(container.querySelector(".flag-suggestion")).toBeNull();
  });
});

describe("ReviewPanel review date", () => {
  it("formats a valid timestamp as a local date", async () => {
    const { container } = await renderExpanded([
      makeReview({ reviewed_at: "2026-01-15T00:00:00Z" }),
    ]);

    const text = container.querySelector(".review-date")?.textContent ?? "";
    expect(text).toContain("Reviewed:");
    expect(text).toContain(
      new Date("2026-01-15T00:00:00Z").toLocaleDateString(),
    );
  });

  // An unparseable timestamp must render verbatim rather than "Invalid Date".
  it("falls back to the raw value for an unparseable timestamp", async () => {
    const { container } = await renderExpanded([
      makeReview({ reviewed_at: "not-a-date" }),
    ]);

    const text = container.querySelector(".review-date")?.textContent ?? "";
    expect(text).toContain("not-a-date");
    expect(text).not.toContain("Invalid Date");
  });
});

describe("ReviewPanel stale reviews", () => {
  it("does not present a stale approval as a current verdict", async () => {
    const { container } = await renderExpanded([
      makeReview({
        model: "stale-model",
        stale: true,
        stale_reason: "Roster changed after review",
      }),
    ]);

    const verdict = container.querySelector(".review-verdict");
    expect(verdict?.textContent).toContain("Stale");
    expect(verdict?.className).not.toContain("bg-green-100");
    expect(container.textContent).toContain("Roster changed after review");
    expect(container.textContent).not.toContain(
      "No issues flagged in this review.",
    );
  });

  it("lists current reviews before stale ones and counts the stale ones", async () => {
    const { container } = await renderExpanded([
      makeReview({ model: "old-model", stale: true }),
      makeReview({ model: "new-model", stale: false }),
    ]);

    const models = Array.from(container.querySelectorAll(".review-model")).map(
      (el) => el.textContent,
    );
    expect(models).toEqual(["new-model", "old-model"]);
    expect(container.querySelector(".review-count")?.textContent).toContain(
      "1 stale",
    );
  });
});
