import { describe, expect, it } from "vitest";

import type { Document } from "../../shared/contracts/documents";
import { isTrueZeroDocumentList } from "../../src/features/knowledge/document-presentation";
import {
  createKnowledgeDocumentSearchParams,
  getAskKnowledgeInstanceKey,
  getKnowledgeDocumentId,
} from "../../src/features/knowledge/knowledge-page-state";

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

  it("opens and closes a URL-backed document without losing other query state", () => {
    const documentId = "10000000-0000-4000-8000-000000000001";
    const initial = new URLSearchParams("view=active");
    const opened = createKnowledgeDocumentSearchParams(initial, documentId);

    expect(opened.toString()).toBe("view=active&document=10000000-0000-4000-8000-000000000001");
    expect(getKnowledgeDocumentId(opened)).toBe(documentId);
    expect(createKnowledgeDocumentSearchParams(opened, null).toString()).toBe("view=active");
    expect(initial.toString()).toBe("view=active");
  });

  it("does not open a document for an invalid URL identifier", () => {
    expect(getKnowledgeDocumentId(new URLSearchParams("document=not-a-uuid"))).toBeNull();
  });
});
