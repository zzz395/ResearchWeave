import { createHash } from "node:crypto";

import type { ExtractedDocument } from "./document-text-extractor";
import { DocumentIngestionError } from "./document-ingestion-errors";

export const MAX_CHUNK_CHARS = 3000;
export const CHUNK_OVERLAP_CHARS = 300;
export const MAX_PRIMARY_CHARS = MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS;
export const MAX_DOCUMENT_CHUNKS = 1000;
export const DOCUMENT_CHUNKER_VERSION = "deterministic-char-v1";

export interface DocumentChunkDraft {
  ordinal: number;
  content: string;
  contentHash: string;
  pageNumber: number | null;
  startOffset: number;
  endOffset: number;
}

export interface ChunkedDocument {
  chunkerVersion: string;
  chunks: DocumentChunkDraft[];
}

export interface DocumentChunker {
  chunk(document: ExtractedDocument): ChunkedDocument;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function safeEndBoundary(text: string, proposed: number, minimum: number): number {
  if (
    proposed > minimum &&
    proposed < text.length &&
    isHighSurrogate(text.charCodeAt(proposed - 1)) &&
    isLowSurrogate(text.charCodeAt(proposed))
  ) {
    return proposed - 1;
  }
  return proposed;
}

function safeStartBoundary(text: string, proposed: number): number {
  if (
    proposed > 0 &&
    proposed < text.length &&
    isHighSurrogate(text.charCodeAt(proposed - 1)) &&
    isLowSurrogate(text.charCodeAt(proposed))
  ) {
    return proposed + 1;
  }
  return proposed;
}

function lastMatchEnd(text: string, start: number, end: number, pattern: RegExp): number | null {
  const window = text.slice(start, end);
  let result: number | null = null;
  for (const match of window.matchAll(pattern)) {
    const matchStart = match.index;
    const candidate = start + matchStart + match[0].length;
    if (candidate > start && candidate <= end) result = candidate;
  }
  return result;
}

function choosePrimaryEnd(text: string, start: number): number {
  if (text.length - start <= MAX_PRIMARY_CHARS) return text.length;

  const windowEnd = safeEndBoundary(text, start + MAX_PRIMARY_CHARS, start);
  const paragraph = lastMatchEnd(text, start, windowEnd, /\n(?:[^\S\n]*\n)+/gu);
  if (paragraph !== null) return paragraph;

  const sentence = lastMatchEnd(
    text,
    start,
    windowEnd,
    /[.!?。！？]["'”’)\]}]*\s+/gu,
  );
  if (sentence !== null) return sentence;

  const whitespace = lastMatchEnd(text, start, windowEnd, /\s+/gu);
  if (whitespace !== null) return whitespace;

  return windowEnd;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createDocumentChunker(): DocumentChunker {
  return {
    chunk(document) {
      const chunks: DocumentChunkDraft[] = [];

      for (const unit of document.units) {
        let primaryStart = 0;
        while (primaryStart < unit.text.length) {
          const primaryEnd = choosePrimaryEnd(unit.text, primaryStart);
          if (primaryEnd <= primaryStart) {
            throw new Error("Document chunker failed to make progress.");
          }

          const overlapStart = Math.max(0, primaryStart - CHUNK_OVERLAP_CHARS);
          const startOffset = safeStartBoundary(unit.text, overlapStart);
          const content = unit.text.slice(startOffset, primaryEnd);
          chunks.push({
            ordinal: chunks.length,
            content,
            contentHash: contentHash(content),
            pageNumber: unit.pageNumber,
            startOffset,
            endOffset: primaryEnd,
          });
          if (chunks.length > MAX_DOCUMENT_CHUNKS) {
            throw new DocumentIngestionError("document_chunk_limit_exceeded");
          }
          primaryStart = primaryEnd;
        }
      }

      return { chunkerVersion: DOCUMENT_CHUNKER_VERSION, chunks };
    },
  };
}
