export interface ResearchWorkflowSpace {
  id: string;
  name: string;
}

export const SAVED_PAPER_KNOWLEDGE_GUIDANCE =
  "Saved papers remain research references in this Space. For grounded questions, open or download the source, then upload it in Knowledge and wait for indexing.";

export function getResearchWorkflowRoutes(spaceId: string) {
  return {
    savedPapers: `/spaces/${spaceId}/saved-papers`,
    knowledge: `/spaces/${spaceId}/knowledge`,
  } as const;
}

export function beginSavePaperWorkflow() {
  return { selectedSpaceId: "", savedSpace: null } as const;
}

export function completeSavePaperWorkflow(space: ResearchWorkflowSpace): ResearchWorkflowSpace {
  return { id: space.id, name: space.name };
}
