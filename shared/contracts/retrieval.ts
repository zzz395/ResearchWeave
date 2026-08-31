import { z } from "zod";

export const semanticRetrievalRequestSchema = z
  .object({
    query: z.string().trim().min(2).max(2000),
    limit: z.number().int().min(1).max(20).default(8),
  })
  .strict();

export const semanticRetrievalResultSchema = z
  .object({
    documentId: z.string().uuid(),
    originalFilename: z.string().min(1).max(255),
    ordinal: z.number().int().nonnegative(),
    content: z.string().min(1),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    pageNumber: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    cosineDistance: z.number().finite(),
  })
  .strict();

export const semanticRetrievalResponseSchema = z
  .object({
    results: z.array(semanticRetrievalResultSchema),
  })
  .strict();

export type SemanticRetrievalRequest = z.infer<typeof semanticRetrievalRequestSchema>;
export type SemanticRetrievalResult = z.infer<typeof semanticRetrievalResultSchema>;
export type SemanticRetrievalResponse = z.infer<typeof semanticRetrievalResponseSchema>;
