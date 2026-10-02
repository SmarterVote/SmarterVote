import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ValidationGradeBadge from "./ValidationGradeBadge.svelte";
import type { AgentReview, ValidationGrade } from "$lib/types";

function makeGrade(overrides: Partial<ValidationGrade> = {}): ValidationGrade {
  return {
    grade: "A",
    score: 92,
    passed: true,
    summary: "Sources are complete and consistent.",
    ...overrides,
  } as ValidationGrade;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ValidationGradeBadge rendering", () => {
  it("shows the grade letter and an accessible label", () => {
    const { getByLabelText, container } = render(ValidationGradeBadge, {
      grade: makeGrade({ grade: "B" }),
    });

    expect(getByLabelText("Automated research score: B")).toBeTruthy();
    expect(container.textContent).toContain("B");
    expect(container.textContent).toContain("Research score");
  });

  it.each([
    ["A", "green"],
    ["B", "teal"],
    ["C", "yellow"],
    ["D", "orange"],
    ["F", "red"],
  ])("colours grade %s with the %s ramp", (grade, hue) => {
    const { container } = render(ValidationGradeBadge, {
      grade: makeGrade({ grade: grade as ValidationGrade["grade"] }),
    });

    expect(container.querySelector(".grade-badge")?.className).toContain(hue);
  });

  it("falls back to a neutral style for an unrecognised grade", () => {
    const { container } = render(ValidationGradeBadge, {
      grade: makeGrade({ grade: "Z" as ValidationGrade["grade"] }),
    });

    const className = container.querySelector(".grade-badge")?.className ?? "";
    expect(className).toContain("bg-surface-alt");
  });

  it("keeps the popover closed until asked", () => {
    const { container } = render(ValidationGradeBadge, { grade: makeGrade() });

    expect(container.querySelector(".popover")).toBeNull();
  });
});

describe("ValidationGradeBadge popover", () => {
  it("opens on click and shows the score, summary, and caveat", async () => {
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade({ score: 74, summary: "Two issues lack sources." }),
    });

    await fireEvent.click(getByLabelText(/Automated research score/));

    const popover = container.querySelector(".popover");
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain("Score: 74/100");
    expect(popover?.textContent).toContain("Two issues lack sources.");
    // The caveat is the product's honesty disclaimer — it must not be quietly
    // dropped. Collapse whitespace first: the source wraps mid-sentence, so
    // textContent carries the newline and indentation.
    const caveat = (popover?.textContent ?? "").replace(/\s+/g, " ");
    expect(caveat).toContain("not a guarantee that every claim is correct");
  });

  it("toggles closed on a second click", async () => {
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade(),
    });
    const badge = getByLabelText(/Automated research score/);

    await fireEvent.click(badge);
    expect(container.querySelector(".popover")).not.toBeNull();

    await fireEvent.click(badge);
    expect(container.querySelector(".popover")).toBeNull();
  });

  it("closes on Escape", async () => {
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade(),
    });
    const badge = getByLabelText(/Automated research score/);

    await fireEvent.click(badge);
    expect(container.querySelector(".popover")).not.toBeNull();

    await fireEvent.keyDown(badge, { key: "Escape" });
    expect(container.querySelector(".popover")).toBeNull();
  });

  it("ignores other keys", async () => {
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade(),
    });
    const badge = getByLabelText(/Automated research score/);

    await fireEvent.click(badge);
    await fireEvent.keyDown(badge, { key: "a" });

    expect(container.querySelector(".popover")).not.toBeNull();
  });

  it("closes when the backdrop is clicked", async () => {
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade(),
    });

    await fireEvent.click(getByLabelText(/Automated research score/));
    const backdrop = container.querySelector(".popover-backdrop");
    expect(backdrop).not.toBeNull();

    await fireEvent.click(backdrop!);
    expect(container.querySelector(".popover")).toBeNull();
  });

  it("repeats the grade inside the popover header", async () => {
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade({ grade: "C" }),
    });

    await fireEvent.click(getByLabelText(/Automated research score/));

    expect(container.querySelector(".popover-grade")?.textContent).toContain(
      "C",
    );
  });
});

describe("ValidationGradeBadge review link", () => {
  it("scrolls to the review section and closes the popover", async () => {
    const target = document.createElement("div");
    target.id = "ai-review";
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    const { container, getByLabelText, getByText } = render(
      ValidationGradeBadge,
      { grade: makeGrade() },
    );

    await fireEvent.click(getByLabelText(/Automated research score/));
    await fireEvent.click(getByText("View review details"));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(container.querySelector(".popover")).toBeNull();
  });

  // The badge renders on pages that have no review section; a missing anchor
  // must close the popover rather than throw.
  it("still closes cleanly when there is no review section on the page", async () => {
    const { container, getByLabelText, getByText } = render(
      ValidationGradeBadge,
      { grade: makeGrade() },
    );

    await fireEvent.click(getByLabelText(/Automated research score/));
    await fireEvent.click(getByText("View review details"));

    expect(container.querySelector(".popover")).toBeNull();
  });
});

