import type { Candidate, IssueStance } from "$lib/types";
import { partyKey } from "$lib/utils/party";
import { isNoPositionStance } from "$lib/utils/stance";

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

function isMajorParty(party: string | null | undefined): boolean {
  const key = partyKey(party);
  return key === "dem" || key === "rep";
}

type OrderableCandidate = Pick<Candidate, "name" | "party"> & {
  incumbent?: boolean | null;
};

/**
 * Display order for candidates, applied identically everywhere a field is
 * listed:
 *
 * 1. Democratic and Republican candidates first, then every other party and
 *    independents.
 * 2. Within each of those two groups, the incumbent first.
 * 3. Then alphabetical by last name (suffixes like "Jr." ignored), then by
 *    full name, so the order never depends on the order research found them.
 */
export function compareCandidatesForDisplay(
  a: OrderableCandidate,
  b: OrderableCandidate,
): number {
  const major = Number(isMajorParty(b.party)) - Number(isMajorParty(a.party));
  if (major !== 0) return major;
  const incumbent = Number(!!b.incumbent) - Number(!!a.incumbent);
  if (incumbent !== 0) return incumbent;
  const options = { sensitivity: "base" } as const;
  return (
    candidateLastName(a.name ?? "").localeCompare(
      candidateLastName(b.name ?? ""),
      "en",
      options,
    ) || (a.name ?? "").localeCompare(b.name ?? "", "en", options)
  );
}

/** Return a new array of candidates in display order (see compareCandidatesForDisplay). */
export function neutralCandidateOrder<T extends OrderableCandidate>(
  candidates: readonly T[] | null | undefined,
): T[] {
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

/** True when an issue stance states an actual position (not a "no public position found" marker). */
export function hasPublicPosition(
  stance: Pick<IssueStance, "stance"> | null | undefined,
): boolean {
  return hasStance(stance) && !isNoPositionStance(stance?.stance);
}

/**
 * True when a candidate has no researched positions to show: no issues at
 * all, only empty stances, or only "no public position found" markers.
 */
export function hasNoResearchedPositions(
  candidate: Pick<Candidate, "issues"> | null | undefined,
): boolean {
  return !Object.values(candidate?.issues ?? {}).some((issue) =>
    hasPublicPosition(issue),
  );
}
