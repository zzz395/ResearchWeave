import { z } from "zod";

export const PAPER_COMPARISON_MIN_PAPERS = 2;
export const PAPER_COMPARISON_MAX_PAPERS = 4;

const comparisonListItemSchema = z.string().trim().min(1).max(1000);

export const paperComparisonRequestSchema = z
  .object({
    paperIds: z
      .array(z.string().uuid())
      .min(PAPER_COMPARISON_MIN_PAPERS)
      .max(PAPER_COMPARISON_MAX_PAPERS),
  })
  .strict()
  .superRefine(({ paperIds }, context) => {
    if (new Set(paperIds).size !== paperIds.length) {
      context.addIssue({
        code: "custom",
        message: "Paper IDs must be unique.",
        path: ["paperIds"],
      });
    }
  });

export const paperComparisonGeneratedContentSchema = z
  .object({
    overview: z.string().trim().min(1).max(2000),
    similarities: z.array(comparisonListItemSchema).max(6),
    dimensions: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            observations: z
              .array(
                z
                  .object({
                    paperId: z.string().uuid(),
                    statement: z.string().trim().min(1).max(1000).nullable(),
                  })
                  .strict(),
              )
              .min(PAPER_COMPARISON_MIN_PAPERS)
              .max(PAPER_COMPARISON_MAX_PAPERS),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

export const paperComparisonSourceBasisSchema = z
  .object({
    type: z.literal("arxiv_metadata_and_abstracts"),
    label: z.literal("Abstract-based comparison"),
    description: z.literal(
      "This comparison uses stored arXiv metadata and abstracts only. It does not use or claim access to full text or indexed documents.",
    ),
  })
  .strict();

export const paperComparisonPaperSchema = z
  .object({
    id: z.string().uuid(),
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
    absUrl: z.string().url(),
    pdfUrl: z.string().url(),
  })
  .strict();

export const paperComparisonResponseSchema = z
  .object({
    sourceBasis: paperComparisonSourceBasisSchema,
    papers: z
      .array(paperComparisonPaperSchema)
      .min(PAPER_COMPARISON_MIN_PAPERS)
      .max(PAPER_COMPARISON_MAX_PAPERS),
    comparison: paperComparisonGeneratedContentSchema,
    generation: z
      .object({
        model: z.string().trim().min(1),
        promptVersion: z.literal("abstract-comparison-v1"),
        generatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export type PaperComparisonRequest = z.infer<typeof paperComparisonRequestSchema>;
export type PaperComparisonGeneratedContent = z.infer<
  typeof paperComparisonGeneratedContentSchema
>;
export type PaperComparisonResponse = z.infer<typeof paperComparisonResponseSchema>;
