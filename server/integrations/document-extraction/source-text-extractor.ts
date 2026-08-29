import type { DocumentMediaType } from "../../../shared/contracts/documents";
import { DocumentIngestionError } from "../../modules/documents/document-ingestion-errors";
import {
  MAX_NORMALIZED_CHARS,
  type ExtractedDocument,
} from "../../modules/documents/document-text-extractor";

export const SOURCE_TEXT_EXTRACTOR_VERSION = "utf8-source-v1";

function trimOuterWhitespace(text: string): string {
  return text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

export function normalizeSourceText(bytes: Uint8Array): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new DocumentIngestionError("document_invalid_utf8");
  }

  if (decoded.startsWith("\uFEFF")) decoded = decoded.slice(1);
  return trimOuterWhitespace(
    decoded.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").normalize("NFC"),
  );
}

export function extractSourceText(
  mediaType: Exclude<DocumentMediaType, "pdf">,
  bytes: Uint8Array,
): ExtractedDocument {
  const text = normalizeSourceText(bytes);
  if (text.length > MAX_NORMALIZED_CHARS) {
    throw new DocumentIngestionError("document_text_limit_exceeded");
  }
  return {
    mediaType,
    extractorVersion: SOURCE_TEXT_EXTRACTOR_VERSION,
    pageCount: null,
    characterCount: text.length,
    units: [{ pageNumber: null, text }],
  };
}
