import type { Candidate, IssueStance } from "$lib/types";
import { partyKey } from "$lib/utils/party";

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

function isMajorParty(party: string | undefined): boolean {
  const key = partyKey(party);
  return key === "dem" || key === "rep";
}

/**
 * Display order for candidates: major-party (Democratic/Republican) candidates
 * first, then everyone else, otherwise keeping the roster's existing order.
 * The sort is stable, so this only lifts major-party candidates ahead of
 * minor-party and independent ones.
 */
export function compareCandidatesForDisplay(
  a: Pick<Candidate, "name" | "party">,
  b: Pick<Candidate, "name" | "party">,
): number {
  return Number(isMajorParty(b.party)) - Number(isMajorParty(a.party));
}

/** Return a new array of candidates in display order (major parties first). */
export function neutralCandidateOrder<
  T extends Pick<Candidate, "name" | "party">,
>(candidates: readonly T[] | null | undefined): T[] {
  return [...(candidates ?? [])].sort(compareCandidatesForDisplay);
}

/**
 * The roster with exact-duplicate names removed (first entry wins). A
 * duplicated candidate would otherwise render twice and collide on its slug.
 */
export function uniqueCandidatesByName<T extends Pick<Candidate, "name">>(
  candidates: readonly T[] | null | undefined,
): T[] {
  const seen = new Set<string>();
  return (candidates ?? []).filter((candidate) => {
    const key = (candidate.name ?? "").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One or two initials for an avatar placeholder: first and last name, skipping
 * suffixes ("Robert F. Kennedy Jr." -> "RK") and leading punctuation.
 */
export function candidateInitials(name: string): string {
  const tokens = nameTokens(name)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  while (tokens.length > 1 && isSuffix(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0) return "";
  const first = Array.from(tokens[0])[0] ?? "";
  const last = tokens.length > 1 ? (Array.from(tokens.at(-1)!)[0] ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase();
}

/** True when an issue stance has displayable text. */
export function hasStance(
  stance: Pick<IssueStance, "stance"> | null | undefined,
): boolean {
  return typeof stance?.stance === "string" && stance.stance.trim().length > 0;
}
