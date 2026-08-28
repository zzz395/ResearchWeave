import { z } from "zod";

import {
  persistentResearchPaperResponseSchema,
  persistentResearchPaperSearchResultSchema,
  nullableResearchPaperSummaryResponseSchema,
  researchPaperSummaryResponseSchema,
  savedPaperListResponseSchema,
  savedPaperResponseSchema,
  type PersistentResearchPaper,
  type PersistentResearchPaperSearchResult,
  type ResearchSearchQuery,
  type ResearchPaperSummary,
  type SavedPaper,
} from "../../../../shared/contracts/research";
import { apiRequest } from "../../../services/api/client";

export async function searchResearchPapers(
  query: ResearchSearchQuery,
): Promise<PersistentResearchPaperSearchResult> {
  const search = new URLSearchParams({
    q: query.q,
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
  });
  return apiRequest(
    `/api/v1/research/papers/search?${search.toString()}`,
    persistentResearchPaperSearchResultSchema,
  );
}

export async function getResearchPaper(paperId: string): Promise<PersistentResearchPaper> {
  return (
    await apiRequest(
      `/api/v1/research/papers/${paperId}`,
      persistentResearchPaperResponseSchema,
    )
  ).paper;
}

export async function getResearchPaperSummary(
  paperId: string,
): Promise<ResearchPaperSummary | null> {
  return (
    await apiRequest(
      `/api/v1/research/papers/${paperId}/summary`,
      nullableResearchPaperSummaryResponseSchema,
    )
  ).summary;
}

export async function ensureResearchPaperSummary(
  paperId: string,
): Promise<ResearchPaperSummary> {
  return (
    await apiRequest(
      `/api/v1/research/papers/${paperId}/summary`,
      researchPaperSummaryResponseSchema,
      {
        method: "PUT",
        body: JSON.stringify({}),
        acceptedStatuses: [200, 201],
      },
    )
  ).summary;
}

export async function listSavedPapers(spaceId: string): Promise<SavedPaper[]> {
  return (
    await apiRequest(
      `/api/v1/spaces/${spaceId}/saved-papers`,
      savedPaperListResponseSchema,
    )
  ).savedPapers;
}

export async function savePaperToSpace(spaceId: string, paperId: string): Promise<SavedPaper> {
  return (
    await apiRequest(
      `/api/v1/spaces/${spaceId}/saved-papers/${paperId}`,
      savedPaperResponseSchema,
      {
        method: "PUT",
        body: JSON.stringify({}),
        acceptedStatuses: [200, 201],
      },
    )
  ).savedPaper;
}

export async function removeSavedPaper(spaceId: string, paperId: string): Promise<void> {
  await apiRequest(
    `/api/v1/spaces/${spaceId}/saved-papers/${paperId}`,
    z.undefined(),
    { method: "DELETE", acceptedStatuses: [204] },
  );
}
