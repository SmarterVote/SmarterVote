import { describe, expect, it } from "vitest";
import { authErrorMessage, GENERIC_AUTH_ERROR_MESSAGE } from "./authErrors";

describe("authErrorMessage", () => {
  it("maps known Auth0 error codes to fixed copy", () => {
    expect(authErrorMessage("access_denied")).toMatch(/Access was denied/);
    expect(authErrorMessage(" LOGIN_REQUIRED ")).toMatch(/session ended/);
    expect(authErrorMessage("temporarily_unavailable")).toMatch(
      /temporarily unavailable/,
    );
  });

  it("falls back to generic copy for unknown, empty or prototype keys", () => {
    for (const code of [
      "Call 555-0100 to restore access",
      "",
      null,
      undefined,
      "constructor",
      "__proto__",
    ]) {
      expect(authErrorMessage(code)).toBe(GENERIC_AUTH_ERROR_MESSAGE);
    }
  });
});
