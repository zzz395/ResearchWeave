/// <reference lib="dom" />

import { describe, expect, it } from "vitest";

import type { Document } from "../../shared/contracts/documents";
import {
  canManageDocument,
  getActiveIndexPresentation,
  getDocumentFailureMessage,
  getDocumentStatusPresentation,
  getDocumentSummary,
  getReindexActionLabel,
  shouldPollDocuments,
  validateDocumentFile,
} from "../../src/features/knowledge/document-presentation";

function document(overrides: Partial<Document> = {}): Document {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    spaceId: "20000000-0000-4000-8000-000000000001",
    uploadedByUserId: "30000000-0000-4000-8000-000000000001",
    originalFilename: "notes.txt",
    mediaType: "text",
    sizeBytes: 100,
    status: "queued",
    stage: null,
    attemptCount: 0,
    lastAttemptAt: null,
    errorCode: null,
    failedAt: null,
    pageCount: null,
    characterCount: null,
    chunkCount: 0,
    extractorVersion: null,
    chunkerVersion: null,
    embeddingModel: null,
    embeddingDimensions: null,
    indexFingerprint: null,
    indexedAt: null,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("document presentation", () => {
  it.each([
    [{ status: "queued", stage: null, indexedAt: null }, "Queued"],
    [{ status: "processing", stage: "extracting", indexedAt: null }, "Extracting"],
    [{ status: "processing", stage: "chunking", indexedAt: null }, "Chunking"],
    [{ status: "processing", stage: "embedding", indexedAt: null }, "Indexing"],
    [{ status: "ready", stage: null, indexedAt: "2026-08-29T00:00:00.000Z" }, "Ready"],
    [{ status: "failed", stage: "embedding", indexedAt: null }, "Indexing failed"],
  ] as const)("maps current indexing state %# to %s", (input, expected) => {
    expect(getDocumentStatusPresentation(input).primary).toBe(expected);
  });

  it("distinguishes a first indexing attempt from a rebuild in progress", () => {
    const first = document({ status: "processing", stage: "embedding", indexedAt: null });
    const rebuild = document({
      status: "processing",
      stage: "embedding",
      indexedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(getDocumentStatusPresentation(first).primary).toBe("Indexing");
    expect(getActiveIndexPresentation(first)).toMatchObject({
      available: false,
      label: "No active index yet",
    });
    expect(getDocumentStatusPresentation(rebuild).primary).toBe("Reindexing");
    expect(getActiveIndexPresentation(rebuild)).toMatchObject({
      available: true,
      label: "Current index remains available",
    });
  });

  it("distinguishes a failed first index from a failed rebuild", () => {
    const firstFailure = document({ status: "failed", stage: "embedding", indexedAt: null });
    const rebuildFailure = document({
      status: "failed",
      stage: "embedding",
      indexedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(getActiveIndexPresentation(firstFailure)).toMatchObject({
      available: false,
      label: "No active index",
    });
    expect(getDocumentStatusPresentation(rebuildFailure).primary).toBe("Reindex failed");
    expect(getActiveIndexPresentation(rebuildFailure)).toMatchObject({
      available: true,
      label: "Previous index remains available",
    });
  });

  it("counts indexed documents from indexedAt, including a failed rebuild", () => {
    const documents = [
      document({ id: "10000000-0000-4000-8000-000000000001", status: "ready", indexedAt: "2026-08-29T00:00:00.000Z" }),
      document({ id: "10000000-0000-4000-8000-000000000002", status: "failed", indexedAt: "2026-08-28T00:00:00.000Z" }),
      document({ id: "10000000-0000-4000-8000-000000000003", status: "processing", indexedAt: null }),
    ];

    expect(getDocumentSummary(documents)).toEqual({ total: 3, indexed: 2, processing: 1, failed: 1 });
  });

  it("polls only while queued or processing work exists", () => {
    expect(shouldPollDocuments([document({ status: "queued" })])).toBe(true);
    expect(shouldPollDocuments([document({ status: "processing" })])).toBe(true);
    expect(shouldPollDocuments([document({ status: "ready" })])).toBe(false);
    expect(shouldPollDocuments([document({ status: "failed" })])).toBe(false);
  });

  it.each([
    ["document_invalid_utf8", "This text file is not valid UTF-8."],
    ["document_pdf_invalid", "This PDF could not be read."],
    ["document_pdf_password_protected", "Password-protected PDFs are not supported."],
    ["document_pdf_page_limit_exceeded", "This PDF exceeds the 500-page limit."],
    ["document_text_limit_exceeded", "This document is too large to index."],
    ["document_no_extractable_text", "No extractable text was found in this PDF."],
    ["document_chunk_limit_exceeded", "This document produces too many index chunks."],
    ["document_pdf_extraction_failed", "This PDF could not be processed."],
    ["document_source_unavailable", "The original document file is unavailable."],
    ["document_no_indexable_text", "No indexable text was found."],
    ["document_embedding_unconfigured", "Document indexing is not configured on this server."],
    ["document_embedding_unavailable", "The indexing service is temporarily unavailable."],
    ["document_embedding_rejected", "The indexing service rejected this document."],
    ["document_embedding_invalid_response", "The indexing service returned an invalid response."],
    ["document_index_persistence_failed", "The generated index could not be saved."],
    ["future_internal_code", "Document indexing failed. Please try again."],
  ])("maps %s to a stable user-safe failure", (code, message) => {
    expect(getDocumentFailureMessage(code)).toBe(message);
  });

  it("exposes reindex actions only for settled attempts", () => {
    expect(getReindexActionLabel("failed")).toBe("Retry indexing");
    expect(getReindexActionLabel("ready")).toBe("Reindex");
    expect(getReindexActionLabel("queued")).toBeNull();
    expect(getReindexActionLabel("processing")).toBeNull();
  });

  it("uses current membership data only as a management UX hint", () => {
    const uploaded = document();
    expect(canManageDocument(uploaded, "owner", "different-user")).toBe(true);
    expect(canManageDocument(uploaded, "member", uploaded.uploadedByUserId ?? undefined)).toBe(true);
    expect(canManageDocument(uploaded, "member", "different-user")).toBe(false);
    expect(canManageDocument(document({ uploadedByUserId: null }), "member", "different-user")).toBe(false);
  });

  it("provides fast client-side upload feedback without widening accepted types", () => {
    expect(validateDocumentFile({ name: "paper.PDF", size: 1024 })).toBeNull();
    expect(validateDocumentFile({ name: "notes.markdown", size: 1024 })).toBeNull();
    expect(validateDocumentFile({ name: "slides.pptx", size: 1024 })).toContain("PDF");
    expect(validateDocumentFile({ name: "empty.txt", size: 0 })).toContain("non-empty");
    expect(validateDocumentFile({ name: "large.txt", size: 20 * 1024 * 1024 + 1 })).toContain("20 MB");
  });
});
