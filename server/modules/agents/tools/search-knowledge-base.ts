import { z } from "zod";

import type { AgentErrorCode } from "../../../../shared/contracts/agents";
import type { SemanticRetrievalService } from "../../retrieval/service";
import type { SpaceService } from "../../spaces/service";
import {
  knowledgeChunkEvidenceDraftSchema,
  type AgentTool,
  type AgentToolExecutionResult,
} from "./contracts";
import { executeAuthorizedTool, truncateUnicode } from "./helpers";

export const searchKnowledgeBaseArgumentsSchema = z
  .object({
    query: z.string().trim().min(2).max(2_000),
    limit: z.number().int().min(1).max(8).default(8),
  })
  .strict();

const knowledgeResultObservationSchema = z
  .object({
    rank: z.number().int().min(1).max(8),
    localEvidenceOrdinal: z.number().int().min(1).max(8),
    documentId: z.string().uuid(),
    originalFilename: z.string().trim().min(1).max(255),
    ordinal: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    pageNumber: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    excerpt: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .refine((value) => value.endOffset > value.startOffset, {
    message: "The result end offset must be greater than its start offset.",
    path: ["endOffset"],
  });

const searchKnowledgeBaseObservationSchema = z
  .object({
    resultCount: z.number().int().min(0).max(8),
    results: z.array(knowledgeResultObservationSchema).max(8),
  })
  .strict()
  .refine((value) => value.resultCount === value.results.length, {
    message: "The knowledge result count must match the normalized results.",
    path: ["resultCount"],
  });

const searchKnowledgeBaseExecutionResultSchema: z.ZodType<AgentToolExecutionResult> = z
  .object({
    observation: searchKnowledgeBaseObservationSchema,
    evidence: z.array(knowledgeChunkEvidenceDraftSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.observation.results.length !== value.evidence.length) {
      context.addIssue({
        code: "custom",
        message: "Every knowledge result must have one evidence draft.",
        path: ["evidence"],
      });
      return;
    }
    value.observation.results.forEach((result, index) => {
      const evidence = value.evidence[index];
      if (
        !evidence ||
        evidence.kind !== "knowledge_chunk" ||
        result.rank !== index + 1 ||
        result.localEvidenceOrdinal !== index + 1 ||
        evidence.documentId !== result.documentId ||
        evidence.originalFilename !== result.originalFilename ||
        evidence.contentHash !== result.contentHash ||
        evidence.ordinal !== result.ordinal ||
        evidence.pageNumber !== result.pageNumber ||
        evidence.startOffset !== result.startOffset ||
        evidence.endOffset !== result.endOffset ||
        evidence.excerpt !== result.excerpt
      ) {
        context.addIssue({
          code: "custom",
          message: "The knowledge observation and evidence provenance must match.",
          path: ["evidence", index],
        });
      }
    });
  });

export const RETRIEVAL_TOOL_ERROR_CODE_VALUES = Object.freeze([
  "knowledge_not_indexed",
  "knowledge_embedding_incompatible",
  "retrieval_embedding_unconfigured",
  "retrieval_embedding_unavailable",
  "retrieval_embedding_rejected",
  "retrieval_embedding_invalid_response",
] as const satisfies readonly AgentErrorCode[]);

const allowedErrorCodes = new Set<AgentErrorCode>(RETRIEVAL_TOOL_ERROR_CODE_VALUES);

export type SearchKnowledgeBaseArguments = z.infer<
  typeof searchKnowledgeBaseArgumentsSchema
>;

export function createSearchKnowledgeBaseTool(
  spaceService: Pick<SpaceService, "getSpace">,
  retrievalService: Pick<SemanticRetrievalService, "retrieve">,
): AgentTool<SearchKnowledgeBaseArguments> {
  return {
    name: "search_knowledge_base",
    description:
      "Search authorized indexed documents in the current Research Space and return ranked excerpts.",
    argumentsSchema: searchKnowledgeBaseArgumentsSchema,
    resultSchema: searchKnowledgeBaseExecutionResultSchema,
    isAvailable: () => true,
    execute(context, arguments_) {
      return executeAuthorizedTool({
        context,
        spaceService,
        allowedErrorCodes,
        delegate: () =>
          retrievalService.retrieve(context.spaceId, context.actorUserId, arguments_),
        normalize: (response): AgentToolExecutionResult => {
          const results = response.results.slice(0, 8).map((result, index) => ({
            rank: index + 1,
            localEvidenceOrdinal: index + 1,
            documentId: result.documentId,
            originalFilename: result.originalFilename,
            ordinal: result.ordinal,
            contentHash: result.contentHash,
            pageNumber: result.pageNumber,
            startOffset: result.startOffset,
            endOffset: result.endOffset,
            excerpt: truncateUnicode(result.content, 1_000),
          }));
          return {
            observation: { resultCount: results.length, results },
            evidence: results.map((result) => ({
              kind: "knowledge_chunk",
              documentId: result.documentId,
              originalFilename: result.originalFilename,
              contentHash: result.contentHash,
              ordinal: result.ordinal,
              pageNumber: result.pageNumber,
              startOffset: result.startOffset,
              endOffset: result.endOffset,
              excerpt: result.excerpt,
            })),
          };
        },
      });
    },
  };
}
