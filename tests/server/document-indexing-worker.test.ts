import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { DocumentRecord } from "../../server/db/schema";
import { createDocumentChunker } from "../../server/modules/documents/document-chunker";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  DocumentEmbeddingError,
  UnconfiguredDocumentEmbeddingGenerator,
  type DocumentEmbeddingGenerator,
} from "../../server/modules/documents/document-embedding-generator";
import { DocumentIndexingWorker } from "../../server/modules/documents/document-indexing-worker";
import { DocumentIngestionError } from "../../server/modules/documents/document-ingestion-errors";
import type { DocumentTextExtractor } from "../../server/modules/documents/document-text-extractor";
import {
  hasActiveDocumentIndex,
  type DocumentIndexChunk,
} from "../../server/modules/documents/repository";
import {
  InMemoryDocumentRepository,
  InMemoryDocumentStorage,
  InMemorySpaceRepository,
} from "../helpers/in-memory-repositories";

const logger = pino({ level: "silent" });
const NOW = new Date("2026-08-29T00:00:00.000Z");
const SOURCE_SHA = "a".repeat(64);

function documentRecord(
  id: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    spaceId: "10000000-0000-4000-8000-000000000001",
    uploadedByUserId: "20000000-0000-4000-8000-000000000001",
    originalFilename: "notes.txt",
    mediaType: "text",
    sizeBytes: 12,
    sourceSha256: SOURCE_SHA,
    storageKey: `spaces/space/${id}/source`,
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
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T00:00:00.000Z"),
    ...overrides,
  };
}

function oldChunk(content = "old active content", ordinal = 0): DocumentIndexChunk {
  return {
    ordinal,
    content,
    contentHash: (ordinal === 0 ? "b" : "c").repeat(64),
    pageNumber: null,
    startOffset: 0,
    endOffset: content.length,
    embedding: Array.from({ length: DOCUMENT_EMBEDDING_DIMENSIONS }, () => 0.1),
  };
}

const sourceExtractor: DocumentTextExtractor = {
  extract({ mediaType, bytes }) {
    const text = new TextDecoder().decode(bytes);
    return Promise.resolve({
      mediaType,
      extractorVersion: "utf8-source-v1",
      pageCount: null,
      characterCount: text.length,
      units: [{ pageNumber: null, text }],
    });
  },
};

const successfulEmbeddings: DocumentEmbeddingGenerator = {
  embed({ texts }) {
    return Promise.resolve({
      model: DOCUMENT_EMBEDDING_MODEL,
      dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      embeddings: texts.map((_text, index) =>
        Array.from({ length: DOCUMENT_EMBEDDING_DIMENSIONS }, () => index + 0.25),
      ),
    });
  },
};

function harness(options: {
  extractor?: DocumentTextExtractor;
  embeddingGenerator?: DocumentEmbeddingGenerator;
} = {}) {
  const repository = new InMemoryDocumentRepository(new InMemorySpaceRepository());
  const storage = new InMemoryDocumentStorage();
  const worker = new DocumentIndexingWorker({
    repository,
    storage,
    extractor: options.extractor ?? sourceExtractor,
    chunker: createDocumentChunker(),
    embeddingGenerator: options.embeddingGenerator ?? successfulEmbeddings,
    logger,
    now: () => new Date(NOW),
    sleep: () => Promise.resolve(),
  });
  const add = (record: DocumentRecord, content = "new indexable document text") => {
    repository.documents.set(record.id, record);
    storage.sources.set(record.storageKey, new TextEncoder().encode(content));
  };
  return { repository, storage, worker, add };
}

