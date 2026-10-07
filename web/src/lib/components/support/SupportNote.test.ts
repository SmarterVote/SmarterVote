import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SupportNote from "./SupportNote.svelte";

describe("SupportNote", () => {
  it("explains founder funding and links to the support page", () => {
    render(SupportNote);

    expect(screen.getByText(/funded entirely by its founder/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Help keep it running" })
        .getAttribute("href"),
    ).toBe("/support/");
  });
});
