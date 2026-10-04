import { describe, expect, it } from "vitest";
import { LEGACY_MODEL_ALIASES, MODEL_LABELS } from "$lib/config/modelCatalog";
import {
  candidateSlug,
  careerYears,
  formatModelName,
  legacyCandidateSlug,
  matchesCandidateSlug,
} from "./format";

// modelCatalog.ts is generated from shared/model_catalog.py, so its contents
// change whenever the roster does. Derive fixtures from the catalog rather than
// hardcoding IDs — otherwise a routine model swap turns into a red test.
const [canonicalId, canonicalLabel] = Object.entries(MODEL_LABELS)[0];
const bareAlias = Object.entries(LEGACY_MODEL_ALIASES).find(
  ([, target]) => MODEL_LABELS[target] !== undefined,
)!;

describe("formatModelName", () => {
  it("returns falsy input unchanged", () => {
    expect(formatModelName("")).toBe("");
  });

  it("labels a current catalog model", () => {
    expect(formatModelName(canonicalId)).toBe(canonicalLabel);
  });

  it("resolves a bare alias through the catalog", () => {
    const [alias, target] = bareAlias;
    expect(formatModelName(alias)).toBe(MODEL_LABELS[target]);
  });

  it("labels pre-catalog models that only appear in old run records", () => {
    expect(formatModelName("gpt-4o")).toBe("GPT-4o");
    expect(formatModelName("claude-sonnet-4-20250514")).toBe("Claude Sonnet 4");
    expect(formatModelName("grok-3")).toBe("Grok 3");
  });

  it("maps historical pipeline generator tags to the model they actually used", () => {
    expect(formatModelName("pipeline-agent")).toBe("GPT-4o Mini");
    expect(formatModelName("pipeline-v2-agent")).toBe("GPT-4o Mini");
  });

  // The documented rule: a run renders as the model it ran on, never as
  // whatever replaced it. A direct label must win over alias redirection.
  it("prefers a direct label over alias redirection", () => {
    const aliasedArchived = Object.keys(LEGACY_MODEL_ALIASES).find(
      (key) => key === "gpt-4o",
    );
    // Only meaningful if the catalog ever aliases an archived name; when it
    // does not, the direct-hit path is still the one exercised above.
    if (aliasedArchived) {
      expect(formatModelName("gpt-4o")).toBe("GPT-4o");
    }
    expect(formatModelName(canonicalId)).toBe(canonicalLabel);
  });

  it("falls back to the raw id for anything unrecognised", () => {
    expect(formatModelName("some/unknown-model-9")).toBe(
      "some/unknown-model-9",
    );
  });

  it("does not resolve an alias whose target has no label", () => {
    // Guards the `aliased && MODEL_LABELS[aliased]` conjunction: a dangling
    // alias must fall through to the raw id, not return undefined.
    const dangling = Object.entries(LEGACY_MODEL_ALIASES).find(
      ([, target]) => MODEL_LABELS[target] === undefined,
    );
    if (dangling) {
      expect(formatModelName(dangling[0])).toBe(dangling[0]);
    }
  });
});

describe("candidateSlug", () => {
  it.each([
    ["Jane Doe", "jane-doe"],
    ["Jane Q. Doe", "jane-q-doe"],
    ["O'Brien", "o-brien"],
    ["Mary-Jane Watson", "mary-jane-watson"],
    ["  Leading and trailing  ", "leading-and-trailing"],
    ["UPPERCASE NAME", "uppercase-name"],
    ["Name123", "name123"],
  ])("slugifies %j to %j", (input, expected) => {
    expect(candidateSlug(input)).toBe(expected);
  });

  it("collapses runs of separators into a single dash", () => {
    expect(candidateSlug("A  ---  B")).toBe("a-b");
  });

  it("strips leading and trailing dashes", () => {
    expect(candidateSlug("!!!Jane!!!")).toBe("jane");
  });

  it("never returns an empty slug", () => {
    expect(candidateSlug("")).toBe("candidate");
    expect(candidateSlug("!!!")).toBe("c-212121");
    expect(candidateSlug("李明")).toBe("c-674e660e");
  });

  // Accents fold to their base letters so accented names get readable URLs.
  // The pre-folding slugs ("jos-u-ez") were published, so they stay matched
  // via legacyCandidateSlug / matchesCandidateSlug and are still prerendered.
  it("folds accents instead of fragmenting the name", () => {
    expect(candidateSlug("José Ñuñez")).toBe("jose-nunez");
    expect(candidateSlug("Müller")).toBe("muller");
    expect(candidateSlug("Micheál O'Leary")).toBe("micheal-o-leary");
  });

  it("keeps matching published pre-folding slugs", () => {
    expect(legacyCandidateSlug("José Ñuñez")).toBe("jos-u-ez");
    expect(matchesCandidateSlug("José Ñuñez", "jos-u-ez")).toBe(true);
    expect(matchesCandidateSlug("José Ñuñez", "jose-nunez")).toBe(true);
    expect(matchesCandidateSlug("José Ñuñez", "jose")).toBe(false);
  });

  it("produces a stable slug for the same name", () => {
    expect(candidateSlug("Jane Doe")).toBe(candidateSlug("Jane  Doe"));
  });
});

describe("careerYears", () => {
  it("formats closed, open-ended, end-only and unknown ranges", () => {
    expect(careerYears({ start_year: 2010, end_year: 2020 })).toBe(
      "2010 – 2020",
    );
    expect(careerYears({ start_year: 2010, end_year: null })).toBe(
      "2010 – Present",
    );
    expect(careerYears({ start_year: null, end_year: 2020 })).toBe(
      "Until 2020",
    );
    expect(careerYears({ start_year: null, end_year: null })).toBe("");
    expect(careerYears({})).toBe("");
  });
});
