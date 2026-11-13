import { cleanup, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ResultBanner from "./ResultBanner.svelte";
import type { PublicRaceResult } from "$lib/types";
import { newestResult } from "$lib/utils/results";

const base: PublicRaceResult = {
  id: "oh-governor-2026",
  status: "counting",
  as_of: "2026-11-04T02:00:00Z",
  candidates: [
    { name: "Ann Lee", pct: 48, votes: 100 },
    { name: "Bob Ray", pct: 52, votes: 110 },
  ],
  sources: [{ url: "https://example.com/results" }],
};

function show(overrides: Partial<PublicRaceResult> = {}) {
  return render(ResultBanner, {
    props: { raceId: base.id, result: { ...base, ...overrides } },
  });
}

describe("ResultBanner", () => {
  it("names who leads a partial count and names no winner", () => {
    show();
    expect(screen.getByText(/leads by|Tied|Counting/)).toBeTruthy();
    expect(screen.queryByLabelText("Winner")).toBeNull();
    expect(screen.getByText("Unofficial")).toBeTruthy();
    expect(screen.queryByText(/Called by/)).toBeNull();
  });

  it("labels a called race unofficial and credits the caller", () => {
    show({
      status: "called",
      winner_name: "Bob Ray",
      winner_party: "Republican",
      called_by: "AP",
    });
    expect(screen.getByText("Projected winner")).toBeTruthy();
    expect(screen.getByLabelText("Winner")).toBeTruthy();
    expect(screen.getByText(/Called by AP/)).toBeTruthy();
    expect(screen.getByText("Unofficial")).toBeTruthy();
  });

  it("spaces the winner's party and writes the runoff date out", () => {
    show({
      status: "called",
      winner_name: "Bob Ray",
      winner_party: "Republican",
    });
    expect(screen.getByText("Republican")).toBeTruthy();
    cleanup();
    show({ status: "runoff_required", runoff_date: "2026-12-01" });
    expect(screen.getByText("Runoff on December 1, 2026")).toBeTruthy();
  });

  it("drops the unofficial label only once certified", () => {
    show({ status: "certified", winner_name: "Bob Ray" });
    expect(screen.queryByText("Unofficial")).toBeNull();
  });

  it("links to the race's compare page", () => {
    show();
    expect(
      screen
        .getByRole("link", { name: /Compare the candidates/ })
        .getAttribute("href"),
    ).toBe("/races/oh-governor-2026/compare/");
  });

  it("never links to an unsafe source", () => {
    show({ sources: [{ url: "javascript:alert(1)" }] });
    expect(screen.queryByText(/alert/)).toBeNull();
  });

  it("orders candidates by share, not by the file's order", () => {
    const { container } = show();
    const names = [...container.querySelectorAll("li span[title]")]
      .map((node) => node.getAttribute("title"))
      .filter((title) => title === "Ann Lee" || title === "Bob Ray");
    expect(names).toEqual(["Bob Ray", "Ann Lee"]);
  });

  it("renders nothing before votes are reported", () => {
    const { container } = show({ status: "not_yet_reported" });
    expect(container.querySelector("section")).toBeNull();
  });
});

describe("newestResult", () => {
  const older: PublicRaceResult = { ...base, as_of: "2026-11-04T01:00:00Z" };
  const newer: PublicRaceResult = {
    ...base,
    status: "called",
    as_of: "2026-11-04T02:00:00Z",
  };

  it("never lets a stale live copy replace a newer built one", () => {
    expect(newestResult(newer, older)).toBe(newer);
    expect(newestResult(older, newer)).toBe(newer);
  });

  it("handles either side missing", () => {
    expect(newestResult(null, older)).toBe(older);
    expect(newestResult(older, undefined)).toBe(older);
    expect(newestResult(null, null)).toBeNull();
  });
});
