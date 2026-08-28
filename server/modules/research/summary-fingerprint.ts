import { createHash } from "node:crypto";

import type { PaperRecord } from "../../db/schema";

export type PaperSummarySource = Pick<
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

export function toPaperSummarySource(paper: PaperRecord): PaperSummarySource {
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

export function createSummarySourceFingerprint(source: PaperSummarySource): string {
  const canonicalSource = JSON.stringify({
    versionedArxivId: source.versionedArxivId,
    version: source.version,
    title: source.title,
    abstract: source.abstract,
    authors: source.authors,
    primaryCategory: source.primaryCategory,
    categories: source.categories,
    publishedAt: source.publishedAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  });
  return createHash("sha256").update(canonicalSource, "utf8").digest("hex");
}
