import { z } from "zod";

const normalizeSearchText = (value: string) => value.replace(/\s+/gu, " ");

export const researchSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Use at least 2 characters.")
    .max(200, "Use no more than 200 characters.")
    .transform(normalizeSearchText),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(20).default(10),
  sort: z.enum(["relevance", "submitted", "updated"]).default("relevance"),
});

export const researchPaperSchema = z.object({
  canonicalArxivId: z.string().min(1),
  versionedArxivId: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  abstract: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  primaryCategory: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1),
  publishedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  comment: z.string().min(1).optional(),
  journalRef: z.string().min(1).optional(),
  doi: z.string().min(1).optional(),
  absUrl: z.string().url(),
  pdfUrl: z.string().url(),
});

export const researchPaperSearchResultSchema = z.object({
  totalResults: z.number().int().nonnegative(),
  startIndex: z.number().int().nonnegative(),
  itemsPerPage: z.number().int().nonnegative(),
  papers: z.array(researchPaperSchema),
});

export const persistentResearchPaperSchema = researchPaperSchema.extend({
  id: z.string().uuid(),
  fetchedAt: z.string().datetime(),
});

export const persistentResearchPaperSearchResultSchema = z.object({
  totalResults: z.number().int().nonnegative(),
  startIndex: z.number().int().nonnegative(),
  itemsPerPage: z.number().int().nonnegative(),
  papers: z.array(persistentResearchPaperSchema),
});

export const persistentResearchPaperResponseSchema = z.object({
  paper: persistentResearchPaperSchema,
});

export const savedPaperSchema = z.object({
  paper: persistentResearchPaperSchema,
  savedByUserId: z.string().uuid().nullable(),
  savedAt: z.string().datetime(),
});

export const savedPaperListResponseSchema = z.object({
  savedPapers: z.array(savedPaperSchema),
});

const summaryListItemSchema = z.string().trim().min(1).max(1000);

export const researchSummaryContentSchema = z
  .object({
    overview: z.string().trim().min(1).max(2000),
    keyContributions: z.array(summaryListItemSchema).max(5),
    methodHighlights: z.array(summaryListItemSchema).max(5),
    findings: z.array(summaryListItemSchema).max(5),
    caveats: z.array(summaryListItemSchema).max(5),
  })
  .strict();

export const researchPaperSummarySchema = researchSummaryContentSchema.extend({
  paperId: z.string().uuid(),
  sourceVersion: z.number().int().positive(),
  sourceUpdatedAt: z.string().datetime(),
  model: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  generatedAt: z.string().datetime(),
});

export const researchPaperSummaryResponseSchema = z.object({
  summary: researchPaperSummarySchema,
});

export const nullableResearchPaperSummaryResponseSchema = z.object({
  summary: researchPaperSummarySchema.nullable(),
});

export const savedPaperResponseSchema = z.object({
  savedPaper: savedPaperSchema,
});

export type ResearchSearchQuery = z.infer<typeof researchSearchQuerySchema>;
export type ResearchPaper = z.infer<typeof researchPaperSchema>;
export type ResearchPaperSearchResult = z.infer<typeof researchPaperSearchResultSchema>;
export type PersistentResearchPaper = z.infer<typeof persistentResearchPaperSchema>;
export type PersistentResearchPaperSearchResult = z.infer<
  typeof persistentResearchPaperSearchResultSchema
>;
export type SavedPaper = z.infer<typeof savedPaperSchema>;
export type ResearchSummaryContent = z.infer<typeof researchSummaryContentSchema>;
export type ResearchPaperSummary = z.infer<typeof researchPaperSummarySchema>;
