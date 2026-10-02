/**
 * Public presentation of the automated AI reviews: which reviews and flags a
 * reader sees, how stale reviews are counted, and plain-text cleanup of the
 * reviewers' prose. Shared by the research-score badge and the review panel.
 */
import type { AgentReview, ReviewFlag, ValidationGrade } from "$lib/types";
import { getIssueDisplayName } from "$lib/types";

/** Internal automated checks, not independent model reviews. */
const INTERNAL_REVIEW_MODELS = new Set([
  "automated-link-validator",
  "automated-profile-quality",
]);

/**
 * Reviews a reader should see: model reviews only, and never an empty one
 * (no summary and no score says nothing, yet would read as a verdict).
 */
export function publicReviews(
  reviews: readonly AgentReview[] | null | undefined,
): AgentReview[] {
  return (reviews ?? []).filter(
    (review) =>
      !INTERNAL_REVIEW_MODELS.has(review.model) &&
      (stripMarkdown(review.summary).length > 0 || review.score != null),
  );
}

export interface ReviewCurrency {
  /** Reviews that judged the current candidate roster. */
  current: AgentReview[];
  stale: AgentReview[];
  total: number;
}

export function reviewCurrency(
  reviews: readonly AgentReview[] | null | undefined,
): ReviewCurrency {
  const shown = publicReviews(reviews);
  const stale = shown.filter((review) => review.stale === true);
  const current = shown.filter((review) => review.stale !== true);
  return { current, stale, total: shown.length };
}

export interface ReviewStatus {
  /** One-line verdict for the badge popover. */
  summary: string;
  /** "2 of 3 reviews current", or null when every review is current. */
  currencyNote: string | null;
  /** Every shown review judged an earlier roster. */
  allStale: boolean;
}

const VALIDATED_BY = /^Validated by \d+\/\d+ reviewers\b/i;

/**
 * What the research-score badge says about the reviews behind it. The grade
 * summary's "Validated by N/M reviewers" counted stale reviews too, so it is
 * recomputed from the current ones; when none are current it says so instead.
 */
export function reviewStatus(
  grade: Pick<
    ValidationGrade,
    "summary" | "current_review_count" | "stale_review_count"
  >,
  reviews: readonly AgentReview[] | null | undefined,
): ReviewStatus {
  const listed = reviewCurrency(reviews);
  const gradeSummary = stripMarkdown(grade.summary);
  // Grades published since the pipeline began counting stale reviews carry
  // the counts; older grades fall back to the reviews' own `stale` flags.
  const hasCounts =
    typeof grade.current_review_count === "number" &&
    typeof grade.stale_review_count === "number";
  const currentCount = hasCounts
    ? (grade.current_review_count as number)
    : listed.current.length;
  const staleCount = hasCounts
    ? (grade.stale_review_count as number)
    : listed.stale.length;
  const total = currentCount + staleCount;
  if (total === 0 || staleCount === 0)
    return { summary: gradeSummary, currencyNote: null, allStale: false };
  if (currentCount === 0) {
    return {
      summary: "Reviewed before the latest roster update",
      currencyNote: `0 of ${total} reviews current`,
      allStale: true,
    };
  }
  const summaryMatch = gradeSummary.match(/^Validated by (\d+)\/\d+/i);
  const approved =
    listed.current.length > 0
      ? listed.current.filter((review) => review.verdict === "approved").length
      : Math.min(Number(summaryMatch?.[1] ?? currentCount), currentCount);
  const summary = VALIDATED_BY.test(gradeSummary)
    ? gradeSummary.replace(
        VALIDATED_BY,
        `Validated by ${Math.min(approved, currentCount)}/${currentCount} current reviewer${currentCount === 1 ? "" : "s"}`,
      )
    : gradeSummary;
  return {
    summary,
    currencyNote: `${currentCount} of ${total} reviews current`,
    allStale: false,
  };
}

/** Remove Markdown emphasis, code ticks, headings and link syntax from reviewer prose. */
export function stripMarkdown(text: string | null | undefined): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)\s]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Pipeline vocabulary that means nothing to a reader: field paths
 * ("candidates[0].issues.Healthcare", "research_audit"), internal slots and
 * outputs, schema and instruction talk.
 */
const INTERNAL_JARGON = [
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/, // snake_case identifiers
  // Dotted field paths ("issues.Healthcare", "forecast.rationale"), but not
  // domains ("ballotpedia.org") or abbreviations ("e.g.").
  /\b(?:candidates|issues|forecast|polling|reviews|race|sources)(?:\[[^\]]*\])?\.[A-Za-z_]/,
  /\[\d+\]/, // array indexes
  /\bresearch_audit\b/i,
  /\bslots?\b/i,
  /\bterminal issue outputs?\b/i,
  /\bpipeline\b/i,
  /\bschema\b/i,
  /\barray\b/i,
  /\bcorrection goal\b/i,
  /\binstructions?\b/i,
  /\bnull\b/,
];

function hasInternalJargon(text: string | null | undefined): boolean {
  if (!text) return false;
  return INTERNAL_JARGON.some((pattern) => pattern.test(text));
}

/** Warnings and errors written in reader terms; info notes and internal notes are hidden. */
export function isPublicFlag(flag: ReviewFlag): boolean {
  if (flag.severity !== "error" && flag.severity !== "warning") return false;
  if (!stripMarkdown(flag.concern)) return false;
  return (
    !hasInternalJargon(flag.concern) && !hasInternalJargon(flag.suggestion)
  );
}

export function publicFlags(
  flags: readonly ReviewFlag[] | null | undefined,
): ReviewFlag[] {
  return (flags ?? []).filter(isPublicFlag);
}

const FIELD_SECTION_LABELS: Record<string, string> = {
  summary: "Biography",
  summary_sources: "Biography sources",
  career_history: "Career",
  education: "Education",
  donor_summary: "Donors",
  donor_sources: "Donors",
  voting_summary: "Voting record",
  voting_sources: "Voting record",
  image_url: "Photo",
  website: "Website",
};

const RACE_FIELD_LABELS: Record<string, string> = {
  description: "Race overview",
  forecast: "Forecast",
  polling: "Polling",
  candidates: "Candidate list",
};

/**
 * Reader label for a flag's field path: "candidates[1].issues.Healthcare.sources"
 * becomes "Casey Whitfield · Healthcare". Null when the path is not one a
 * reader would recognise.
 */
export function flagFieldLabel(
  field: string | null | undefined,
  candidateNames: readonly string[] = [],
): string | null {
  const path = (field ?? "").trim();
  if (!path) return null;
  const candidateMatch = path.match(/^candidates\[(\d+)\](?:\.(.*))?$/);
  if (!candidateMatch) {
    const head = path.split(/[.[]/, 1)[0];
    return RACE_FIELD_LABELS[head] ?? null;
  }
  const name = candidateNames[Number(candidateMatch[1])] ?? null;
  const rest = candidateMatch[2] ?? "";
  let section: string | null = null;
  const issue = rest.match(/^issues(?:\.([^.[]+)|\["([^"]+)"\])/);
  if (issue) section = getIssueDisplayName(issue[1] ?? issue[2]);
  else {
    const head = rest.split(/[.[]/, 1)[0];
    section = FIELD_SECTION_LABELS[head] ?? null;
  }
  const parts = [name, section].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
