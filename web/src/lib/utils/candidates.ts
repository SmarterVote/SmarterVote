import type { Candidate, IssueStance } from "$lib/types";

const NAME_SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v",
  "phd",
  "md",
  "esq",
]);

function nameTokens(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

function isSuffix(token: string): boolean {
  return NAME_SUFFIXES.has(token.toLowerCase().replace(/[.,]/g, ""));
}

/** Last name without generational/professional suffixes ("Robert F. Kennedy Jr." -> "Kennedy"). */
export function candidateLastName(name: string): string {
  const tokens = nameTokens(name).map((token) => token.replace(/,$/, ""));
  while (tokens.length > 1 && isSuffix(tokens[tokens.length - 1])) tokens.pop();
  return tokens.at(-1) ?? name.trim();
}

/**
 * Short display label for tight spaces (poll bars, chips). Uses the last name,
 * falling back to the full name when two candidates in the list share it.
 */
export function shortCandidateName(
  name: string,
  allNames: readonly string[] = [],
): string {
  const last = candidateLastName(name);
  const key = last.toLocaleLowerCase();
  const collisions = allNames.filter(
    (other) =>
      other !== name && candidateLastName(other).toLocaleLowerCase() === key,
  );
  return collisions.length > 0 ? name.trim() : last;
}

const collator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * The one neutral, documented order for showing candidates: alphabetical by
 * last name, then full name. It deliberately ignores party, incumbency, and
 * pipeline/roster order so no candidate gets top billing from data plumbing.
 */
export function compareCandidatesNeutral(
  a: Pick<Candidate, "name">,
  b: Pick<Candidate, "name">,
): number {
  return (
    collator.compare(candidateLastName(a.name), candidateLastName(b.name)) ||
    collator.compare(a.name, b.name)
  );
}

/** Return a new array of candidates in the neutral display order. */
export function neutralCandidateOrder<T extends Pick<Candidate, "name">>(
  candidates: readonly T[] | null | undefined,
): T[] {
  return [...(candidates ?? [])].sort(compareCandidatesNeutral);
}

export const NEUTRAL_ORDER_NOTE =
  "Candidates are listed alphabetically by last name.";

/** True when an issue stance has displayable text. */
export function hasStance(
  stance: Pick<IssueStance, "stance"> | null | undefined,
): boolean {
  return typeof stance?.stance === "string" && stance.stance.trim().length > 0;
}
