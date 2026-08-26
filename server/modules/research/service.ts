import { randomUUID } from "node:crypto";

import type {
  PersistentResearchPaper,
  PersistentResearchPaperSearchResult,
  ResearchSearchQuery,
  SavedPaper,
} from "../../../shared/contracts/research";
import type { ArxivClient } from "../../integrations/arxiv/client";
import {
  isArxivIntegrationError,
  type ArxivErrorCode,
} from "../../integrations/arxiv/errors";
import { AppError } from "../../middleware/app-error";
import type { PaperRecord } from "../../db/schema";
import type { PaperRepository } from "./paper-repository";
import type { SavedPaperRepository, SavedPaperWithPaper } from "./saved-paper-repository";

type ArxivSearchSource = Pick<ArxivClient, "search">;

function toPersistentPaper(record: PaperRecord): PersistentResearchPaper {
  return {
    id: record.id,
    canonicalArxivId: record.canonicalArxivId,
    versionedArxivId: record.versionedArxivId,
    version: record.version,
    title: record.title,
    abstract: record.abstract,
    authors: record.authors,
    primaryCategory: record.primaryCategory,
    categories: record.categories,
    publishedAt: record.publishedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.comment === null ? {} : { comment: record.comment }),
    ...(record.journalRef === null ? {} : { journalRef: record.journalRef }),
    ...(record.doi === null ? {} : { doi: record.doi }),
    absUrl: record.absUrl,
    pdfUrl: record.pdfUrl,
    fetchedAt: record.fetchedAt.toISOString(),
  };
}

function toSavedPaper(record: SavedPaperWithPaper): SavedPaper {
  return {
    paper: toPersistentPaper(record.paper),
    savedByUserId: record.savedByUserId,
    savedAt: record.savedAt.toISOString(),
  };
}

const arxivErrorMap: Record<ArxivErrorCode, { status: number; code: string; message: string }> = {
  ARXIV_QUEUE_FULL: {
    status: 503,
    code: "research_temporarily_unavailable",
    message: "Research search is temporarily busy. Please try again shortly.",
  },
  ARXIV_RATE_LIMITED: {
    status: 503,
    code: "research_temporarily_unavailable",
    message: "Research search is temporarily unavailable. Please try again later.",
  },
  ARXIV_TIMEOUT: {
    status: 504,
    code: "research_upstream_timeout",
    message: "The academic metadata provider did not respond in time.",
  },
  ARXIV_UPSTREAM_ERROR: {
    status: 502,
    code: "research_upstream_failure",
    message: "The academic metadata provider returned an unsuccessful response.",
  },
  ARXIV_RESPONSE_TOO_LARGE: {
    status: 502,
    code: "research_upstream_failure",
    message: "The academic metadata provider returned an invalid response.",
  },
  ARXIV_INVALID_RESPONSE: {
    status: 502,
    code: "research_upstream_failure",
    message: "The academic metadata provider returned an invalid response.",
  },
};

function mapArxivError(error: unknown): never {
  if (!isArxivIntegrationError(error)) throw error;
  const mapped = arxivErrorMap[error.code];
  throw new AppError(mapped.status, mapped.code, mapped.message);
}

export interface SavePaperServiceResult {
  savedPaper: SavedPaper;
  created: boolean;
}

export interface ResearchService {
  searchPapers(query: ResearchSearchQuery): Promise<PersistentResearchPaperSearchResult>;
  getPaper(paperId: string): Promise<PersistentResearchPaper>;
  listSavedPapers(spaceId: string, actorId: string): Promise<SavedPaper[]>;
  savePaper(spaceId: string, paperId: string, actorId: string): Promise<SavePaperServiceResult>;
  removeSavedPaper(spaceId: string, paperId: string, actorId: string): Promise<void>;
}

export function createResearchService(
  paperRepository: PaperRepository,
  savedPaperRepository: SavedPaperRepository,
  arxivClient: ArxivSearchSource,
): ResearchService {
  return {
    async searchPapers(query) {
      let searchResult;
      try {
        searchResult = await arxivClient.search(query);
      } catch (error: unknown) {
        mapArxivError(error);
      }

      const fetchedAt = new Date();
      const persisted = await paperRepository.upsertMany(
        searchResult.papers.map((paper) => ({
          id: randomUUID(),
          canonicalArxivId: paper.canonicalArxivId,
          versionedArxivId: paper.versionedArxivId,
          version: paper.version,
          title: paper.title,
          abstract: paper.abstract,
          authors: paper.authors,
          primaryCategory: paper.primaryCategory,
          categories: paper.categories,
          publishedAt: new Date(paper.publishedAt),
          updatedAt: new Date(paper.updatedAt),
          comment: paper.comment ?? null,
          journalRef: paper.journalRef ?? null,
          doi: paper.doi ?? null,
          absUrl: paper.absUrl,
          pdfUrl: paper.pdfUrl,
          fetchedAt,
        })),
      );

      return {
        totalResults: searchResult.totalResults,
        startIndex: searchResult.startIndex,
        itemsPerPage: searchResult.itemsPerPage,
        papers: persisted.map(toPersistentPaper),
      };
    },

    async getPaper(paperId) {
      const paper = await paperRepository.findById(paperId);
      if (!paper) throw new AppError(404, "paper_not_found", "Paper was not found.");
      return toPersistentPaper(paper);
    },

    async listSavedPapers(spaceId, actorId) {
      const result = await savedPaperRepository.listForMember(spaceId, actorId);
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      return result.records.map(toSavedPaper);
    },

    async savePaper(spaceId, paperId, actorId) {
      const result = await savedPaperRepository.saveForMember({
        spaceId,
        paperId,
        actorId,
        savedAt: new Date(),
      });
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      if (result.status === "paper_not_found") {
        throw new AppError(404, "paper_not_found", "Paper was not found.");
      }
      return { savedPaper: toSavedPaper(result.record), created: result.status === "created" };
    },

    async removeSavedPaper(spaceId, paperId, actorId) {
      const result = await savedPaperRepository.removeForMember(spaceId, paperId, actorId);
      if (result.status === "removed") return;
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      if (result.status === "saved_paper_not_found") {
        throw new AppError(404, "saved_paper_not_found", "Saved paper was not found.");
      }
      throw new AppError(
        403,
        "saved_paper_forbidden",
        "Only the original saver or the space owner can remove this paper.",
      );
    },
  };
}
