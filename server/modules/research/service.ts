import { randomUUID } from "node:crypto";

import type {
  PersistentResearchPaper,
  PersistentResearchPaperSearchResult,
  ResearchPaperSummary,
  ResearchSearchQuery,
  SavedPaper,
} from "../../../shared/contracts/research";
import { researchSummaryContentSchema } from "../../../shared/contracts/research";
import type { ArxivClient } from "../../integrations/arxiv/client";
import {
  isArxivIntegrationError,
  type ArxivErrorCode,
} from "../../integrations/arxiv/errors";
import { AppError } from "../../middleware/app-error";
import type { PaperRecord, PaperSummaryRecord } from "../../db/schema";
import type { ResearchSummaryGenerator } from "../../integrations/research-summary/generator";
import {
  isResearchSummaryGeneratorError,
  type ResearchSummaryGeneratorErrorCode,
} from "../../integrations/research-summary/errors";
import type { PaperRepository } from "./paper-repository";
import type { SavedPaperRepository, SavedPaperWithPaper } from "./saved-paper-repository";
import type { PaperSummaryRepository } from "./summary-repository";
import {
  createSummarySourceFingerprint,
  toPaperSummarySource,
  type PaperSummarySource,
} from "./summary-fingerprint";

type ArxivSearchSource = Pick<ArxivClient, "search">;

export const CURRENT_SUMMARY_PROMPT_VERSION = "abstract-summary-v1";

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

function toResearchPaperSummary(record: PaperSummaryRecord): ResearchPaperSummary {
  return {
    paperId: record.paperId,
    overview: record.overview,
    keyContributions: record.keyContributions,
    methodHighlights: record.methodHighlights,
    findings: record.findings,
    caveats: record.caveats,
    sourceVersion: record.sourceVersion,
    sourceUpdatedAt: record.sourceUpdatedAt.toISOString(),
    model: record.model,
    promptVersion: record.promptVersion,
    generatedAt: record.generatedAt.toISOString(),
  };
}

