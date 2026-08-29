import { createHash } from "node:crypto";

import type { DocumentMediaType } from "../../../shared/contracts/documents";
import type { DocumentChunkDraft } from "./document-chunker";

export const DOCUMENT_INDEX_FINGERPRINT_VERSION = "document-index-v1";

export interface DocumentIndexFingerprintInput {
  sourceSha256: string;
  mediaType: DocumentMediaType;
  extractorVersion: string;
  chunkerVersion: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunks: ReadonlyArray<
    Pick<
      DocumentChunkDraft,
      "ordinal" | "contentHash" | "pageNumber" | "startOffset" | "endOffset"
    >
  >;
}

export function createDocumentIndexFingerprint(input: DocumentIndexFingerprintInput): string {
  const chunks = [...input.chunks]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((chunk) => ({
      ordinal: chunk.ordinal,
      contentHash: chunk.contentHash,
      pageNumber: chunk.pageNumber,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    }));
  const canonicalPayload = {
    version: DOCUMENT_INDEX_FINGERPRINT_VERSION,
    sourceSha256: input.sourceSha256,
    mediaType: input.mediaType,
    extractorVersion: input.extractorVersion,
    chunkerVersion: input.chunkerVersion,
    embeddingModel: input.embeddingModel,
    embeddingDimensions: input.embeddingDimensions,
    chunks,
  };
  return createHash("sha256").update(JSON.stringify(canonicalPayload), "utf8").digest("hex");
}
