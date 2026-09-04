import { z } from "zod";

import {
  AGENT_MAX_EVIDENCE,
  agentErrorCodeSchema,
  agentObservationSchema,
  type AgentErrorCode,
  type AgentObservation,
  type AgentToolName,
} from "../../../../shared/contracts/agents";

export interface AgentToolContext {
  readonly spaceId: string;
  readonly actorUserId: string;
  readonly signal: AbortSignal;
}

export type AgentEvidenceDraft =
  | {
      id?: string;
      kind: "arxiv_abstract";
      paperId: string | null;
      canonicalArxivId: string;
      versionedArxivId: string;
      sourceVersion: number;
      title: string;
      url: string;
      excerpt: string;
    }
  | {
      id?: string;
      kind: "knowledge_chunk";
      documentId: string | null;
      originalFilename: string;
      contentHash: string;
      ordinal: number;
      pageNumber: number | null;
      startOffset: number;
      endOffset: number;
      excerpt: string;
    };

export const arxivAbstractEvidenceDraftSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.literal("arxiv_abstract"),
    paperId: z.string().uuid().nullable(),
    canonicalArxivId: z.string().trim().min(1).max(100),
    versionedArxivId: z.string().trim().min(1).max(100),
    sourceVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(1_000),
    url: z.string().url().max(2_000),
    excerpt: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const knowledgeChunkEvidenceDraftSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.literal("knowledge_chunk"),
    documentId: z.string().uuid().nullable(),
    originalFilename: z.string().trim().min(1).max(255),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    ordinal: z.number().int().nonnegative(),
    pageNumber: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    excerpt: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .refine((value) => value.endOffset > value.startOffset, {
    message: "Evidence end offset must be greater than its start offset.",
    path: ["endOffset"],
  });

export const agentEvidenceDraftSchema = z.discriminatedUnion("kind", [
  arxivAbstractEvidenceDraftSchema,
  knowledgeChunkEvidenceDraftSchema,
]);

export interface AgentToolExecutionResult {
  observation: AgentObservation;
  evidence: AgentEvidenceDraft[];
}

export const agentToolExecutionResultSchema: z.ZodType<AgentToolExecutionResult> = z
  .object({
    observation: agentObservationSchema,
    evidence: z.array(agentEvidenceDraftSchema).max(AGENT_MAX_EVIDENCE),
  })
  .strict();

export interface AgentTool<TArguments extends Record<string, unknown>> {
  readonly name: AgentToolName;
  readonly description: string;
  readonly argumentsSchema: z.ZodType<TArguments>;
  readonly resultSchema: z.ZodType<AgentToolExecutionResult>;
  readonly isAvailable: () => boolean;
  execute(context: AgentToolContext, arguments_: TArguments): Promise<unknown>;
}

export class AgentToolError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode) {
    const parsedCode = agentErrorCodeSchema.parse(code);
    super("The Agent tool call failed.");
    this.name = "AgentToolError";
    this.code = parsedCode;
    this.stack = undefined;
  }

  toJSON(): { code: AgentErrorCode } {
    return { code: this.code };
  }
}

export function isAgentToolError(error: unknown): error is AgentToolError {
  return error instanceof AgentToolError;
}
