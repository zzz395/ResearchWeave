import { describe, expect, it } from "vitest";

import {
  documentListResponseSchema,
  documentUploadResponseSchema,
} from "../../shared/contracts/documents";
import {
  createDocumentSourceSha256,
  normalizeDocumentFilename,
  validateDocumentSource,
} from "../../server/integrations/document-upload/source-validation";

const text = new TextEncoder();

describe("document source validation", () => {
  it("creates deterministic lowercase SHA-256 identities", () => {
    const first = createDocumentSourceSha256(text.encode("same bytes"));
    const repeated = createDocumentSourceSha256(text.encode("same bytes"));
    const different = createDocumentSourceSha256(text.encode("different bytes"));
    expect(first).toBe(repeated);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    ["paper.pdf", "%PDF-minimal", "pdf"],
    ["PAPER.PDF", "%PDF-uppercase", "pdf"],
    ["notes.txt", "valid text", "text"],
    ["notes.TXT", "valid text", "text"],
    ["notes.md", "# Valid", "markdown"],
    ["notes.markdown", "# Valid", "markdown"],
    ["NOTES.MARKDOWN", "# Valid", "markdown"],
  ] as const)("accepts %s as %s", (filename, content, mediaType) => {
    expect(validateDocumentSource(filename, text.encode(content))).toMatchObject({
      originalFilename: filename,
      mediaType,
      sizeBytes: text.encode(content).byteLength,
    });
  });

  it("uses only a display basename and rejects invalid display names", () => {
    expect(normalizeDocumentFilename("../../private/notes.txt")).toBe("notes.txt");
    expect(normalizeDocumentFilename("..\\..\\private\\notes.txt")).toBe("notes.txt");
    expect(() => normalizeDocumentFilename("   ")).toThrowError("Invalid document file.");
    expect(() => normalizeDocumentFilename(`${"a".repeat(252)}.txt`)).toThrowError(
      "Invalid document file.",
    );
  });

  it.each(["document.docx", "archive.zip", "page.html", "image.png"])(
    "rejects unsupported extension %s",
    (filename) => {
      expect(() => validateDocumentSource(filename, text.encode("content"))).toThrowError(
        "Unsupported document type.",
      );
    },
  );

  it("validates PDF header without pretending to parse the PDF", () => {
    expect(validateDocumentSource("paper.pdf", text.encode("%PDF-not-yet-parsed")).mediaType).toBe(
      "pdf",
    );
    expect(() => validateDocumentSource("paper.pdf", text.encode("not a pdf"))).toThrowError(
      "Invalid document file.",
    );
  });

  it.each(["notes.txt", "notes.md", "notes.markdown"])(
    "uses fatal UTF-8 validation for %s",
    (filename) => {
      expect(validateDocumentSource(filename, text.encode("Valid π text")).mediaType).toBeTruthy();
      expect(() => validateDocumentSource(filename, Uint8Array.from([0xc3, 0x28]))).toThrowError(
        "Invalid document file.",
      );
    },
  );

  it("rejects empty sources", () => {
    expect(() => validateDocumentSource("empty.txt", new Uint8Array())).toThrowError(
      "Invalid document file.",
    );
  });
});

describe("document shared contracts", () => {
  const document = {
    id: "10000000-0000-4000-8000-000000000001",
    spaceId: "20000000-0000-4000-8000-000000000001",
    uploadedByUserId: "30000000-0000-4000-8000-000000000001",
    originalFilename: "notes.txt",
    mediaType: "text",
    sizeBytes: 10,
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
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };

  it("accepts the public upload and list envelopes", () => {
    expect(documentUploadResponseSchema.parse({ document, created: true })).toEqual({
      document,
      created: true,
    });
    expect(documentListResponseSchema.parse({ documents: [document], nextCursor: null })).toEqual({
      documents: [document],
      nextCursor: null,
    });
  });

  it("strictly rejects internal storage and source identity fields", () => {
    expect(() =>
      documentUploadResponseSchema.parse({
        document: { ...document, storageKey: "spaces/internal/source" },
        created: true,
      }),
    ).toThrow();
    expect(() =>
      documentUploadResponseSchema.parse({
        document: { ...document, sourceSha256: "a".repeat(64) },
        created: true,
      }),
    ).toThrow();
  });
});

