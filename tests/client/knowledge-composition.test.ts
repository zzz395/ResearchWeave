import { describe, expect, it } from "vitest";

import type { Document } from "../../shared/contracts/documents";
import { isTrueZeroDocumentList } from "../../src/features/knowledge/document-presentation";
import { getAskKnowledgeInstanceKey } from "../../src/features/knowledge/knowledge-page-state";

describe("Knowledge workflow composition", () => {
  it("recognizes true zero only after an exhausted successful list", () => {
    expect(isTrueZeroDocumentList([], null)).toBe(true);
    expect(isTrueZeroDocumentList([], undefined)).toBe(false);
    expect(isTrueZeroDocumentList([], "next-page")).toBe(false);
    expect(isTrueZeroDocumentList([{} as Document], null)).toBe(false);
  });

  it("uses the Space id as the Ask instance key", () => {
    expect(getAskKnowledgeInstanceKey("space-1")).toBe("space-1");
    expect(getAskKnowledgeInstanceKey("space-2")).toBe("space-2");
    expect(getAskKnowledgeInstanceKey("space-1"))
      .not.toBe(getAskKnowledgeInstanceKey("space-2"));
  });
});
