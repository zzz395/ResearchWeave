import { describe, expect, it } from "vitest";

import {
  createActivitySearchParams,
  parseActivitySearchParams,
} from "../../src/features/activity/activity-url-state";

const spaceId = "10000000-0000-4000-8000-000000000001";

describe("Activity URL state", () => {
  it("defaults to all categories and all Spaces", () => {
    expect(parseActivitySearchParams(new URLSearchParams())).toEqual({});
  });

  it.each(["collaboration", "research", "knowledge", "agents"] as const)(
    "accepts the %s category",
    (category) => {
      expect(parseActivitySearchParams(new URLSearchParams({ category }))).toEqual({ category });
    },
  );

  it("accepts a valid UUID and combined filters", () => {
    expect(parseActivitySearchParams(new URLSearchParams({ spaceId }))).toEqual({ spaceId });
    expect(parseActivitySearchParams(new URLSearchParams({ category: "knowledge", spaceId })))
      .toEqual({ category: "knowledge", spaceId });
  });

  it("ignores malformed categories and Space identifiers", () => {
    expect(parseActivitySearchParams(new URLSearchParams({
      category: "everything",
      spaceId: "not-a-uuid",
    }))).toEqual({});
  });

  it("serializes canonically without cursor or pagination state", () => {
    const params = createActivitySearchParams({ category: "agents", spaceId });
    expect(params.toString()).toBe(`category=agents&spaceId=${spaceId}`);
    expect(params.has("cursor")).toBe(false);
    expect(params.has("limit")).toBe(false);
  });

  it("does not serialize an invalid client-generated Space identifier", () => {
    expect(createActivitySearchParams({ category: "research", spaceId: "invalid" }).toString())
      .toBe("category=research");
  });
});
