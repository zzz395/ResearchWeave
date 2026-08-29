import { z } from "zod";

export const documentMediaTypeSchema = z.enum(["pdf", "text", "markdown"]);
export const documentStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export const documentStageSchema = z.enum(["extracting", "chunking", "embedding"]);

const nullableDateTimeSchema = z.string().datetime().nullable();
const nullableNonNegativeIntegerSchema = z.number().int().nonnegative().nullable();
const nullablePositiveIntegerSchema = z.number().int().positive().nullable();
const nullableTextSchema = z.string().min(1).nullable();
const nullableSha256Schema = z.string().regex(/^[0-9a-f]{64}$/u).nullable();

export const documentSchema = z
  .object({
    id: z.string().uuid(),
    spaceId: z.string().uuid(),
    uploadedByUserId: z.string().uuid().nullable(),
    originalFilename: z.string().min(1).max(255),
    mediaType: documentMediaTypeSchema,
    sizeBytes: z.number().int().positive(),
    status: documentStatusSchema,
    stage: documentStageSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
    lastAttemptAt: nullableDateTimeSchema,
    errorCode: nullableTextSchema,
    failedAt: nullableDateTimeSchema,
    pageCount: nullablePositiveIntegerSchema,
    characterCount: nullableNonNegativeIntegerSchema,
    chunkCount: z.number().int().nonnegative(),
    extractorVersion: nullableTextSchema,
    chunkerVersion: nullableTextSchema,
    embeddingModel: nullableTextSchema,
    embeddingDimensions: nullablePositiveIntegerSchema,
    indexFingerprint: nullableSha256Schema,
    indexedAt: nullableDateTimeSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const documentUploadResponseSchema = z
  .object({
    document: documentSchema,
    created: z.boolean(),
  })
  .strict();

export const documentResponseSchema = z.object({ document: documentSchema }).strict();

export const documentListQuerySchema = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const documentListResponseSchema = z
  .object({
    documents: z.array(documentSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type DocumentMediaType = z.infer<typeof documentMediaTypeSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type DocumentStage = z.infer<typeof documentStageSchema>;
export type Document = z.infer<typeof documentSchema>;
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;
