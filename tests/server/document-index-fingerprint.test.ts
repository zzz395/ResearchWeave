import { describe, expect, it } from "vitest";

import { createDocumentIndexFingerprint } from "../../server/modules/documents/document-index-fingerprint";

const base = {
  sourceSha256: "a".repeat(64),
  mediaType: "text" as const,
  extractorVersion: "utf8-source-v1",
  chunkerVersion: "deterministic-char-v1",
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: 1536,
  chunks: [
    {
      ordinal: 0,
      contentHash: "b".repeat(64),
      pageNumber: null,
      startOffset: 0,
      endOffset: 10,
    },
    {
      ordinal: 1,
      contentHash: "c".repeat(64),
      pageNumber: null,
      startOffset: 8,
      endOffset: 20,
    },
  ],
};

describe("document index fingerprint", () => {
  it("is deterministic, lowercase SHA-256, and canonicalizes chunk array order by ordinal", () => {
    const fingerprint = createDocumentIndexFingerprint(base);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(createDocumentIndexFingerprint(base)).toBe(fingerprint);
    expect(
      createDocumentIndexFingerprint({ ...base, chunks: [...base.chunks].reverse() }),
    ).toBe(fingerprint);
  });

  it.each([
    ["source", { sourceSha256: "d".repeat(64) }],
    ["media type", { mediaType: "markdown" as const }],
    ["extractor", { extractorVersion: "other-extractor" }],
    ["chunker", { chunkerVersion: "other-chunker" }],
    ["model", { embeddingModel: "other-model" }],
    ["dimensions", { embeddingDimensions: 3072 }],
    ["content hash", { chunks: [{ ...base.chunks[0], contentHash: "e".repeat(64) }, base.chunks[1]] }],
    ["page number", { chunks: [{ ...base.chunks[0], pageNumber: 1 }, base.chunks[1]] }],
    ["start offset", { chunks: [{ ...base.chunks[0], startOffset: 1 }, base.chunks[1]] }],
    ["end offset", { chunks: [{ ...base.chunks[0], endOffset: 11 }, base.chunks[1]] }],
    ["ordinal identity", { chunks: [{ ...base.chunks[0], ordinal: 2 }, base.chunks[1]] }],
  ])("changes when %s changes", (_label, change) => {
    expect(createDocumentIndexFingerprint({ ...base, ...change })).not.toBe(
      createDocumentIndexFingerprint(base),
    );
  });
});
