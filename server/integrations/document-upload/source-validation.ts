import { createHash } from "node:crypto";

import type { DocumentMediaType } from "../../../shared/contracts/documents";

export type DocumentSourceValidationErrorCode =
  | "DOCUMENT_UNSUPPORTED_TYPE"
  | "DOCUMENT_INVALID_FILE";

export class DocumentSourceValidationError extends Error {
  readonly code: DocumentSourceValidationErrorCode;

  constructor(code: DocumentSourceValidationErrorCode) {
    super(code === "DOCUMENT_UNSUPPORTED_TYPE" ? "Unsupported document type." : "Invalid document file.");
    this.name = "DocumentSourceValidationError";
    this.code = code;
  }
}

export interface ValidatedDocumentSource {
  originalFilename: string;
  mediaType: DocumentMediaType;
  sizeBytes: number;
  sourceSha256: string;
}

export function createDocumentSourceSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeDocumentFilename(originalFilename: string): string {
  const normalizedSeparators = originalFilename.replace(/\\/gu, "/");
  const basename = normalizedSeparators.split("/").at(-1)?.trim() ?? "";
  if (!basename || basename.length > 255) {
    throw new DocumentSourceValidationError("DOCUMENT_INVALID_FILE");
  }
  return basename;
}

function mediaTypeForFilename(filename: string): DocumentMediaType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "text";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  throw new DocumentSourceValidationError("DOCUMENT_UNSUPPORTED_TYPE");
}

function validatePdf(bytes: Uint8Array): void {
  const header = new TextEncoder().encode("%PDF-");
  if (bytes.length < header.length || header.some((value, index) => bytes[index] !== value)) {
    throw new DocumentSourceValidationError("DOCUMENT_INVALID_FILE");
  }
}

function validateUtf8(bytes: Uint8Array): void {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentSourceValidationError("DOCUMENT_INVALID_FILE");
  }
}

export function validateDocumentSource(
  originalFilename: string,
  bytes: Uint8Array,
): ValidatedDocumentSource {
  if (bytes.byteLength === 0) {
    throw new DocumentSourceValidationError("DOCUMENT_INVALID_FILE");
  }
  const safeFilename = normalizeDocumentFilename(originalFilename);
  const mediaType = mediaTypeForFilename(safeFilename);
  if (mediaType === "pdf") validatePdf(bytes);
  else validateUtf8(bytes);
  return {
    originalFilename: safeFilename,
    mediaType,
    sizeBytes: bytes.byteLength,
    sourceSha256: createDocumentSourceSha256(bytes),
  };
}
