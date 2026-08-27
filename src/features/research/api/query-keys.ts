import type { ResearchSearchQuery } from "../../../../shared/contracts/research";

export const researchQueryKeys = {
  search(query: Pick<ResearchSearchQuery, "q" | "page" | "sort">) {
    return ["research", "search", query] as const;
  },
  paper(paperId: string) {
    return ["research", "paper", paperId] as const;
  },
  savedPapers(spaceId: string) {
    return ["spaces", spaceId, "saved-papers"] as const;
  },
};
