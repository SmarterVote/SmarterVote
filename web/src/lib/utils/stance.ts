/**
 * Sentence splitting and collapsed previews for research prose (stances,
 * biographies, race overviews). There is one splitter and one abbreviation
 * list; the race, candidate, and compare pages all preview text through it.
 */

/** Lower-cased tokens (without their trailing period) that never end a sentence. */
const SENTENCE_ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sen",
  "sens",
  "rep",
  "reps",
  "gov",
  "lt",
  "gen",
  "col",
  "maj",
  "capt",
  "sgt",
  "st",
  "jr",
  "sr",
  "vs",
  "etc",
  "inc",
  "co",
  "corp",
  "ltd",
  "no",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "rev",
  "hon",
  "pres",
  "atty",
  "sec",
  "dept",
  "ft",
  "mt",
  "al",
  "approx",
]);

function endsWithAbbreviation(textThroughPeriod: string): boolean {
  const token = textThroughPeriod
    .trim()
    .split(/\s+/)
    .at(-1)
    ?.replace(/^[("“‘']+/, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (!token) return false;
  // Initials and dotted acronyms: "J.D.", "U.S.", "e.g.", a middle initial "H."
  if (/^[a-z]$/.test(token) || /^(?:[a-z]\.)+[a-z]$/.test(token)) return true;
  return SENTENCE_ABBREVIATIONS.has(token);
}

/**
 * Split prose into sentences without breaking on "Gov.", "U.S." or "Aug. 6".
 * A sentence that genuinely ends on one of those ("…voted no. Next") stays
 * joined to the next one; that is the accepted cost of not splitting titles.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  const boundary = /[.!?]["'”’)]*\s+(?=["“‘'(]?[A-Z0-9])/g;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].trimEnd().length;
    const candidate = text.slice(start, end);
    if (match[0][0] === "." && endsWithAbbreviation(candidate)) continue;
    sentences.push(candidate.trim());
    start = (match.index ?? 0) + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences.filter(Boolean);
}

/** Cut `text` to at most `limit` characters at a word boundary, with an ellipsis. */
function hardCap(text: string, limit: number): string {
  const shortened = text.slice(0, limit);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > limit * 0.66 ? lastSpace : limit).trim()}…`;
}

/**
 * Collapsed text for a side-by-side comparison cell: whole sentences up to
 * about `limit` characters, hard-capped at a word boundary when the opening
 * sentence alone runs long. Keeps comparison rows a similar, scannable height.
 * Desktop and mobile comparisons both use this.
 */
export function comparePreview(text: string, limit = 240): string {
  const normalized = text.trim();
  if (normalized.length <= limit + 40) return normalized;
  let preview = "";
  for (const sentence of splitSentences(normalized)) {
    const next = preview ? `${preview} ${sentence}` : sentence;
    if (next.length > limit) break;
    preview = next;
  }
  if (preview.length >= limit / 2) return preview;
  return hardCap(normalized, limit);
}

/**
 * Sentence-bounded preview: the first sentence (or as many whole sentences
 * as it takes to reach `minimumLength`), never splitting an abbreviation.
 * Text with no sentence-ending punctuation is hard-capped at `fallbackLength`.
 */
export function stancePreview(
  stance: string,
  fallbackLength = 180,
  minimumLength = 0,
): string {
  const normalized = stance.trim();
  let preview = "";
  for (const sentence of splitSentences(normalized)) {
    preview = preview ? `${preview} ${sentence}` : sentence;
    if (preview.length >= minimumLength) break;
  }
  if (/[.!?]["'”’)]*$/.test(preview)) return preview;
  if (normalized.length <= fallbackLength) return normalized;
  return hardCap(normalized, fallbackLength);
}

/**
 * Hard-capped preview for dense modules (the homepage comparison) where a
 * sentence-bounded preview can still run several hundred characters.
 */
export function collapsedPreview(text: string, limit = 120): string {
  const normalized = text.trim();
  if (normalized.length <= limit) return normalized;
  return hardCap(normalized, limit);
}

/** Qualifiers that may precede "public" in a no-position opener. */
const NO_POSITION_QUALIFIER =
  "(?:(?:specific|clear|clearly|explicit|detailed|direct|official|formal)\\s+)?";
/** Up to four topic words between "public" and "position" ("public foreign policy position"). */
const NO_POSITION_TOPIC = "(?:[\\w&’'/-]+\\s+){0,4}?";
/** Words that close the "nothing was found" finding. */
const NO_POSITION_FINDING =
  "(?:found|identified|located|stated|published|available|given|made|articulated|announced)";

/**
 * Opening clause of the pipeline's "nothing found" stance, in every wording
 * seen in published data: "No public position found.", "No specific public
 * position was identified on …", "No public stance found …", "No publicly
 * stated stance found …", "No public foreign policy position is stated …",
 * "No public position could be found". Anchored at the start and confined to
 * the first sentence.
 */
const NO_POSITION_OPENER = new RegExp(
  `^no\\s+${NO_POSITION_QUALIFIER}public(?:ly)?(?:\\s+(?:stated|available|declared|documented|articulated))?\\s+${NO_POSITION_TOPIC}(?:position|stance|statement)s?\\b[^.;!?]{0,200}?\\b${NO_POSITION_FINDING}\\b`,
  "i",
);

/**
 * True for the pipeline's "nothing found" stance: the marker "No public
 * position found." or a stance that opens with that finding in any of its
 * wordings (see NO_POSITION_OPENER). A substantive stance that merely
 * mentions a missing position later on is not one.
 */
export function isNoPositionStance(text: string | null | undefined): boolean {
  return NO_POSITION_OPENER.test((text ?? "").trim());
}
