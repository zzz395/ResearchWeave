import {
  paperComparisonGeneratedContentSchema,
  type PaperComparisonGeneratedContent,
  type PaperComparisonRequest,
  type PaperComparisonResponse,
} from "../../../shared/contracts/paper-comparison";
import type { PaperRecord } from "../../db/schema";
import type { PaperComparisonGenerator } from "../../integrations/paper-comparison/generator";
import {
  isPaperComparisonGeneratorError,
  type PaperComparisonGeneratorErrorCode,
} from "../../integrations/paper-comparison/errors";
import { AppError } from "../../middleware/app-error";
import type { SavedPaperRepository } from "../research/saved-paper-repository";
import type { SpaceRepository } from "../spaces/repository";
import { toPaperComparisonSource } from "./source";

export const PAPER_COMPARISON_PROMPT_VERSION = "abstract-comparison-v1" as const;
export const PAPER_COMPARISON_SOURCE_BASIS = {
  type: "arxiv_metadata_and_abstracts",
  label: "Abstract-based comparison",
  description:
    "This comparison uses stored arXiv metadata and abstracts only. It does not use or claim access to full text or indexed documents.",
} as const;

const generatorErrorMap: Record<
  PaperComparisonGeneratorErrorCode,
  { status: number; code: string; message: string }
> = {
  COMPARISON_UPSTREAM_TIMEOUT: {
    status: 504,
    code: "comparison_upstream_timeout",
    message: "Paper comparison generation timed out.",
  },
  COMPARISON_UPSTREAM_FAILURE: {
    status: 502,
    code: "comparison_upstream_failure",
    message: "The comparison provider request failed.",
  },
  COMPARISON_INVALID_RESPONSE: {
    status: 502,
    code: "comparison_invalid_response",
    message: "The generated comparison could not be validated.",
  },
  COMPARISON_RESPONSE_TOO_LARGE: {
    status: 502,
    code: "comparison_invalid_response",
    message: "The generated comparison could not be validated.",
  },
};

export interface PaperComparisonService {
  compare(
    spaceId: string,
    actorId: string,
    input: PaperComparisonRequest,
  ): Promise<PaperComparisonResponse>;
}

function toResponsePaper(paper: PaperRecord): PaperComparisonResponse["papers"][number] {
  return {
    id: paper.id,
    canonicalArxivId: paper.canonicalArxivId,
    versionedArxivId: paper.versionedArxivId,
    version: paper.version,
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.authors,
    primaryCategory: paper.primaryCategory,
    categories: paper.categories,
    publishedAt: paper.publishedAt.toISOString(),
    updatedAt: paper.updatedAt.toISOString(),
    absUrl: paper.absUrl,
    pdfUrl: paper.pdfUrl,
  };
}

function hasUsableSource(paper: PaperRecord): boolean {
  return (
    paper.title.trim().length > 0 &&
    paper.abstract.trim().length > 0 &&
    paper.authors.length > 0 &&
    paper.authors.every((author) => author.trim().length > 0) &&
    paper.primaryCategory.trim().length > 0 &&
    paper.categories.length > 0 &&
    paper.categories.every((category) => category.trim().length > 0)
  );
}

function invalidComparisonResponse(): AppError {
  return new AppError(
    502,
    "comparison_invalid_response",
    "The generated comparison could not be validated.",
  );
}

function normalizeGeneratedContent(
  generated: unknown,
  paperIds: string[],
): PaperComparisonGeneratedContent {
  const parsed = paperComparisonGeneratedContentSchema.safeParse(generated);
  if (!parsed.success) throw invalidComparisonResponse();

  const expectedPaperIds = new Set(paperIds);
  const dimensions = parsed.data.dimensions.map((dimension) => {
    if (dimension.observations.length !== paperIds.length) {
      throw invalidComparisonResponse();
    }
    const observationsByPaperId = new Map(
      dimension.observations.map((observation) => [observation.paperId, observation]),
    );
    if (
      observationsByPaperId.size !== paperIds.length ||
      dimension.observations.some(({ paperId }) => !expectedPaperIds.has(paperId))
    ) {
      throw invalidComparisonResponse();
    }
    return {
      ...dimension,
      observations: paperIds.map((paperId) => {
        const observation = observationsByPaperId.get(paperId);
        if (!observation) throw invalidComparisonResponse();
        return observation;
      }),
    };
  });

  return { ...parsed.data, dimensions };
}

export function createPaperComparisonService(
  savedPapers: SavedPaperRepository,
  spaces: SpaceRepository,
  generator?: PaperComparisonGenerator,
): PaperComparisonService {
  return {
    async compare(spaceId, actorId, input) {
      const loaded = await savedPapers.findManyForMember(spaceId, input.paperIds, actorId);
      if (loaded.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      if (loaded.records.length !== input.paperIds.length) {
        throw new AppError(
          404,
          "comparison_papers_not_found",
          "One or more saved papers were not found in this research space.",
        );
      }

      const recordsByPaperId = new Map(
        loaded.records.map((record) => [record.paper.id, record.paper]),
      );
      const papers = input.paperIds.map((paperId) => {
        const paper = recordsByPaperId.get(paperId);
        if (!paper) {
          throw new AppError(
            404,
            "comparison_papers_not_found",
            "One or more saved papers were not found in this research space.",
          );
        }
        return paper;
      });

      const unavailablePaperIds = papers
        .filter((paper) => !hasUsableSource(paper))
        .map((paper) => paper.id);
      if (unavailablePaperIds.length > 0) {
        throw new AppError(
          409,
          "comparison_source_unavailable",
          "One or more saved papers do not have usable metadata and abstract evidence.",
          { paperIds: unavailablePaperIds },
        );
      }
      if (!generator) {
        throw new AppError(
          503,
          "comparison_unavailable",
          "Paper comparison generation is currently unavailable.",
        );
      }

      let generated: unknown;
      try {
        generated = await generator.generate(papers.map(toPaperComparisonSource));
      } catch (error: unknown) {
        if (!isPaperComparisonGeneratorError(error)) throw error;
        const mapped = generatorErrorMap[error.code];
        throw new AppError(mapped.status, mapped.code, mapped.message);
      }
      const comparison = normalizeGeneratedContent(generated, input.paperIds);

      if (!(await spaces.findForMember(spaceId, actorId))) {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }

      return {
        sourceBasis: PAPER_COMPARISON_SOURCE_BASIS,
        papers: papers.map(toResponsePaper),
        comparison,
        generation: {
          model: generator.model,
          promptVersion: PAPER_COMPARISON_PROMPT_VERSION,
          generatedAt: new Date().toISOString(),
        },
      };
    },
  };
}
