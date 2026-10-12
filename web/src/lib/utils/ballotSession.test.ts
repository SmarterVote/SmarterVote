import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BALLOT_SESSION_KEY,
  ballotReturnHref,
  clearSavedBallot,
  readSavedBallot,
  writeSavedBallot,
} from "./ballotSession";

describe("ballotSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("round-trips the saved ballot", () => {
    const ballot = { state: "Texas", district: "07", raceIds: ["tx-07"] };
    writeSavedBallot(ballot);
    expect(readSavedBallot()).toEqual(ballot);
    clearSavedBallot();
    expect(readSavedBallot()).toBeNull();
  });

  it("ignores malformed entries", () => {
    sessionStorage.setItem(BALLOT_SESSION_KEY, "{not json");
    expect(readSavedBallot()).toBeNull();
    sessionStorage.setItem(BALLOT_SESSION_KEY, JSON.stringify({ state: "TX" }));
    expect(readSavedBallot()).toBeNull();
  });

  it("links back only to races on the saved ballot", () => {
    writeSavedBallot({
      state: "New York",
      district: "12",
      raceIds: ["ny-12-house-2026", "ny-senate-2026"],
    });
    expect(ballotReturnHref("ny-senate-2026")).toBe(
      "/my-ballot/?state=New+York&district=12&race=ny-senate-2026",
    );
    expect(ballotReturnHref("ga-senate-2026")).toBeNull();
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(ballotReturnHref("ny-senate-2026")).toBeNull();
  });
});
