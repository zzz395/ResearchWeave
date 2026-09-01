import { describe, expect, it } from "vitest";

import {
  beginSavePaperWorkflow,
  completeSavePaperWorkflow,
  getResearchWorkflowRoutes,
  SAVED_PAPER_KNOWLEDGE_GUIDANCE,
} from "../../src/features/research/research-workflow";

describe("Research to Knowledge workflow", () => {
  it("preserves the successful Space for explicit continuation routes", () => {
    const savedSpace = completeSavePaperWorkflow({ id: "space-1", name: "RAG Systems" });

    expect(savedSpace).toEqual({ id: "space-1", name: "RAG Systems" });
    expect(getResearchWorkflowRoutes(savedSpace.id)).toEqual({
      savedPapers: "/spaces/space-1/saved-papers",
      knowledge: "/spaces/space-1/knowledge",
    });
  });

  it("starts each newly opened Save workflow without stale success state", () => {
    expect(beginSavePaperWorkflow()).toEqual({ selectedSpaceId: "", savedSpace: null });
  });

  it("describes a manual source handoff without claiming an automatic import", () => {
    expect(SAVED_PAPER_KNOWLEDGE_GUIDANCE).toContain("open or download the source");
    expect(SAVED_PAPER_KNOWLEDGE_GUIDANCE).toContain("upload it in Knowledge");
    expect(SAVED_PAPER_KNOWLEDGE_GUIDANCE).not.toMatch(/imported|linked|attached|added to knowledge/iu);
  });
});
