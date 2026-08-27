import { describe, expect, it } from "vitest";

import {
  createResearchSearchParams,
  isValidSubmittedQuery,
  parseResearchSearchParams,
} from "../../src/features/research/research-search-state";

describe("research search URL state", () => {
  it("normalizes a submitted query and reads valid paging and sorting", () => {
    const state = parseResearchSearchParams(
      new URLSearchParams("q=%20retrieval%20%20augmented%20generation%20&page=3&sort=updated"),
    );

    expect(state).toEqual({ q: "retrieval augmented generation", page: 3, sort: "updated" });
  });

  it("falls back for invalid page and sort values", () => {
    expect(parseResearchSearchParams(new URLSearchParams("q=agents&page=-2&sort=newest")))
      .toEqual({ q: "agents", page: 1, sort: "relevance" });
  });

  it("serializes the canonical query, page, and sort state", () => {
    expect(createResearchSearchParams({ q: "  graph   neural nets ", page: 4, sort: "submitted" }).toString())
      .toBe("q=graph+neural+nets&page=4&sort=submitted");
  });

  it("accepts only submitted queries between 2 and 200 normalized characters", () => {
    expect(isValidSubmittedQuery(" a ")).toBe(false);
    expect(isValidSubmittedQuery(" ai ")).toBe(true);
    expect(isValidSubmittedQuery("x".repeat(200))).toBe(true);
    expect(isValidSubmittedQuery("x".repeat(201))).toBe(false);
  });
});
