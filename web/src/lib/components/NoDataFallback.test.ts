import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import NoDataFallback from "./NoDataFallback.svelte";

const template = readFileSync(
  resolve(process.cwd(), "../.github/ISSUE_TEMPLATE/missing-data.yml"),
  "utf8",
);

function issueLink(): URL {
  const link = screen.getByRole("link", { name: /Help improve this data/ });
  return new URL(link.getAttribute("href") ?? "");
}

describe("NoDataFallback", () => {
  afterEach(cleanup);

  it.each([
    ["issues", "Issue stances / positions"],
    ["donors", "Donor information"],
    ["voting", "Voting record"],
  ] as const)(
    "prefills the %s data-type checkbox from the issue template",
    (dataType, label) => {
      render(NoDataFallback, {
        dataType,
        raceId: "pa-senate-2026",
        candidateName: "Jane Smith",
      });
      const url = issueLink();
      expect(url.pathname).toBe("/SmarterVote/SmarterVote/issues/new");
      expect(url.searchParams.get("template")).toBe("missing-data.yml");
      expect(url.searchParams.get("race-id")).toBe("pa-senate-2026");
      expect(url.searchParams.get("candidate-name")).toBe("Jane Smith");
      expect(url.searchParams.get("data-type")).toBe(label);
      // The prefill only works while the template still has this field/option.
      expect(template).toContain("id: data-type");
      expect(template).toContain(`- label: ${label}`);
    },
  );

  it("omits data-type for the general fallback", () => {
    render(NoDataFallback, {});
    const url = issueLink();
    expect(url.searchParams.has("data-type")).toBe(false);
    expect(url.searchParams.get("title")).toContain("Unknown Candidate");
    expect(screen.getByText(/haven't found this information/)).toBeTruthy();
  });
});
