import { z } from "zod";

export const askKnowledgeRequestSchema = z
  .object({
    query: z.string().trim().min(2).max(2000),
  })
  .strict();

export const groundedAnswerCitationSchema = z
  .object({
    sourceId: z.string().regex(/^S[1-8]$/u),
    documentId: z.string().uuid(),
    originalFilename: z.string().min(1).max(255),
    ordinal: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    pageNumber: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
  })
  .strict();

const answeredResponseSchema = z
  .object({
    status: z.literal("answered"),
    answer: z.string().min(1).max(8000),
    citations: z.array(groundedAnswerCitationSchema).min(1).max(8),
  })
  .strict();

const insufficientContextResponseSchema = z
  .object({
    status: z.literal("insufficient_context"),
    answer: z.string().min(1).max(8000),
    citations: z.array(groundedAnswerCitationSchema).length(0),
  })
  .strict();

export const groundedAnswerResponseSchema = z.discriminatedUnion("status", [
  answeredResponseSchema,
  insufficientContextResponseSchema,
]);

export type AskKnowledgeRequest = z.infer<typeof askKnowledgeRequestSchema>;
export type GroundedAnswerCitation = z.infer<typeof groundedAnswerCitationSchema>;
export type GroundedAnswerResponse = z.infer<typeof groundedAnswerResponseSchema>;
