import { describe, expect, it } from "vitest";
import { avatarSrc } from "./avatar";

describe("avatarSrc", () => {
  it("rewrites Wikimedia originals to a standard-width thumbnail", () => {
    expect(
      avatarSrc(
        "https://upload.wikimedia.org/wikipedia/commons/5/50/Amish_Shah_by_Gage_Skidmore_2.jpg",
      ),
    ).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Amish_Shah_by_Gage_Skidmore_2.jpg/250px-Amish_Shah_by_Gage_Skidmore_2.jpg",
    );
  });

  it("thumbnails SVG originals as PNG", () => {
    expect(
      avatarSrc("https://upload.wikimedia.org/wikipedia/commons/a/ab/Logo.svg"),
    ).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Logo.svg/250px-Logo.svg.png",
    );
  });

  it("leaves existing thumbnails and other hosts alone", () => {
    const thumb =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/X.jpg/120px-X.jpg";
    expect(avatarSrc(thumb)).toBe(thumb);
    expect(avatarSrc("https://s3.amazonaws.com/ballotpedia/x.jpg")).toBe(
      "https://s3.amazonaws.com/ballotpedia/x.jpg",
    );
    expect(avatarSrc(null)).toBeUndefined();
  });
});