describe("ValidationGradeBadge popover placement and focus", () => {
  function rectAt(left: number, width = 140): DOMRect {
    return {
      left,
      right: left + width,
      top: 100,
      bottom: 144,
      width,
      height: 44,
      x: left,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect;
  }

  it("opens rightward when right-aligning would cross the left edge", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rectAt(16),
    );
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade(),
    });
    await fireEvent.click(getByLabelText(/Automated research score/));
    expect(
      container.querySelector(".popover")?.classList.contains("popover--left"),
    ).toBe(true);
  });

  it("stays right-aligned when there is room on the left", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rectAt(800),
    );
    const { container, getByLabelText } = render(ValidationGradeBadge, {
      grade: makeGrade(),
    });
    await fireEvent.click(getByLabelText(/Automated research score/));
    expect(
      container.querySelector(".popover")?.classList.contains("popover--left"),
    ).toBe(false);
  });

  it("closes on Escape from inside the popover and refocuses the badge", async () => {
    const { container, getByLabelText, getByText } = render(
      ValidationGradeBadge,
      { grade: makeGrade() },
    );
    const badge = getByLabelText(/Automated research score/);
    await fireEvent.click(badge);
    const link = getByText("View review details");
    link.focus();

    await fireEvent.keyDown(link, { key: "Escape" });

    expect(container.querySelector(".popover")).toBeNull();
    expect(document.activeElement).toBe(badge);
  });
});

describe("ValidationGradeBadge stale reviews", () => {
  function review(overrides: Partial<AgentReview> = {}): AgentReview {
    return {
      model: "x-ai/grok-4.3",
      reviewed_at: "2026-09-01T00:00:00Z",
      verdict: "approved",
      score: 90,
      flags: [],
      summary: "Looks good.",
      stale: false,
      ...overrides,
    };
  }
  const validated = makeGrade({
    summary: "Validated by 3/3 reviewers with an average score of 90/100.",
  });

  async function openPopover(reviews: AgentReview[]) {
    const result = render(ValidationGradeBadge, { grade: validated, reviews });
    await fireEvent.click(result.container.querySelector(".grade-badge")!);
    return result;
  }

  it("says the review predates the roster when every review is stale", async () => {
    const { container, getByLabelText } = await openPopover([
      review({ stale: true }),
      review({ stale: true }),
      review({ stale: true }),
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("Reviewed before the latest roster update");
    expect(text).not.toContain("Validated by 3/3");
    expect(text).toContain("Review outdated");
    expect(
      getByLabelText(/reviewed before the latest roster update/),
    ).toBeTruthy();
  });

  it("counts only current reviews when some are stale", async () => {
    const { container } = await openPopover([
      review(),
      review({ verdict: "needs_revision" }),
      review({ stale: true }),
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("Validated by 1/2 current reviewers");
    expect(text).toContain("2 of 3 reviews current");
  });

  it("keeps the grade summary when every review is current", async () => {
    const { container } = await openPopover([review(), review(), review()]);
    expect(container.textContent).toContain("Validated by 3/3 reviewers");
    expect(container.textContent).not.toContain("reviews current");
  });
});

describe("ValidationGradeBadge published review counts", () => {
  async function open(grade: ValidationGrade, reviews: AgentReview[] = []) {
    const result = render(ValidationGradeBadge, { grade, reviews });
    await fireEvent.click(result.container.querySelector(".grade-badge")!);
    return result.container.textContent ?? "";
  }

  it("uses current_review_count/stale_review_count when the grade has them", async () => {
    const text = await open(
      makeGrade({
        summary: "Validated by 3/3 reviewers with an average score of 90/100.",
        current_review_count: 0,
        stale_review_count: 3,
      }),
    );
    expect(text).toContain("Reviewed before the latest roster update");
    expect(text).not.toContain("Validated by 3/3");
  });

  it("counts N from current_review_count when some reviews are stale", async () => {
    const text = await open(
      makeGrade({
        summary: "Validated by 2/2 reviewers with an average score of 90/100.",
        current_review_count: 2,
        stale_review_count: 1,
      }),
    );
    expect(text).toContain("Validated by 2/2 current reviewers");
    expect(text).toContain("2 of 3 reviews current");
  });
});
