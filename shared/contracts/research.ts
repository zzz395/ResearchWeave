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

export type ResearchSearchQuery = z.infer<typeof researchSearchQuerySchema>;
export type ResearchPaper = z.infer<typeof researchPaperSchema>;
export type ResearchPaperSearchResult = z.infer<typeof researchPaperSearchResultSchema>;
