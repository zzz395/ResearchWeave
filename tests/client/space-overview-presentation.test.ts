import { describe, expect, it } from "vitest";

import {
  getOverviewDocumentCountLabel,
  isOverviewDocumentListEmpty,
  resolveOverviewCollection,
} from "../../src/features/spaces/space-overview-presentation";

describe("Space Overview supporting data", () => {
  it("keeps loading, error, and ready collections independent", () => {
    const savedPapers = resolveOverviewCollection({
      data: ["paper-1", "paper-2"],
      isError: false,
      isPending: false,
    });
    const members = resolveOverviewCollection<string>({
      data: undefined,
      isError: true,
      isPending: false,
    });
    const documents = resolveOverviewCollection<string>({
      data: undefined,
      isError: false,
      isPending: true,
    });

    expect(savedPapers).toEqual({ status: "ready", items: ["paper-1", "paper-2"] });
    expect(members).toEqual({ status: "error" });
    expect(documents).toEqual({ status: "loading" });
  });

  it("does not turn an error without data into an empty collection", () => {
    expect(resolveOverviewCollection({ data: undefined, isError: true, isPending: false }))
      .toEqual({ status: "error" });
  });

  it("uses loaded wording while another documents page exists", () => {
    expect(getOverviewDocumentCountLabel({ count: 50, nextCursor: "next-page" }))
      .toBe("50 loaded");
  });

  it("uses a complete document count only when pagination is exhausted", () => {
    expect(getOverviewDocumentCountLabel({ count: 1, nextCursor: null })).toBe("1 document");
    expect(getOverviewDocumentCountLabel({ count: 3, nextCursor: null })).toBe("3 documents");
  });

  it("does not claim the Space is empty while another document page exists", () => {
    expect(isOverviewDocumentListEmpty({ count: 0, nextCursor: "next-page" })).toBe(false);
    expect(isOverviewDocumentListEmpty({ count: 0, nextCursor: null })).toBe(true);
    expect(isOverviewDocumentListEmpty({ count: 1, nextCursor: null })).toBe(false);
  });
});