describe("document indexing worker", () => {
  it("recovers before start, polls durably, and stops without claiming concurrently", async () => {
    let releaseSleep: (() => void) | undefined;
    const repository = new InMemoryDocumentRepository(new InMemorySpaceRepository());
    const storage = new InMemoryDocumentStorage();
    const record = documentRecord("30000000-0000-4000-8000-000000000000", {
      status: "processing",
      stage: "embedding",
      attemptCount: 2,
    });
    repository.documents.set(record.id, record);
    storage.sources.set(record.storageKey, new TextEncoder().encode("lifecycle text"));
    const worker = new DocumentIndexingWorker({
      repository,
      storage,
      extractor: sourceExtractor,
      chunker: createDocumentChunker(),
      embeddingGenerator: successfulEmbeddings,
      logger,
      now: () => new Date(NOW),
      sleep: () =>
        new Promise<void>((resolve) => {
          releaseSleep = resolve;
        }),
    });

    await worker.start();
    await vi.waitFor(() => expect(repository.documents.get(record.id)?.status).toBe("ready"));
    expect(repository.documents.get(record.id)?.attemptCount).toBe(3);
    await vi.waitFor(() => expect(releaseSleep).toBeTypeOf("function"));
    const stopping = worker.stop();
    releaseSleep?.();
    await stopping;
  });

  it("claims queued work, persists durable stages, and atomically activates a complete index", async () => {
    const test = harness();
    const record = documentRecord("30000000-0000-4000-8000-000000000001");
    test.add(record);

    await expect(test.worker.processNext()).resolves.toBe(true);
    expect(test.repository.claimedDocumentIds).toEqual([record.id]);
    expect(test.repository.stageUpdates).toEqual([
      { documentId: record.id, stage: "chunking" },
      { documentId: record.id, stage: "embedding" },
    ]);
    expect(test.repository.documents.get(record.id)).toMatchObject({
      status: "ready",
      stage: null,
      attemptCount: 1,
      lastAttemptAt: NOW,
      errorCode: null,
      failedAt: null,
      characterCount: 27,
      chunkCount: 1,
      extractorVersion: "utf8-source-v1",
      chunkerVersion: "deterministic-char-v1",
      embeddingModel: DOCUMENT_EMBEDDING_MODEL,
      embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      indexedAt: NOW,
    });
    expect(test.repository.documents.get(record.id)?.indexFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(test.repository.documentChunks.get(record.id)).toHaveLength(1);
    expect(test.repository.documentChunks.get(record.id)?.[0]?.embedding).toHaveLength(1536);
  });

  it("serializes concurrent processNext calls and drains queued documents in queue order", async () => {
    let release: (() => void) | undefined;
    let active = 0;
    let maximumActive = 0;
    const blockingGenerator: DocumentEmbeddingGenerator = {
      async embed({ texts }) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        active -= 1;
        return successfulEmbeddings.embed({ texts });
      },
    };
    const test = harness({ embeddingGenerator: blockingGenerator });
    const laterId = "30000000-0000-4000-8000-000000000002";
    const firstId = "30000000-0000-4000-8000-000000000001";
    test.add(documentRecord(laterId, { updatedAt: new Date("2026-08-28T00:00:01.000Z") }));
    test.add(documentRecord(firstId));

    const first = test.worker.processNext();
    const duplicate = test.worker.processNext();
    await vi.waitFor(() => expect(active).toBe(1));
    expect(test.repository.claimedDocumentIds).toEqual([firstId]);
    release?.();
    await expect(Promise.all([first, duplicate])).resolves.toEqual([true, true]);
    expect(maximumActive).toBe(1);

    const second = test.worker.processNext();
    await vi.waitFor(() => expect(active).toBe(1));
    release?.();
    await expect(second).resolves.toBe(true);
    expect(test.repository.claimedDocumentIds).toEqual([firstId, laterId]);
    expect(maximumActive).toBe(1);
    await expect(test.worker.processNext()).resolves.toBe(false);
  });

  it("maps source and extraction failures at the extracting stage", async () => {
    const missing = harness();
    const missingRecord = documentRecord("30000000-0000-4000-8000-000000000003");
    missing.repository.documents.set(missingRecord.id, missingRecord);
    await missing.worker.processNext();
    expect(missing.repository.documents.get(missingRecord.id)).toMatchObject({
      status: "failed",
      stage: "extracting",
      errorCode: "document_source_unavailable",
    });

    const invalid = harness({
      extractor: {
        extract: () => Promise.reject(new DocumentIngestionError("document_invalid_utf8")),
      },
    });
    const invalidRecord = documentRecord("30000000-0000-4000-8000-000000000004");
    invalid.add(invalidRecord);
    await invalid.worker.processNext();
    expect(invalid.repository.documents.get(invalidRecord.id)).toMatchObject({
      status: "failed",
      stage: "extracting",
      errorCode: "document_invalid_utf8",
    });
  });

  it("rejects zero chunks at chunking and never calls embeddings", async () => {
    const embed = vi.fn<DocumentEmbeddingGenerator["embed"]>();
    const test = harness({
      extractor: {
        extract: () =>
          Promise.resolve({
            mediaType: "text",
            extractorVersion: "utf8-source-v1",
            pageCount: null,
            characterCount: 0,
            units: [{ pageNumber: null, text: "" }],
          }),
      },
      embeddingGenerator: { embed },
    });
    const record = documentRecord("30000000-0000-4000-8000-000000000005");
    test.add(record, "");
    await test.worker.processNext();
    expect(test.repository.documents.get(record.id)).toMatchObject({
      status: "failed",
      stage: "chunking",
      errorCode: "document_no_indexable_text",
      indexedAt: null,
    });
    expect(embed).not.toHaveBeenCalled();
    expect(test.repository.documentChunks.has(record.id)).toBe(false);
  });

  it("preserves an old active index when a later embedding batch fails", async () => {
    const test = harness({
      embeddingGenerator: {
        embed: () =>
          Promise.reject(new DocumentEmbeddingError("document_embedding_unavailable")),
      },
    });
    const indexedAt = new Date("2026-08-20T00:00:00.000Z");
    const record = documentRecord("30000000-0000-4000-8000-000000000006", {
      status: "ready",
      chunkCount: 1,
      characterCount: 18,
      extractorVersion: "old-extractor",
      chunkerVersion: "old-chunker",
      embeddingModel: DOCUMENT_EMBEDDING_MODEL,
      embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      indexFingerprint: "c".repeat(64),
      indexedAt,
    });
    const previous = [oldChunk()];
    test.add(record);
    test.repository.documentChunks.set(record.id, previous);
    await test.repository.queueReindexForMember(record.spaceId, record.id, record.uploadedByUserId!);
    // The repository under test has no membership for this direct worker fixture; queue explicitly.
    test.repository.documents.set(record.id, { ...record, status: "queued", stage: null });

    await test.worker.processNext();
    const failed = test.repository.documents.get(record.id)!;
    expect(failed).toMatchObject({
      status: "failed",
      stage: "embedding",
      errorCode: "document_embedding_unavailable",
      indexedAt,
      indexFingerprint: "c".repeat(64),
      chunkCount: 1,
    });
    expect(hasActiveDocumentIndex(failed)).toBe(true);
    expect(test.repository.documentChunks.get(record.id)).toEqual(previous);
  });

  it("fails explicitly when embeddings are unconfigured", async () => {
    const test = harness({
      embeddingGenerator: new UnconfiguredDocumentEmbeddingGenerator(),
    });
    const record = documentRecord("30000000-0000-4000-8000-000000000014");
    test.add(record);
    await test.worker.processNext();
    expect(test.repository.documents.get(record.id)).toMatchObject({
      status: "failed",
      stage: "embedding",
      errorCode: "document_embedding_unconfigured",
      indexedAt: null,
    });
    expect(test.repository.documentChunks.has(record.id)).toBe(false);
  });

  it("rejects invalid generator model, dimensions, count, and sparse vectors", async () => {
    const invalidResults = [
      {
        model: "unexpected-model",
        dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddings: [Array.from({ length: 1536 }, () => 0.1)],
      },
      {
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: 3072,
        embeddings: [Array.from({ length: 1536 }, () => 0.1)],
      },
      {
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddings: [],
      },
      {
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddings: Array(1),
      },
    ];
    for (const [index, invalid] of invalidResults.entries()) {
      const test = harness({
        embeddingGenerator: {
          embed: () => Promise.resolve(invalid as never),
        },
      });
      const record = documentRecord(`30000000-0000-4000-8000-00000000002${index}`);
      test.add(record);
      await test.worker.processNext();
      expect(test.repository.documents.get(record.id)).toMatchObject({
        status: "failed",
        stage: "embedding",
        errorCode: "document_embedding_invalid_response",
      });
      expect(test.repository.documentChunks.has(record.id)).toBe(false);
    }
  });

  it("rolls back activation failure, marks persistence failure, and preserves the old index", async () => {
    const test = harness();
    const indexedAt = new Date("2026-08-20T00:00:00.000Z");
    const oldFingerprint = "d".repeat(64);
    const record = documentRecord("30000000-0000-4000-8000-000000000007", {
      status: "queued",
      pageCount: 3,
      characterCount: 42,
      chunkCount: 2,
      extractorVersion: "old-extractor",
      chunkerVersion: "old-chunker",
      embeddingModel: "old-embedding-model",
      embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      indexFingerprint: oldFingerprint,
      indexedAt,
    });
    const previous = [
      oldChunk("old active first chunk", 0),
      oldChunk("old active second chunk", 1),
    ];
    test.add(record);
    test.repository.documentChunks.set(record.id, previous);
    test.repository.failNextActivationAt = "during_insert";

    await test.worker.processNext();
    expect(test.repository.documents.get(record.id)).toMatchObject({
      status: "failed",
      stage: "embedding",
      errorCode: "document_index_persistence_failed",
      pageCount: 3,
      characterCount: 42,
      chunkCount: 2,
      extractorVersion: "old-extractor",
      chunkerVersion: "old-chunker",
      embeddingModel: "old-embedding-model",
      embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      indexedAt,
      indexFingerprint: oldFingerprint,
    });
    expect(test.repository.documentChunks.get(record.id)).toEqual(previous);
    expect(test.repository.documentChunks.get(record.id)).not.toContainEqual(
      expect.objectContaining({ content: "new indexable document text" }),
    );
    expect(test.repository.activationEvents).toEqual([
      "begin",
      "delete-old-chunks",
      "insert-new-batch",
      "fail",
      "rollback",
    ]);
  });

  it("atomically replaces an old active index only after a successful rebuild", async () => {
    const test = harness();
    const record = documentRecord("30000000-0000-4000-8000-000000000008", {
      status: "queued",
      chunkCount: 1,
      indexFingerprint: "e".repeat(64),
      indexedAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    const previous = [oldChunk()];
    test.add(record, "replacement content");
    test.repository.documentChunks.set(record.id, previous);

    const processing = test.worker.processNext();
    await processing;
    expect(test.repository.documents.get(record.id)).toMatchObject({
      status: "ready",
      indexedAt: NOW,
      characterCount: 19,
    });
    expect(test.repository.documentChunks.get(record.id)).not.toEqual(previous);
    expect(test.repository.documentChunks.get(record.id)?.[0]?.content).toBe("replacement content");
  });

  it("stops stale or deleted attempts without activating or resurrecting", async () => {
    const stale = harness();
    const staleRecord = documentRecord("30000000-0000-4000-8000-000000000009");
    stale.add(staleRecord);
    stale.repository.beforeNextActivation = () => {
      const current = stale.repository.documents.get(staleRecord.id)!;
      stale.repository.documents.set(staleRecord.id, { ...current, attemptCount: 2 });
    };
    await stale.worker.processNext();
    expect(stale.repository.documents.get(staleRecord.id)).toMatchObject({
      status: "processing",
      attemptCount: 2,
    });
    expect(stale.repository.documentChunks.has(staleRecord.id)).toBe(false);

    const deleted = harness();
    const deletedRecord = documentRecord("30000000-0000-4000-8000-000000000010");
    deleted.add(deletedRecord);
    deleted.repository.beforeNextActivation = () => {
      deleted.repository.documents.delete(deletedRecord.id);
    };
    await deleted.worker.processNext();
    expect(deleted.repository.documents.has(deletedRecord.id)).toBe(false);
    expect(deleted.repository.documentChunks.has(deletedRecord.id)).toBe(false);
  });

  it("stops after stage ownership loss and does not call embeddings", async () => {
    const embed = vi.fn((input: { texts: string[] }) => successfulEmbeddings.embed(input));
    const test = harness({ embeddingGenerator: { embed } });
    const record = documentRecord("30000000-0000-4000-8000-000000000011");
    test.add(record);
    test.repository.beforeNextStageUpdate = () => {
      const current = test.repository.documents.get(record.id)!;
      test.repository.documents.set(record.id, { ...current, attemptCount: 2 });
    };
    await test.worker.processNext();
    expect(embed).not.toHaveBeenCalled();
    expect(test.repository.documentChunks.has(record.id)).toBe(false);
  });

  it("continues with the next queued document after one document fails", async () => {
    let calls = 0;
    const test = harness({
      embeddingGenerator: {
        embed(input) {
          calls += 1;
          return calls === 1
            ? Promise.reject(new DocumentEmbeddingError("document_embedding_rejected"))
            : successfulEmbeddings.embed(input);
        },
      },
    });
    const first = documentRecord("30000000-0000-4000-8000-000000000012");
    const second = documentRecord("30000000-0000-4000-8000-000000000013", {
      updatedAt: new Date("2026-08-28T00:00:01.000Z"),
    });
    test.add(first);
    test.add(second);
    await test.worker.processNext();
    await test.worker.processNext();
    expect(test.repository.documents.get(first.id)?.status).toBe("failed");
    expect(test.repository.documents.get(second.id)?.status).toBe("ready");
  });
});

describe("document indexing recovery and active-index semantics", () => {
  it.each(["extracting", "chunking", "embedding"] as const)(
    "recovers processing/%s to queued/null without clearing active metadata",
    async (stage) => {
      const test = harness();
      const lastAttemptAt = new Date("2026-08-21T00:00:00.000Z");
      const indexedAt = new Date("2026-08-20T00:00:00.000Z");
      const record = documentRecord(`40000000-0000-4000-8000-00000000000${stage.length}`, {
        status: "processing",
        stage,
        attemptCount: 3,
        lastAttemptAt,
        pageCount: 2,
        characterCount: 100,
        chunkCount: 1,
        extractorVersion: "old-extractor",
        chunkerVersion: "old-chunker",
        embeddingModel: DOCUMENT_EMBEDDING_MODEL,
        embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        indexFingerprint: "f".repeat(64),
        indexedAt,
      });
      test.repository.documents.set(record.id, record);
      test.repository.documentChunks.set(record.id, [oldChunk()]);

      await expect(test.repository.recoverProcessingDocuments(NOW)).resolves.toBe(1);
      const recovered = test.repository.documents.get(record.id)!;
      expect(recovered).toMatchObject({
        status: "queued",
        stage: null,
        attemptCount: 3,
        lastAttemptAt,
        pageCount: 2,
        characterCount: 100,
        chunkCount: 1,
        extractorVersion: "old-extractor",
        chunkerVersion: "old-chunker",
        embeddingModel: DOCUMENT_EMBEDDING_MODEL,
        embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        indexFingerprint: "f".repeat(64),
        indexedAt,
        updatedAt: NOW,
      });
      expect(test.repository.documentChunks.get(record.id)).toEqual([oldChunk()]);
      expect(hasActiveDocumentIndex(recovered)).toBe(true);
    },
  );

  it("uses indexedAt, not status, as active-index truth", () => {
    expect(hasActiveDocumentIndex(documentRecord("50000000-0000-4000-8000-000000000001", {
      status: "ready",
      indexedAt: NOW,
    }))).toBe(true);
    expect(hasActiveDocumentIndex(documentRecord("50000000-0000-4000-8000-000000000002", {
      status: "processing",
      stage: "embedding",
      indexedAt: NOW,
    }))).toBe(true);
    expect(hasActiveDocumentIndex(documentRecord("50000000-0000-4000-8000-000000000003", {
      status: "failed",
      stage: "embedding",
      indexedAt: NOW,
    }))).toBe(true);
    expect(hasActiveDocumentIndex(documentRecord("50000000-0000-4000-8000-000000000004", {
      status: "failed",
      stage: "embedding",
      indexedAt: null,
    }))).toBe(false);
  });
});
