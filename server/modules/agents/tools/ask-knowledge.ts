import { z } from "zod";

import type { AgentErrorCode } from "../../../../shared/contracts/agents";
import {
  groundedAnswerCitationSchema,
  groundedAnswerResponseSchema,
} from "../../../../shared/contracts/grounded-answer";
import type {
  GroundedAnswerService,
  GroundedAnswerSourceSnapshot,
  GroundedAnswerWithSourcesResult,
} from "../../grounded-answer/service";
import type { SpaceService } from "../../spaces/service";
import {
  knowledgeChunkEvidenceDraftSchema,
  type AgentTool,
  type AgentToolExecutionResult,
} from "./contracts";
import { executeAuthorizedTool, truncateUnicode } from "./helpers";
import { RETRIEVAL_TOOL_ERROR_CODE_VALUES } from "./search-knowledge-base";

export const askKnowledgeArgumentsSchema = z
  .object({ query: z.string().trim().min(2).max(2_000) })
  .strict();

const groundedAnswerSourceSnapshotSchema = groundedAnswerCitationSchema
  .extend({ content: z.string().min(1) })
  .strict();

const groundedAnswerWithSourcesSchema = z
  .object({
    response: groundedAnswerResponseSchema,
    sources: z.array(groundedAnswerSourceSnapshotSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.response.status === "insufficient_context") {
      if (value.sources.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Insufficient context cannot include source snapshots.",
          path: ["sources"],
        });
      }
      return;
    }
    if (value.response.citations.length !== value.sources.length) {
      context.addIssue({
        code: "custom",
        message: "Every answer citation must have one source snapshot.",
        path: ["sources"],
      });
      return;
    }
    value.response.citations.forEach((citation, index) => {
      const source = value.sources[index];
      if (!source || !sameSource(citation, source)) {
        context.addIssue({
          code: "custom",
          message: "Answer citations and source snapshots must match in order.",
          path: ["sources", index],
        });
      }
    });
  });

const askKnowledgeCitationObservationSchema = groundedAnswerCitationSchema
  .omit({ sourceId: true })
  .extend({
    sourceId: groundedAnswerCitationSchema.shape.sourceId,
    localEvidenceOrdinal: z.number().int().min(1).max(8),
    excerpt: z.string().trim().min(1).max(1_000),
  })
  .strict();

const askKnowledgeObservationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("answered"),
      answer: z.string().trim().min(1).max(8_000),
      citations: z.array(askKnowledgeCitationObservationSchema).min(1).max(8),
    })
    .strict(),
  z
    .object({
      status: z.literal("insufficient_context"),
      answer: z.string().trim().min(1).max(8_000),
      citations: z.array(askKnowledgeCitationObservationSchema).length(0),
    })
    .strict(),
]);

const askKnowledgeExecutionResultSchema: z.ZodType<AgentToolExecutionResult> = z
  .object({
    observation: askKnowledgeObservationSchema,
    evidence: z.array(knowledgeChunkEvidenceDraftSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.observation.status === "insufficient_context") {
      if (value.evidence.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Insufficient context cannot produce Agent evidence.",
          path: ["evidence"],
        });
      }
      return;
    }
    if (value.observation.citations.length !== value.evidence.length) {
      context.addIssue({
        code: "custom",
        message: "Every normalized citation must have one evidence draft.",
        path: ["evidence"],
      });
      return;
    }
    value.observation.citations.forEach((citation, index) => {
      const evidence = value.evidence[index];
      if (
        !evidence ||
        evidence.kind !== "knowledge_chunk" ||
        citation.localEvidenceOrdinal !== index + 1 ||
        evidence.documentId !== citation.documentId ||
        evidence.originalFilename !== citation.originalFilename ||
        evidence.contentHash !== citation.contentHash ||
        evidence.ordinal !== citation.ordinal ||
        evidence.pageNumber !== citation.pageNumber ||
        evidence.startOffset !== citation.startOffset ||
        evidence.endOffset !== citation.endOffset ||
        evidence.excerpt !== citation.excerpt
      ) {
        context.addIssue({
          code: "custom",
          message: "The answer observation and evidence provenance must match.",
          path: ["evidence", index],
        });
      }
    });
  });

const allowedErrorCodes = new Set<AgentErrorCode>([
  ...RETRIEVAL_TOOL_ERROR_CODE_VALUES,
  "answer_generation_unavailable",
  "answer_invalid_response",
  "answer_upstream_failure",
  "answer_upstream_timeout",
]);

export type AskKnowledgeArguments = z.infer<typeof askKnowledgeArgumentsSchema>;

function sameSource(
  citation: GroundedAnswerWithSourcesResult["response"]["citations"][number],
  source: GroundedAnswerSourceSnapshot,
): boolean {
  return (
    citation.sourceId === source.sourceId &&
    citation.documentId === source.documentId &&
    citation.originalFilename === source.originalFilename &&
    citation.ordinal === source.ordinal &&
    citation.contentHash === source.contentHash &&
    citation.pageNumber === source.pageNumber &&
    citation.startOffset === source.startOffset &&
    citation.endOffset === source.endOffset
  );
}

function normalizeAnswer(result: GroundedAnswerWithSourcesResult): AgentToolExecutionResult {
  const parsed = groundedAnswerWithSourcesSchema.safeParse(result);
  if (!parsed.success) throw new Error("Invalid Grounded Answer source boundary.");
  if (parsed.data.response.status === "insufficient_context") {
    return {
      observation: {
        status: "insufficient_context",
        answer: parsed.data.response.answer,
        citations: [],
      },
      evidence: [],
    };
  }
  const citations = parsed.data.sources.map((source, index) => ({
    sourceId: source.sourceId,
    localEvidenceOrdinal: index + 1,
    documentId: source.documentId,
    originalFilename: source.originalFilename,
    ordinal: source.ordinal,
    contentHash: source.contentHash,
    pageNumber: source.pageNumber,
    startOffset: source.startOffset,
    endOffset: source.endOffset,
    excerpt: truncateUnicode(source.content, 1_000),
  }));
  return {
    observation: {
      status: "answered",
      answer: parsed.data.response.answer,
      citations,
    },
    evidence: citations.map((citation) => ({
      kind: "knowledge_chunk",
      documentId: citation.documentId,
      originalFilename: citation.originalFilename,
      contentHash: citation.contentHash,
      ordinal: citation.ordinal,
      pageNumber: citation.pageNumber,
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
      excerpt: citation.excerpt,
    })),
  };
}

export function createAskKnowledgeTool(
  spaceService: Pick<SpaceService, "getSpace">,
  groundedAnswerService: Pick<GroundedAnswerService, "answerWithSources">,
): AgentTool<AskKnowledgeArguments> {
  return {
    name: "ask_knowledge",
    description:
      "Answer from authorized Research Space knowledge and return only validated cited sources.",
    argumentsSchema: askKnowledgeArgumentsSchema,
    resultSchema: askKnowledgeExecutionResultSchema,
    isAvailable: () => true,
    execute(context, arguments_) {
      return executeAuthorizedTool({
        context,
        spaceService,
        allowedErrorCodes,
        delegate: () =>
          groundedAnswerService.answerWithSources(
            context.spaceId,
            context.actorUserId,
            arguments_,
          ),
        normalize: normalizeAnswer,
      });
    },
  };
}
