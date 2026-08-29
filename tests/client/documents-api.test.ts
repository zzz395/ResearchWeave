/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteDocument,
  getDocument,
  listDocuments,
  reindexDocument,
  uploadDocument,
} from "../../src/features/knowledge/api/documents";

const document = {
  id: "10000000-0000-4000-8000-000000000001",
  spaceId: "20000000-0000-4000-8000-000000000001",
  uploadedByUserId: "30000000-0000-4000-8000-000000000001",
  originalFilename: "notes.txt",
  mediaType: "text",
  sizeBytes: 12,
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
};

afterEach(() => vi.unstubAllGlobals());

describe("document API requests", () => {
  it("preserves list cursor semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ documents: [document], nextCursor: "next-page" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listDocuments(document.spaceId, { cursor: "current-page", limit: 50 }))
      .resolves.toMatchObject({ nextCursor: "next-page" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/spaces/${document.spaceId}/documents?limit=50&cursor=current-page`,
    );
  });

  it.each([200, 201])("uploads multipart form data for a %i response without a JSON content type", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ document, created: status === 201 }),
      { status, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["indexable text"], "notes.txt", { type: "text/plain" });

    await expect(uploadDocument(document.spaceId, file)).resolves.toMatchObject({ document });
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(new Headers(options.headers).has("Content-Type")).toBe(false);
    expect((options.body as FormData).get("file")).toBe(file);
  });

  it("loads document details using the shared response contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ document }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDocument(document.spaceId, document.id)).resolves.toEqual(document);
  });

  it("queues reindex through the existing 202 endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ document }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reindexDocument(document.spaceId, document.id)).resolves.toEqual(document);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/spaces/${document.spaceId}/documents/${document.id}/reindex`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("uses hard delete and accepts an empty 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteDocument(document.spaceId, document.id)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
});
