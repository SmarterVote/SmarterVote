import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ArchiveNotice from "./ArchiveNotice.svelte";
import { isArchivedElectionYear, raceElectionYear } from "$lib/utils/archive";

const COPY =
  "2026 election archive: final pre-election research and forecasts, no longer updated.";

afterEach(cleanup);

describe("ArchiveNotice", () => {
  it("renders the exact copy as a note for a 2026 race", () => {
    render(ArchiveNotice, {
      props: {
        year: raceElectionYear({
          id: "ga-senate-2026",
          election_date: "2026-11-03",
        }),
      },
    });
    const note = screen.getByRole("note");
    expect(note.textContent?.replace(/\s+/g, " ").trim()).toBe(COPY);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("accepts a cycle year string, as the forecast page passes", () => {
    render(ArchiveNotice, { props: { year: "2026" } });
    expect(screen.getByRole("note")).toBeTruthy();
  });

  it("does not render for a non-2026 race", () => {
    render(ArchiveNotice, {
      props: {
        year: raceElectionYear({
          id: "ga-senate-2028",
          election_date: "2028-11-07",
        }),
      },
    });
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/election archive/)).toBeNull();
  });

  it("does not render without a known year", () => {
    render(ArchiveNotice, { props: { year: null } });
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("raceElectionYear", () => {
  it("prefers the election date's year", () => {
    expect(
      raceElectionYear({ id: "x-race-2026", election_date: "2028-11-07" }),
    ).toBe(2028);
  });

  it("falls back to the race id suffix", () => {
    expect(raceElectionYear({ id: "tx-07-2026", election_date: "" })).toBe(
      2026,
    );
    expect(raceElectionYear({ id: "tx-07-2028" })).toBe(2028);
    expect(raceElectionYear({ id: "no-year" })).toBeNull();
    expect(raceElectionYear(null)).toBeNull();
  });

  it("only the 2026 cycle is archived", () => {
    expect(isArchivedElectionYear(2026)).toBe(true);
    expect(isArchivedElectionYear("2026")).toBe(true);
    expect(isArchivedElectionYear(2028)).toBe(false);
    expect(isArchivedElectionYear(undefined)).toBe(false);
  });
});
