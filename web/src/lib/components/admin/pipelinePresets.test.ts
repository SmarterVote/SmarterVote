import { describe, expect, it } from "vitest";
import {
  FULL_RESEARCH_STEPS,
  fullResearchCostEstimate,
  fullResearchRunOptions,
  refreshRunOptions,
} from "./pipelinePresets";

describe("pipeline presets", () => {
  // Source of truth: `refresh_race_core` in smartervote_mcp/server.py (with its
  // defaults). tests/test_admin_pipeline_presets.py cross-checks the TS source
  // against the MCP tool so the two cannot drift silently.
  it("refresh preset matches refresh_race_core exactly", () => {
    expect(refreshRunOptions()).toEqual({
      enabled_steps: [
        "discovery",
        "images",
        "polling",
        "forecast",
        "voter_resources",
      ],
      model_profile: "default",
      cheap_mode: true,
      force_fresh: false,
      allow_fast_no_change: true,
      baseline_source: "latest",
      save_artifact: true,
      debug_mode: true,
    });
  });

  it("full research preset keeps issues with review/iteration", () => {
    const opts = fullResearchRunOptions();
    expect(opts.enabled_steps).toEqual([...FULL_RESEARCH_STEPS]);
    expect(opts.enabled_steps).toContain("review");
    expect(opts.enabled_steps).toContain("iteration");
    expect(opts.model_profile).toBe("default");
  });

  it("full research estimate scales with candidate count", () => {
    expect(fullResearchCostEstimate(3)).toBe(
      "~$0.60–$0.90 (3 candidates × $0.20–$0.30)",
    );
  });

  it.each([0, null, undefined, Number.NaN])(
    "full research estimate refuses to guess for %s candidates",
    (count) => {
      const text = fullResearchCostEstimate(count as number | null | undefined);
      expect(text).toContain("unknown candidate count — verify roster first");
      expect(text).not.toMatch(/^~\$0\.20/);
    },
  );
});
