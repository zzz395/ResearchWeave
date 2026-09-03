import type {
  AskKnowledgeRequest,
  GroundedAnswerCitation,
  GroundedAnswerResponse,
} from "../../../shared/contracts/grounded-answer";
import {
  groundedAnswerGenerationResultSchema,
  type GroundedAnswerGenerator,
} from "../../integrations/grounded-answer/generator";
import {
  isGroundedAnswerGeneratorError,
  type GroundedAnswerGeneratorErrorCode,
} from "../../integrations/grounded-answer/errors";
import { AppError } from "../../middleware/app-error";
import type { SemanticRetrievalResult } from "../../../shared/contracts/retrieval";
import type { SemanticRetrievalService } from "../retrieval/service";

const RETRIEVAL_LIMIT = 8;
export const INSUFFICIENT_CONTEXT_ANSWER =
  "The available knowledge does not provide enough information to answer this question.";
const INLINE_SOURCE_MARKER = /\[(S\d+)\]/gu;

export interface GroundedAnswerMembershipChecker {
  hasMembership(spaceId: string, actorId: string): Promise<boolean>;
}

export interface GroundedAnswerService {
  answer(
    spaceId: string,
    actorId: string,
    input: AskKnowledgeRequest,
  ): Promise<GroundedAnswerResponse>;
  answerWithSources(
    spaceId: string,
    actorId: string,
    input: AskKnowledgeRequest,
  ): Promise<GroundedAnswerWithSourcesResult>;
}

export interface GroundedAnswerSourceSnapshot extends GroundedAnswerCitation {
  content: string;
}

export interface GroundedAnswerWithSourcesResult {
  response: GroundedAnswerResponse;
  sources: GroundedAnswerSourceSnapshot[];
}

const generatorErrorMap: Record<
  GroundedAnswerGeneratorErrorCode,
  { status: number; code: string; message: string }
> = {
  ANSWER_UPSTREAM_TIMEOUT: {
    status: 504,
    code: "answer_upstream_timeout",
    message: "Answer generation timed out.",
  },
  ANSWER_UPSTREAM_FAILURE: {
    status: 502,
    code: "answer_upstream_failure",
    message: "The answer provider request failed.",
  },
  ANSWER_UPSTREAM_REJECTED: {
    status: 502,
    code: "answer_upstream_failure",
    message: "The answer provider returned an unsuccessful response.",
  },
  ANSWER_INVALID_RESPONSE: {
    status: 502,
    code: "answer_invalid_response",
    message: "The generated answer could not be validated.",
  },
  ANSWER_RESPONSE_TOO_LARGE: {
    status: 502,
    code: "answer_invalid_response",
    message: "The generated answer could not be validated.",
  },
};

function invalidAnswerResponse(): AppError {
  return new AppError(
    502,
    "answer_invalid_response",
    "The generated answer could not be validated.",
  );
}

function extractUniqueSourceMarkers(answer: string): string[] {
  const seen = new Set<string>();
  const sequence: string[] = [];
  for (const match of answer.matchAll(INLINE_SOURCE_MARKER)) {
    const sourceId = match[1];
    if (sourceId && !seen.has(sourceId)) {
      seen.add(sourceId);
      sequence.push(sourceId);
    }
  }
  return sequence;
}

function citationFor(sourceId: string, source: SemanticRetrievalResult): GroundedAnswerCitation {
  return {
    sourceId,
    documentId: source.documentId,
    originalFilename: source.originalFilename,
    ordinal: source.ordinal,
    contentHash: source.contentHash,
    pageNumber: source.pageNumber,
    startOffset: source.startOffset,
    endOffset: source.endOffset,
  };
}

function sourceSnapshotFor(
  sourceId: string,
  source: SemanticRetrievalResult,
): GroundedAnswerSourceSnapshot {
  return {
    ...citationFor(sourceId, source),
    content: source.content,
  };
}

export function createGroundedAnswerService(
  retrievalService: SemanticRetrievalService,
  membershipChecker: GroundedAnswerMembershipChecker,
  generator?: GroundedAnswerGenerator,
): GroundedAnswerService {
  async function requireCurrentMembership(spaceId: string, actorId: string): Promise<void> {
    if (!(await membershipChecker.hasMembership(spaceId, actorId))) {
      throw new AppError(404, "space_not_found", "Research space was not found.");
    }
  }

  async function answerWithSources(
    spaceId: string,
    actorId: string,
    input: AskKnowledgeRequest,
  ): Promise<GroundedAnswerWithSourcesResult> {
    const retrieval = await retrievalService.retrieve(spaceId, actorId, {
      query: input.query,
      limit: RETRIEVAL_LIMIT,
    });

    if (retrieval.results.length === 0) {
      await requireCurrentMembership(spaceId, actorId);
      return {
        response: {
          status: "insufficient_context",
          answer: INSUFFICIENT_CONTEXT_ANSWER,
          citations: [],
        },
        sources: [],
      };
    }

    if (!generator) {
      throw new AppError(
        503,
        "answer_generation_unavailable",
        "Answer generation is currently unavailable.",
      );
    }

    const sourceMap = new Map<string, SemanticRetrievalResult>();
    const sources = retrieval.results.map((result, index) => {
      const sourceId = `S${index + 1}`;
      sourceMap.set(sourceId, result);
      return {
        sourceId,
        content: result.content,
        originalFilename: result.originalFilename,
        pageNumber: result.pageNumber,
        ordinal: result.ordinal,
      };
    });

    let generated: unknown;
    try {
      generated = await generator.generate({ question: input.query, sources });
    } catch (error: unknown) {
      if (!isGroundedAnswerGeneratorError(error)) throw error;
      const mapped = generatorErrorMap[error.code];
      throw new AppError(mapped.status, mapped.code, mapped.message);
    }

    const parsed = groundedAnswerGenerationResultSchema.safeParse(generated);
    if (!parsed.success) throw invalidAnswerResponse();
    const markers = extractUniqueSourceMarkers(parsed.data.answer);

    if (parsed.data.status === "insufficient_context") {
      if (markers.length > 0) throw invalidAnswerResponse();
      await requireCurrentMembership(spaceId, actorId);
      return {
        response: {
          status: "insufficient_context",
          answer: INSUFFICIENT_CONTEXT_ANSWER,
          citations: [],
        },
        sources: [],
      };
    }

    if (
      markers.length === 0 ||
      markers.length !== parsed.data.sourceIds.length ||
      markers.some((sourceId, index) => sourceId !== parsed.data.sourceIds[index]) ||
      parsed.data.sourceIds.some((sourceId) => !sourceMap.has(sourceId))
    ) {
      throw invalidAnswerResponse();
    }

    const citedSourceRecords = parsed.data.sourceIds.map((sourceId) => {
      const source = sourceMap.get(sourceId);
      if (!source) throw invalidAnswerResponse();
      return { sourceId, source };
    });
    const citations = citedSourceRecords.map(({ sourceId, source }) =>
      citationFor(sourceId, source),
    );
    const citedSources = citedSourceRecords.map(({ sourceId, source }) =>
      sourceSnapshotFor(sourceId, source),
    );

    await requireCurrentMembership(spaceId, actorId);
    return {
      response: { status: "answered", answer: parsed.data.answer, citations },
      sources: citedSources,
    };
  }

  return {
    async answer(spaceId, actorId, input) {
      return (await answerWithSources(spaceId, actorId, input)).response;
    },
    answerWithSources,
  };
}
