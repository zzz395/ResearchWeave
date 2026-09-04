import { z } from "zod";

import type { AgentErrorCode } from "../../../../shared/contracts/agents";
import type { ResearchService } from "../../research/service";
import type { SpaceService } from "../../spaces/service";
import {
  arxivAbstractEvidenceDraftSchema,
  type AgentTool,
  type AgentToolExecutionResult,
} from "./contracts";
import { executeAuthorizedTool, truncateUnicode } from "./helpers";

const normalizeSearchQuery = (value: string) => value.trim().replace(/\s+/gu, " ");

export const searchArxivArgumentsSchema = z
  .object({
    query: z.string().transform(normalizeSearchQuery).pipe(z.string().min(2).max(200)),
    page: z.number().int().min(1).max(20).default(1),
    pageSize: z.number().int().min(1).max(5).default(5),
    sort: z.enum(["relevance", "submitted", "updated"]).default("relevance"),
  })
  .strict();

const searchArxivPaperObservationSchema = z
  .object({
    localEvidenceOrdinal: z.number().int().min(1).max(5),
    paperId: z.string().uuid(),
    canonicalArxivId: z.string().min(1).max(100),
    versionedArxivId: z.string().min(1).max(100),
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    authors: z.array(z.string().trim().min(1).max(120)).max(8),
    remainingAuthorCount: z.number().int().nonnegative(),
    publishedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    absUrl: z.string().min(1).max(1_000),
    pdfUrl: z.string().min(1).max(1_000),
    abstractExcerpt: z.string().trim().min(1).max(2_000),
  })
  .strict();

const searchArxivObservationSchema = z
  .object({
    resultCount: z.number().int().min(0).max(5),
    totalResults: z.number().int().nonnegative(),
    startIndex: z.number().int().nonnegative(),
    papers: z.array(searchArxivPaperObservationSchema).max(5),
  })
  .strict()
  .refine((value) => value.resultCount === value.papers.length, {
    message: "The arXiv result count must match the normalized papers.",
    path: ["resultCount"],
  });

const searchArxivExecutionResultSchema: z.ZodType<AgentToolExecutionResult> = z
  .object({
    observation: searchArxivObservationSchema,
    evidence: z.array(arxivAbstractEvidenceDraftSchema).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.observation.papers.length !== value.evidence.length) {
      context.addIssue({
        code: "custom",
        message: "Every normalized arXiv paper must have one evidence draft.",
        path: ["evidence"],
      });
      return;
    }
    value.observation.papers.forEach((paper, index) => {
      const evidence = value.evidence[index];
      if (
        !evidence ||
        evidence.kind !== "arxiv_abstract" ||
        paper.localEvidenceOrdinal !== index + 1 ||
        evidence.paperId !== paper.paperId ||
        evidence.canonicalArxivId !== paper.canonicalArxivId ||
        evidence.versionedArxivId !== paper.versionedArxivId ||
        evidence.sourceVersion !== paper.version ||
        evidence.title !== paper.title ||
        truncateUnicode(evidence.url, 1_000) !== paper.absUrl ||
        evidence.excerpt !== paper.abstractExcerpt
      ) {
        context.addIssue({
          code: "custom",
          message: "The arXiv observation and evidence provenance must match.",
          path: ["evidence", index],
        });
      }
    });
  });

const allowedErrorCodes = new Set<AgentErrorCode>([
  "research_temporarily_unavailable",
  "research_upstream_failure",
  "research_upstream_timeout",
]);

export type SearchArxivArguments = z.infer<typeof searchArxivArgumentsSchema>;

export function createSearchArxivTool(
  spaceService: Pick<SpaceService, "getSpace">,
  researchService: Pick<ResearchService, "searchPapers">,
): AgentTool<SearchArxivArguments> {
  return {
    name: "search_arxiv",
    description:
      "Search real arXiv paper metadata and abstracts. Abstract evidence is not full-text evidence.",
    argumentsSchema: searchArxivArgumentsSchema,
    resultSchema: searchArxivExecutionResultSchema,
    isAvailable: () => true,
    execute(context, arguments_) {
      return executeAuthorizedTool({
        context,
        spaceService,
        allowedErrorCodes,
        delegate: () =>
          researchService.searchPapers({
            q: arguments_.query,
            page: arguments_.page,
            pageSize: arguments_.pageSize,
            sort: arguments_.sort,
          }),
        normalize: (result): AgentToolExecutionResult => {
          const selectedPapers = result.papers.slice(0, 5);
          const papers = selectedPapers.map((paper, index) => {
            const authors = paper.authors
              .slice(0, 8)
              .map((author) => truncateUnicode(author, 120));
            return {
              localEvidenceOrdinal: index + 1,
              paperId: paper.id,
              canonicalArxivId: paper.canonicalArxivId,
              versionedArxivId: paper.versionedArxivId,
              version: paper.version,
              title: truncateUnicode(paper.title, 500),
              authors,
              remainingAuthorCount: Math.max(0, paper.authors.length - authors.length),
              publishedAt: paper.publishedAt,
              updatedAt: paper.updatedAt,
              absUrl: truncateUnicode(paper.absUrl, 1_000),
              pdfUrl: truncateUnicode(paper.pdfUrl, 1_000),
              abstractExcerpt: truncateUnicode(paper.abstract, 2_000),
            };
          });
          return {
            observation: {
              resultCount: papers.length,
              totalResults: result.totalResults,
              startIndex: result.startIndex,
              papers,
            },
            evidence: papers.map((paper, index) => ({
              kind: "arxiv_abstract",
              paperId: paper.paperId,
              canonicalArxivId: paper.canonicalArxivId,
              versionedArxivId: paper.versionedArxivId,
              sourceVersion: paper.version,
              title: paper.title,
              url: selectedPapers[index]?.absUrl ?? paper.absUrl,
              excerpt: paper.abstractExcerpt,
            })),
          };
        },
      });
    },
  };
}
