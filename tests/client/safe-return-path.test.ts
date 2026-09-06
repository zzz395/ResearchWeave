import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTHENTICATED_PATH,
  safeReturnPath,
} from "../../src/features/auth/safe-return-path";

describe("safeReturnPath", () => {
  it("keeps bounded local application paths", () => {
    expect(safeReturnPath("/spaces/123?view=record#main")).toBe(
      "/spaces/123?view=record#main",
    );
  });

  it("rejects external, protocol-relative, authentication, and oversized destinations", () => {
    expect(DEFAULT_AUTHENTICATED_PATH).toBe("/overview");
    expect(safeReturnPath(null)).toBe("/overview");
    expect(safeReturnPath("https://attacker.example/steal")).toBe("/overview");
    expect(safeReturnPath("//attacker.example/steal")).toBe("/overview");
    expect(safeReturnPath("/login?returnTo=/login")).toBe("/overview");
    expect(safeReturnPath("/register")).toBe("/overview");
    expect(safeReturnPath(`/${"a".repeat(513)}`)).toBe("/overview");
  });
});
