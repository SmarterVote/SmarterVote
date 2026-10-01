import { describe, expect, it } from "vitest";
import type { RaceSummary } from "$lib/types";
import { featuredHomepageRaceIds, nationalElectionRaces } from "./homepage";

const race = (id: string, updated: string, state = "Iowa"): RaceSummary => ({
  id,
  election_date: "2026-11-03",
  updated_utc: updated,
  state,
  candidates: [
    { name: "Alex Example", incumbent: false },
    { name: "alex example", incumbent: false },
    { name: "Jordan Example", incumbent: false },
  ],
});

describe("homepage data", () => {
  it("keeps Texas Senate first in the curated featured races", () => {
    expect(featuredHomepageRaceIds).toEqual([
      "tx-senate-2026",
      "me-senate-2026",
      "nv-governor-2026",
      "co-house-08-2026",
      "ia-senate-2026",
    ]);
  });

  it("keeps federal and gubernatorial contests in launch coverage", () => {
    const federal = {
      ...race("house", "2026-01-01T00:00:00Z"),
      office: "U.S. House of Representatives",
    };
    const state = {
      ...race("governor", "2026-01-01T00:00:00Z"),
      office: "Governor of Iowa",
    };
    expect(nationalElectionRaces([state, federal])).toEqual([state, federal]);
  });
});
