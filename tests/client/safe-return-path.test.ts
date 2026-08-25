import { describe, expect, it } from "vitest";

import { safeReturnPath } from "../../src/features/auth/safe-return-path";

describe("safeReturnPath", () => {
  it("keeps bounded local application paths", () => {
    expect(safeReturnPath("/spaces/123?view=record#main")).toBe(
      "/spaces/123?view=record#main",
    );
  });

  it("rejects external, protocol-relative, authentication, and oversized destinations", () => {
    expect(safeReturnPath("https://attacker.example/steal")).toBe("/spaces");
    expect(safeReturnPath("//attacker.example/steal")).toBe("/spaces");
    expect(safeReturnPath("/login?returnTo=/login")).toBe("/spaces");
    expect(safeReturnPath("/register")).toBe("/spaces");
    expect(safeReturnPath(`/${"a".repeat(513)}`)).toBe("/spaces");
  });
});
