import type { PaperRecord } from "../../db/schema";

export type PaperComparisonSource = Pick<
  PaperRecord,
  | "id"
  | "versionedArxivId"
  | "version"
  | "title"
  | "abstract"
  | "authors"
  | "primaryCategory"
  | "categories"
  | "publishedAt"
  | "updatedAt"
>;

export function toPaperComparisonSource(paper: PaperRecord): PaperComparisonSource {
  return {
    id: paper.id,
    versionedArxivId: paper.versionedArxivId,
    version: paper.version,
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.authors,
    primaryCategory: paper.primaryCategory,
    categories: paper.categories,
    publishedAt: paper.publishedAt,
    updatedAt: paper.updatedAt,
  };
}
