import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CHUNK_OVERLAP_CHARS,
  MAX_CHUNK_CHARS,
  MAX_DOCUMENT_CHUNKS,
  MAX_PRIMARY_CHARS,
  createDocumentChunker,
} from "../../server/modules/documents/document-chunker";
import type {
  ExtractedDocument,
  ExtractedTextUnit,
} from "../../server/modules/documents/document-text-extractor";

function documentWith(
  units: ExtractedTextUnit[],
  mediaType: ExtractedDocument["mediaType"] = "text",
): ExtractedDocument {
  return {
    mediaType,
    extractorVersion: mediaType === "pdf" ? "pdf-unpdf-v1" : "utf8-source-v1",
    pageCount: mediaType === "pdf" ? units.length : null,
    characterCount: units.reduce((sum, unit) => sum + unit.text.length, 0),
    units,
  };
}

describe("deterministic document chunking", () => {
  const chunker = createDocumentChunker();

  it("uses 2700-character primary spans with at most 300 preceding characters", () => {
    const text = "x".repeat(7000);
    const result = chunker.chunk(documentWith([{ pageNumber: null, text }]));
    expect(result.chunkerVersion).toBe("deterministic-char-v1");
    expect(result.chunks.map(({ startOffset, endOffset }) => [startOffset, endOffset])).toEqual([
      [0, 2700],
      [2400, 5400],
      [5100, 7000],
    ]);
    for (const chunk of result.chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(chunk.content).toBe(text.slice(chunk.startOffset, chunk.endOffset));
    }
    for (let index = 1; index < result.chunks.length; index += 1) {
      const previous = result.chunks[index - 1];
      const current = result.chunks[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(previous.endOffset - current.startOffset).toBeLessThanOrEqual(
        CHUNK_OVERLAP_CHARS,
      );
    }
  });

  it("prefers paragraph, then sentence, then whitespace boundaries", () => {
    const paragraphText =
      `${"a".repeat(1000)}\n  \n${"b".repeat(1500)}. ${"c".repeat(1000)}`;
    const paragraph = chunker.chunk(documentWith([{ pageNumber: null, text: paragraphText }]));
    expect(paragraph.chunks[0]?.endOffset).toBe(1004);

    const sentenceText = `${"a".repeat(1800)}. ${"b".repeat(1200)}`;
    const sentence = chunker.chunk(documentWith([{ pageNumber: null, text: sentenceText }]));
    expect(sentence.chunks[0]?.endOffset).toBe(1802);

    const whitespaceText = `${"a".repeat(1600)} ${"b".repeat(1500)}`;
    const whitespace = chunker.chunk(documentWith([{ pageNumber: null, text: whitespaceText }]));
    expect(whitespace.chunks[0]?.endOffset).toBe(1601);
  });

  it("uses UTF-16-safe hard splits for long text without whitespace", () => {
    const text = `${"a".repeat(MAX_PRIMARY_CHARS - 1)}😀${"b".repeat(8000)}`;
    const result = chunker.chunk(documentWith([{ pageNumber: null, text }]));
    expect(result.chunks.length).toBeGreaterThan(3);
    expect(result.chunks[0]?.endOffset).toBe(MAX_PRIMARY_CHARS - 1);
    for (const chunk of result.chunks) {
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      expect(chunk.content).toBe(text.slice(chunk.startOffset, chunk.endOffset));
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(chunk.content).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(chunk.content).not.toMatch(/^[\uDC00-\uDFFF]/u);
    }
  });

  it("makes progress through a 10,000-character long paragraph", () => {
    const sentence = "word ".repeat(30) + "done. ";
    const text = sentence.repeat(70).slice(0, 10_000);
    const result = chunker.chunk(documentWith([{ pageNumber: null, text }]));
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.at(-1)?.endOffset).toBe(text.length);
    expect(result.chunks.every((chunk) => chunk.content.length <= MAX_CHUNK_CHARS)).toBe(true);
  });

  it("isolates PDF pages, page-local offsets, overlap, and global ordinals", () => {
    const pageOne = "a".repeat(4000);
    const pageTwo = `PAGE_TWO_${"b".repeat(3991)}`;
    const result = chunker.chunk(
      documentWith(
        [
          { pageNumber: 1, text: pageOne },
          { pageNumber: 2, text: pageTwo },
        ],
        "pdf",
      ),
    );
    expect(result.chunks.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2, 3]);
    expect(result.chunks.map((chunk) => chunk.pageNumber)).toEqual([1, 1, 2, 2]);
    const firstPageTwo = result.chunks.find((chunk) => chunk.pageNumber === 2);
    expect(firstPageTwo).toMatchObject({ startOffset: 0 });
    expect(firstPageTwo?.content.startsWith("PAGE_TWO_")).toBe(true);
    for (const chunk of result.chunks) {
      const source = chunk.pageNumber === 1 ? pageOne : pageTwo;
      expect(chunk.content).toBe(source.slice(chunk.startOffset, chunk.endOffset));
    }
  });

  it("uses null page provenance and document-local offsets for text and Markdown", () => {
    for (const mediaType of ["text", "markdown"] as const) {
      const text = "z".repeat(4000);
      const result = chunker.chunk(documentWith([{ pageNumber: null, text }], mediaType));
      expect(result.chunks.every((chunk) => chunk.pageNumber === null)).toBe(true);
      expect(result.chunks[1]).toMatchObject({ startOffset: 2400, endOffset: 4000 });
      expect(result.chunks[1]?.content).toBe(text.slice(2400, 4000));
    }
  });

  it("hashes exact UTF-8 chunk content without provenance metadata", () => {
    const sameText = "same 😀 content";
    const result = chunker.chunk(
      documentWith(
        [
          { pageNumber: 1, text: sameText },
          { pageNumber: 2, text: sameText },
        ],
        "pdf",
      ),
    );
    const expected = createHash("sha256").update(sameText, "utf8").digest("hex");
    expect(result.chunks.map((chunk) => chunk.contentHash)).toEqual([expected, expected]);
    expect(expected).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("allows 1000 chunks and rejects the 1001st without truncating", () => {
    const segment = `${"x".repeat(1398)}\n\n`;
    const allowed = segment.repeat(MAX_DOCUMENT_CHUNKS);
    expect(chunker.chunk(documentWith([{ pageNumber: null, text: allowed }])).chunks).toHaveLength(
      MAX_DOCUMENT_CHUNKS,
    );
    expect(() =>
      chunker.chunk(
        documentWith([{ pageNumber: null, text: segment.repeat(MAX_DOCUMENT_CHUNKS + 1) }]),
      ),
    ).toThrowError(expect.objectContaining({ code: "document_chunk_limit_exceeded" }));
  });

  it("is deeply deterministic, including ordering, offsets, and hashes", () => {
    const document = documentWith([
      {
        pageNumber: null,
        text: `${"first sentence. ".repeat(200)}\n\n${"tail".repeat(1000)}`,
      },
    ]);
    expect(chunker.chunk(document)).toEqual(chunker.chunk(document));
  });

  it("returns no drafts for empty provenance units", () => {
    expect(chunker.chunk(documentWith([{ pageNumber: null, text: "" }]))).toEqual({
      chunkerVersion: "deterministic-char-v1",
      chunks: [],
    });
  });
});