function isFreshSummary(record: PaperSummaryRecord, sourceFingerprint: string): boolean {
  return (
    record.sourceFingerprint === sourceFingerprint &&
    record.promptVersion === CURRENT_SUMMARY_PROMPT_VERSION
  );
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

const summaryErrorMap: Record<
  ResearchSummaryGeneratorErrorCode,
  { status: number; code: string; message: string }
> = {
  SUMMARY_UPSTREAM_TIMEOUT: {
    status: 504,
    code: "summary_upstream_timeout",
    message: "Summary generation timed out.",
  },
  SUMMARY_UPSTREAM_FAILURE: {
    status: 502,
    code: "summary_upstream_failure",
    message: "The summary provider returned an unsuccessful response.",
  },
  SUMMARY_INVALID_RESPONSE: {
    status: 502,
    code: "summary_invalid_response",
    message: "The generated summary could not be validated.",
  },
};

function mapSummaryGeneratorError(error: unknown): never {
  if (!isResearchSummaryGeneratorError(error)) throw error;
  const mapped = summaryErrorMap[error.code];
  throw new AppError(mapped.status, mapped.code, mapped.message);
}

export interface SavePaperServiceResult {
  savedPaper: SavedPaper;
  created: boolean;
}

export interface EnsurePaperSummaryServiceResult {
  summary: ResearchPaperSummary;
  created: boolean;
}

export interface ResearchService {
  searchPapers(query: ResearchSearchQuery): Promise<PersistentResearchPaperSearchResult>;
  getPaper(paperId: string): Promise<PersistentResearchPaper>;
  getPaperSummary(paperId: string): Promise<ResearchPaperSummary | null>;
  ensurePaperSummary(paperId: string): Promise<EnsurePaperSummaryServiceResult>;
  listSavedPapers(spaceId: string, actorId: string): Promise<SavedPaper[]>;
  savePaper(spaceId: string, paperId: string, actorId: string): Promise<SavePaperServiceResult>;
  removeSavedPaper(spaceId: string, paperId: string, actorId: string): Promise<void>;
}

export function createResearchService(
  paperRepository: PaperRepository,
  savedPaperRepository: SavedPaperRepository,
  arxivClient: ArxivSearchSource,
  summaryRepository: PaperSummaryRepository,
  summaryGenerator?: ResearchSummaryGenerator,
): ResearchService {
  type GenerationAttemptResult =
    | { status: "persisted"; record: PaperSummaryRecord }
    | { status: "source_changed"; source: PaperSummarySource };

  const generationInFlight = new Map<string, Promise<GenerationAttemptResult>>();

  function generationKey(source: PaperSummarySource, fingerprint: string) {
    return `${source.id}:${fingerprint}:${CURRENT_SUMMARY_PROMPT_VERSION}`;
  }

  async function getCurrentSource(paperId: string) {
    const paper = await paperRepository.findById(paperId);
    if (!paper) throw new AppError(404, "paper_not_found", "Paper was not found.");
    return toPaperSummarySource(paper);
  }

  function throwSourceChanged(): never {
    throw new AppError(
      409,
      "summary_source_changed",
      "The paper changed while its summary was being generated.",
    );
  }

  function coalesceGenerationAttempt(
    source: PaperSummarySource,
  ): Promise<GenerationAttemptResult> {
    const sourceFingerprint = createSummarySourceFingerprint(source);
    const key = generationKey(source, sourceFingerprint);
    const existing = generationInFlight.get(key);
    if (existing) return existing;

    const generation = (async (): Promise<GenerationAttemptResult> => {
      if (!summaryGenerator) {
        throw new AppError(
          503,
          "summary_unavailable",
          "Summary generation is currently unavailable.",
        );
      }

      let generated: unknown;
      try {
        generated = await summaryGenerator.generate(source);
      } catch (error: unknown) {
        mapSummaryGeneratorError(error);
      }
      const content = researchSummaryContentSchema.safeParse(generated);
      if (!content.success) {
        throw new AppError(
          502,
          "summary_invalid_response",
          "The generated summary could not be validated.",
        );
      }

      const currentSource = await getCurrentSource(source.id);
      if (createSummarySourceFingerprint(currentSource) !== sourceFingerprint) {
        return { status: "source_changed", source: currentSource };
      }

      const record: PaperSummaryRecord = {
        paperId: source.id,
        ...content.data,
        sourceFingerprint,
        sourceVersion: source.version,
        sourceUpdatedAt: source.updatedAt,
        model: summaryGenerator.model,
        promptVersion: CURRENT_SUMMARY_PROMPT_VERSION,
        generatedAt: new Date(),
      };
      const persisted = await summaryRepository.persistIfSourceCurrent(record);
      if (persisted.status === "paper_not_found") {
        throw new AppError(404, "paper_not_found", "Paper was not found.");
      }
      if (persisted.status === "source_changed") {
        return { status: "source_changed", source: await getCurrentSource(source.id) };
      }
      return { status: "persisted", record: persisted.record };
    })().finally(() => {
      generationInFlight.delete(key);
    });

    generationInFlight.set(key, generation);
    return generation;
  }

  async function generateStableSummary(initialSource: PaperSummarySource): Promise<PaperSummaryRecord> {
    let source = initialSource;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await coalesceGenerationAttempt(source);
      if (result.status === "persisted") return result.record;
      source = result.source;
    }
    return throwSourceChanged();
  }

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

    async getPaperSummary(paperId) {
      const source = await getCurrentSource(paperId);
      const summary = await summaryRepository.findByPaperId(paperId);
      const fingerprint = createSummarySourceFingerprint(source);
      return summary && isFreshSummary(summary, fingerprint)
        ? toResearchPaperSummary(summary)
        : null;
    },

    async ensurePaperSummary(paperId) {
      const source = await getCurrentSource(paperId);
      const fingerprint = createSummarySourceFingerprint(source);
      const existing = await summaryRepository.findByPaperId(paperId);
      if (existing && isFreshSummary(existing, fingerprint)) {
        return { summary: toResearchPaperSummary(existing), created: false };
      }
      const generated = await generateStableSummary(source);
      return { summary: toResearchPaperSummary(generated), created: true };
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
