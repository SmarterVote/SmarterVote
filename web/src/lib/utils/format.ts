import { LEGACY_MODEL_ALIASES, MODEL_LABELS } from "$lib/config/modelCatalog";

// Bare-name and pre-catalog IDs that only ever appear in historical run
// records. Anything with a provider prefix belongs in shared/model_catalog.py,
// not here -- this map is display-only rescue for records older than the
// catalog itself.
const ARCHIVED_MODEL_NAMES: Record<string, string> = {
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4": "GPT-4",
  "gpt-4-turbo": "GPT-4 Turbo",
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "claude-haiku-4-20250514": "Claude Haiku 4",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
  "grok-3": "Grok 3",
  "pipeline-agent": "GPT-4o Mini",
  "pipeline-v2-agent": "GPT-4o Mini",
};

/**
 * Display-friendly name for an AI model identifier.
 *
 * A run is labelled with the model it actually used, never with whatever
 * replaced it — so retired IDs resolve to their own name first, and the
 * alias table is only consulted for bare names that were always shorthand.
 */
export function formatModelName(raw: string): string {
  if (!raw) return raw;
  const direct = MODEL_LABELS[raw] ?? ARCHIVED_MODEL_NAMES[raw];
  if (direct) return direct;
  const aliased = LEGACY_MODEL_ALIASES[raw];
  if (aliased && MODEL_LABELS[aliased]) return MODEL_LABELS[aliased];
  return raw;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Latin letters that Unicode decomposition does not reduce to a base letter
 * plus accent ("ø", "ł", "æ", "ß"), folded to their usual ASCII spelling.
 * Keep in sync with scripts/generate-sitemap.mjs.
 */
const LETTER_FOLDS: Record<string, string> = {
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ł: "l",
  Ł: "L",
  ß: "ss",
  þ: "th",
  Þ: "TH",
  ı: "i",
};
const LETTER_FOLD_PATTERN = /[øØđĐðÐæÆœŒłŁßþÞı]/g;

/**
 * Turn a candidate name into a URL-safe slug. Accents are folded first
 * ("José Peña" -> "jose-pena", "Søren Łukasz" -> "soren-lukasz"); names with
 * no Latin letters fall back to a stable hex encoding so the URL is never
 * empty. Keep in sync with scripts/generate-sitemap.mjs.
 */
export function candidateSlug(name: string): string {
  const folded = slugify(
    name
      .replace(LETTER_FOLD_PATTERN, (ch) => LETTER_FOLDS[ch] ?? ch)
      .normalize("NFD")
      .replace(/\p{M}/gu, ""),
  );
  if (folded) return folded;
  const hex = Array.from(name.trim())
    .map((ch) => ch.codePointAt(0)!.toString(16))
    .join("");
  return hex ? `c-${hex}` : "candidate";
}

/**
 * The pre-accent-folding slug ("José Peña" -> "jos-pe-a"). Published URLs
 * used it, so pages still accept it and redirect/canonicalise to candidateSlug.
 */
export function legacyCandidateSlug(name: string): string {
  return slugify(name);
}

/** True when `slug` addresses this candidate under the current or legacy scheme. */
export function matchesCandidateSlug(name: string, slug: string): boolean {
  return candidateSlug(name) === slug || legacyCandidateSlug(name) === slug;
}

/**
 * Year range for a career entry: "2010 – 2020", "2010 – Present" (no end
 * year), "Until 2020" (no start year), or "" when neither is known. Years are
 * nullable in RaceJSON, so a missing start must never render as "– 2020".
 */
export function careerYears(entry: {
  start_year?: number | null;
  end_year?: number | null;
}): string {
  const { start_year: start, end_year: end } = entry;
  if (start) return end ? `${start} – ${end}` : `${start} – Present`;
  return end ? `Until ${end}` : "";
}
