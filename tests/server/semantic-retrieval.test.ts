import { createHash } from "node:crypto";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { semanticRetrievalResponseSchema } from "../../shared/contracts/retrieval";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import type { DocumentRecord } from "../../server/db/schema";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  DocumentEmbeddingError,
  type DocumentEmbeddingGenerator,
} from "../../server/modules/documents/document-embedding-generator";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;
const NOW = new Date("2026-08-29T00:00:00.000Z");

function vector(first: number, second: number): number[] {
  return [first, second, ...Array.from({ length: DOCUMENT_EMBEDDING_DIMENSIONS - 2 }, () => 0)];
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function documentRecord(
  id: string,
  spaceId: string,
  uploadedByUserId: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    spaceId,
    uploadedByUserId,
    originalFilename: `${id.slice(-4)}.txt`,
    mediaType: "text",
    sizeBytes: 20,
    sourceSha256: id.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    storageKey: `spaces/${spaceId}/${id}/source`,
    status: "ready",
    stage: null,
    attemptCount: 1,
    lastAttemptAt: NOW,
    errorCode: null,
    failedAt: null,
    pageCount: null,
    characterCount: 20,
    chunkCount: 1,
    extractorVersion: "utf8-source-v1",
    chunkerVersion: "deterministic-char-v1",
    embeddingModel: DOCUMENT_EMBEDDING_MODEL,
    embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
    indexFingerprint: "a".repeat(64),
    indexedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function generator(
  implementation: DocumentEmbeddingGenerator["embed"] = ({ texts }) =>
    Promise.resolve({
      model: DOCUMENT_EMBEDDING_MODEL,
      dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      embeddings: texts.map(() => vector(1, 0)),
    }),
): DocumentEmbeddingGenerator & { embed: ReturnType<typeof vi.fn> } {
  return { embed: vi.fn(implementation) };
}

function harness(embeddingGenerator: DocumentEmbeddingGenerator) {
  return createTestApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    embeddingGenerator,
  );
}

async function register(agent: ReturnType<typeof request.agent>, email: string) {
  const response = await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ email, displayName: "Retrieval User", password: "correct-horse-battery" })
    .expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function createSpace(agent: ReturnType<typeof request.agent>) {
  const response = await agent
    .post("/api/v1/spaces")
    .set("Origin", origin)
    .send({ name: "Semantic Retrieval Space" })
    .expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

describe("semantic retrieval API", () => {
  it("requires authentication and current Space membership before embedding", async () => {
    const embeddingGenerator = generator();
    const test = harness(embeddingGenerator);
    const ownerAgent = request.agent(test.app);
    const outsiderAgent = request.agent(test.app);
    await register(ownerAgent, "retrieval-owner@example.com");
    await register(outsiderAgent, "retrieval-outsider@example.com");
    const space = await createSpace(ownerAgent);

    await request(test.app)
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "semantic search" })
      .expect(401);
    const outsider = await outsiderAgent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "semantic search" })
      .expect(404);
    expect(errorEnvelopeSchema.parse(outsider.body).error.code).toBe("space_not_found");
    expect(embeddingGenerator.embed.mock.calls).toHaveLength(0);
  });

  it("returns an explicit error when the Space has no active index", async () => {
    const embeddingGenerator = generator();
    const test = harness(embeddingGenerator);
    const agent = request.agent(test.app);
    await register(agent, "retrieval-not-indexed@example.com");
    const space = await createSpace(agent);

    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "search an unindexed knowledge base" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("knowledge_not_indexed");
  });

  it("validates and trims query input and applies the default limit of eight", async () => {
    const embeddingGenerator = generator();
    const test = harness(embeddingGenerator);
    const agent = request.agent(test.app);
    const user = await register(agent, "retrieval-validation@example.com");
    const space = await createSpace(agent);

    for (const query of [" ", " x ", "x".repeat(2001)]) {
      await agent
        .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
        .set("Origin", origin)
        .send({ query })
        .expect(400);
    }
    for (const limit of [0, 21, 1.5]) {
      await agent
        .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
        .set("Origin", origin)
        .send({ query: "valid query", limit })
        .expect(400);
    }

    for (let index = 0; index < 9; index += 1) {
      const id = `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      test.documentRepository.documents.set(id, documentRecord(id, space.id, user.id));
      const content = `retrievable chunk ${index}`;
      test.documentRepository.documentChunks.set(id, [
        {
          ordinal: 0,
          content,
          contentHash: hash(content),
          pageNumber: null,
          startOffset: 0,
          endOffset: content.length,
          embedding: vector(1, index / 10),
        },
      ]);
    }

    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "  trimmed question  " })
      .expect(200);
    const parsed = semanticRetrievalResponseSchema.parse(response.body);
    expect(parsed.results).toHaveLength(8);
    expect(embeddingGenerator.embed.mock.calls.at(-1)?.[0]).toEqual({
      texts: ["trimmed question"],
    });
  });

  it("uses indexedAt and embedding compatibility, with exact cosine and stable ties", async () => {
    const embeddingGenerator = generator();
    const test = harness(embeddingGenerator);
    const ownerAgent = request.agent(test.app);
    const memberAgent = request.agent(test.app);
    const owner = await register(ownerAgent, "retrieval-rank-owner@example.com");
    const member = await register(memberAgent, "retrieval-rank-member@example.com");
    const space = await createSpace(ownerAgent);
    test.spaceRepository.addMember(space.id, member.id);

    const fixtures = [
      ["30000000-0000-4000-8000-000000000001", "failed", NOW, DOCUMENT_EMBEDDING_MODEL, 1536, vector(1, 0)],
      ["30000000-0000-4000-8000-000000000002", "processing", NOW, DOCUMENT_EMBEDDING_MODEL, 1536, vector(1, 0)],
      ["30000000-0000-4000-8000-000000000003", "ready", NOW, DOCUMENT_EMBEDDING_MODEL, 1536, vector(0, 1)],
      ["30000000-0000-4000-8000-000000000004", "ready", null, DOCUMENT_EMBEDDING_MODEL, 1536, vector(1, 0)],
    ] as const;
    for (const [id, status, indexedAt, model, dimensions, embedding] of fixtures) {
      test.documentRepository.documents.set(
        id,
        documentRecord(id, space.id, owner.id, {
          status,
          stage: status === "processing" ? "embedding" : status === "failed" ? "embedding" : null,
          indexedAt,
          embeddingModel: model,
          embeddingDimensions: dimensions,
        }),
      );
      const content = `content ${id}`;
      test.documentRepository.documentChunks.set(id, [
        {
          ordinal: 0,
          content,
          contentHash: hash(content),
          pageNumber: null,
          startOffset: 0,
          endOffset: content.length,
          embedding,
        },
      ]);
    }

    const response = await memberAgent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "find compatible active chunks", limit: 20 })
      .expect(200);
    const results = semanticRetrievalResponseSchema.parse(response.body).results;
    expect(results.map((result) => result.documentId)).toEqual([
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
    ]);
    expect(results.map((result) => result.cosineDistance)).toEqual([0, 0, 1]);
  });

  it.each([
    [
      "model",
      { status: "failed", stage: "embedding", embeddingModel: "other-model" },
    ],
    [
      "dimensions",
      { status: "processing", stage: "embedding", embeddingDimensions: 3072 },
    ],
  ] as const)("rejects a mixed Space with incompatible active %s metadata", async (_kind, overrides) => {
    const test = harness(generator());
    const agent = request.agent(test.app);
    const user = await register(agent, `retrieval-mixed-${_kind}@example.com`);
    const space = await createSpace(agent);
    const compatibleId = "30000000-0000-4000-8000-000000000011";
    const incompatibleId = "30000000-0000-4000-8000-000000000012";

    for (const [id, documentOverrides] of [
      [compatibleId, {}],
      [incompatibleId, overrides],
    ] as const) {
      test.documentRepository.documents.set(
        id,
        documentRecord(id, space.id, user.id, documentOverrides),
      );
      const content = `mixed compatibility ${id}`;
      test.documentRepository.documentChunks.set(id, [
        {
          ordinal: 0,
          content,
          contentHash: hash(content),
          pageNumber: null,
          startOffset: 0,
          endOffset: content.length,
          embedding: vector(1, 0),
        },
      ]);
    }

    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "must search the whole knowledge base" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(
      "knowledge_embedding_incompatible",
    );
  });

  it("rejects a query embedding dimension that is incompatible with the active index", async () => {
    const queryDimensions = 3072;
    const embeddingGenerator = generator(() =>
      Promise.resolve({
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: queryDimensions,
        embeddings: [Array.from({ length: queryDimensions }, (_, index) => (index === 0 ? 1 : 0))],
      } as never),
    );
    const test = harness(embeddingGenerator);
    const agent = request.agent(test.app);
    const user = await register(agent, "retrieval-query-dimensions@example.com");
    const space = await createSpace(agent);
    const id = "30000000-0000-4000-8000-000000000013";
    test.documentRepository.documents.set(id, documentRecord(id, space.id, user.id));

    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "incompatible query dimensions" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(
      "knowledge_embedding_incompatible",
    );
  });

  it("returns an empty success when compatible active indexes have no chunks", async () => {
    const test = harness(generator());
    const agent = request.agent(test.app);
    const user = await register(agent, "retrieval-empty-result@example.com");
    const space = await createSpace(agent);
    const id = "30000000-0000-4000-8000-000000000014";
    test.documentRepository.documents.set(id, documentRecord(id, space.id, user.id));

    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "no matching chunks" })
      .expect(200);
    expect(semanticRetrievalResponseSchema.parse(response.body).results).toEqual([]);
  });

  it("rechecks membership after embedding to close the revoke race", async () => {
    let revokeMembership: () => void = () => undefined;
    const embeddingGenerator = generator(() => {
      revokeMembership();
      return Promise.resolve({
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddings: [vector(1, 0)],
      });
    });
    const test = harness(embeddingGenerator);
    const agent = request.agent(test.app);
    const user = await register(agent, "retrieval-revoke@example.com");
    const space = await createSpace(agent);
    revokeMembership = () => test.spaceRepository.memberships.delete(`${space.id}:${user.id}`);

    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "membership revoked during query" })
      .expect(404);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("space_not_found");
  });

  it.each([
    ["document_embedding_unconfigured", 503, "retrieval_embedding_unconfigured"],
    ["document_embedding_unavailable", 503, "retrieval_embedding_unavailable"],
    ["document_embedding_rejected", 502, "retrieval_embedding_rejected"],
    ["document_embedding_invalid_response", 502, "retrieval_embedding_invalid_response"],
  ] as const)("maps %s to a retrieval-scoped failure", async (providerCode, status, apiCode) => {
    const test = harness(generator(() => Promise.reject(new DocumentEmbeddingError(providerCode))));
    const agent = request.agent(test.app);
    await register(agent, `${providerCode}@example.com`);
    const space = await createSpace(agent);
    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
      .set("Origin", origin)
      .send({ query: "provider failure" })
      .expect(status);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(apiCode);
  });

  it("rejects invalid query embedding metadata and vectors", async () => {
    const invalidResults = [
      { model: "", dimensions: 1536, embeddings: [vector(1, 0)] },
      { model: DOCUMENT_EMBEDDING_MODEL, dimensions: 1536, embeddings: [] },
      { model: DOCUMENT_EMBEDDING_MODEL, dimensions: 1536, embeddings: [[1, 0]] },
      {
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: 1536,
        embeddings: [[Number.NaN, ...Array.from({ length: 1535 }, () => 0)]],
      },
    ];
    for (const [index, invalid] of invalidResults.entries()) {
      const test = harness(generator(() => Promise.resolve(invalid as never)));
      const agent = request.agent(test.app);
      await register(agent, `invalid-retrieval-${index}@example.com`);
      const space = await createSpace(agent);
      const response = await agent
        .post(`/api/v1/spaces/${space.id}/knowledge/retrieve`)
        .set("Origin", origin)
        .send({ query: "invalid provider response" })
        .expect(502);
      expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(
        "retrieval_embedding_invalid_response",
      );
    }
  });
});
