import { createHash } from "node:crypto";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { DocumentRecord } from "../../server/db/schema";
import { GroundedAnswerGeneratorError } from "../../server/integrations/grounded-answer/errors";
import type {
  GroundedAnswerGenerationInput,
  GroundedAnswerGenerator,
} from "../../server/integrations/grounded-answer/generator";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  type DocumentEmbeddingGenerator,
} from "../../server/modules/documents/document-embedding-generator";
import { authResponseSchema } from "../../shared/contracts/auth";
import {
  groundedAnswerResponseSchema,
  type GroundedAnswerResponse,
} from "../../shared/contracts/grounded-answer";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;
const NOW = new Date("2026-08-30T00:00:00.000Z");
const insufficientMessage =
  "The available knowledge does not provide enough information to answer this question.";

function vector(first: number, second: number): number[] {
  return [first, second, ...Array.from({ length: DOCUMENT_EMBEDDING_DIMENSIONS - 2 }, () => 0)];
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function embeddingGenerator(
  implementation: DocumentEmbeddingGenerator["embed"] = ({ texts }) =>
    Promise.resolve({
      model: DOCUMENT_EMBEDDING_MODEL,
      dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      embeddings: texts.map(() => vector(1, 0)),
    }),
): DocumentEmbeddingGenerator & { embed: ReturnType<typeof vi.fn> } {
  return { embed: vi.fn(implementation) };
}

function answerGenerator(
  implementation: GroundedAnswerGenerator["generate"] = () =>
    Promise.resolve({
      status: "answered",
      answer: "The source supports this answer. [S1]",
      sourceIds: ["S1"],
    }),
): GroundedAnswerGenerator & { generate: ReturnType<typeof vi.fn> } {
  return { model: "fake-answer-model", generate: vi.fn(implementation) };
}

function harness(
  embeddings: DocumentEmbeddingGenerator = embeddingGenerator(),
  answers?: GroundedAnswerGenerator,
) {
  return createTestApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    embeddings,
    answers,
  );
}

async function register(agent: ReturnType<typeof request.agent>, email: string) {
  const response = await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ email, displayName: "Knowledge Asker", password: "correct-horse-battery" })
    .expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function createSpace(agent: ReturnType<typeof request.agent>) {
  const response = await agent
    .post("/api/v1/spaces")
    .set("Origin", origin)
    .send({ name: "Grounded Answer Space" })
    .expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

function documentRecord(
  id: string,
  spaceId: string,
  uploadedByUserId: string,
  originalFilename: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    spaceId,
    uploadedByUserId,
    originalFilename,
    mediaType: "text",
    sizeBytes: 100,
    sourceSha256: id.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    storageKey: `spaces/${spaceId}/${id}/source`,
    status: "ready",
    stage: null,
    attemptCount: 1,
    lastAttemptAt: NOW,
    errorCode: null,
    failedAt: null,
    pageCount: null,
    characterCount: 100,
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

function addSource(
  test: ReturnType<typeof harness>,
  input: {
    id: string;
    spaceId: string;
    userId: string;
    filename: string;
    content: string;
    embedding: number[];
    ordinal?: number;
    pageNumber?: number | null;
    startOffset?: number;
    documentOverrides?: Partial<DocumentRecord>;
  },
) {
  const ordinal = input.ordinal ?? 0;
  const startOffset = input.startOffset ?? 0;
  test.documentRepository.documents.set(
    input.id,
    documentRecord(
      input.id,
      input.spaceId,
      input.userId,
      input.filename,
      input.documentOverrides,
    ),
  );
  test.documentRepository.documentChunks.set(input.id, [
    {
      ordinal,
      content: input.content,
      contentHash: contentHash(input.content),
      pageNumber: input.pageNumber ?? null,
      startOffset,
      endOffset: startOffset + input.content.length,
      embedding: input.embedding,
    },
  ]);
}

async function setupWithSource(
  generated?: GroundedAnswerGenerator,
  embeddings: DocumentEmbeddingGenerator = embeddingGenerator(),
) {
  const test = harness(embeddings, generated);
  const agent = request.agent(test.app);
  const user = await register(agent, `ask-${crypto.randomUUID()}@example.com`);
  const space = await createSpace(agent);
  addSource(test, {
    id: "40000000-0000-4000-8000-000000000001",
    spaceId: space.id,
    userId: user.id,
    filename: "trusted-source.txt",
    content: "The project uses server-authoritative citations.",
    embedding: vector(1, 0),
    pageNumber: 3,
    startOffset: 10,
  });
  return { ...test, agent, user, space };
}

function parseAnswer(body: unknown): GroundedAnswerResponse {
  return groundedAnswerResponseSchema.parse(body);
}

describe("grounded answer API", () => {
  it("registers only the official authenticated route and rejects outsiders before providers", async () => {
    const embeddings = embeddingGenerator();
    const answers = answerGenerator();
    const test = harness(embeddings, answers);
    const ownerAgent = request.agent(test.app);
    const outsiderAgent = request.agent(test.app);
    await register(ownerAgent, "ask-owner@example.com");
    await register(outsiderAgent, "ask-outsider@example.com");
    const space = await createSpace(ownerAgent);

    await request(test.app)
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "What is supported?" })
      .expect(401);
    const outsider = await outsiderAgent
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "What is supported?" })
      .expect(404);
    expect(errorEnvelopeSchema.parse(outsider.body).error.code).toBe("space_not_found");
    expect(embeddings.embed.mock.calls).toHaveLength(0);
    expect(answers.generate.mock.calls).toHaveLength(0);

    await ownerAgent
      .post(`/api/v1/spaces/${space.id}/knowledge/answer`)
      .set("Origin", origin)
      .send({ query: "No alias" })
      .expect(404);
  });

  it("strictly validates and trims the query without accepting generation controls", async () => {
    const embeddings = embeddingGenerator();
    const answers = answerGenerator();
    const { agent, space } = await setupWithSource(answers, embeddings);

    for (const body of [
      { query: " " },
      { query: " x " },
      { query: "x".repeat(2001) },
      { query: "valid query", limit: 1 },
      { query: "valid query", model: "client-model" },
      { query: "valid query", sourceIds: ["S1"] },
    ]) {
      await agent
        .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
        .set("Origin", origin)
        .send(body)
        .expect(400);
    }

    await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "  What does the source support?  " })
      .expect(200);
    expect(embeddings.embed.mock.calls.at(-1)?.[0]).toEqual({
      texts: ["What does the source support?"],
    });
    const lastGenerationInput = answers.generate.mock.calls.at(-1)?.[0] as
      | GroundedAnswerGenerationInput
      | undefined;
    expect(lastGenerationInput?.question).toBe("What does the source support?");
  });

  it("passes through Phase 7A no-index and whole-Space incompatibility errors", async () => {
    const noIndex = harness(embeddingGenerator(), answerGenerator());
    const noIndexAgent = request.agent(noIndex.app);
    await register(noIndexAgent, "ask-no-index@example.com");
    const noIndexSpace = await createSpace(noIndexAgent);
    const missing = await noIndexAgent
      .post(`/api/v1/spaces/${noIndexSpace.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "No active index" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(missing.body).error.code).toBe("knowledge_not_indexed");

    const incompatible = await setupWithSource(answerGenerator());
    addSource(incompatible, {
      id: "40000000-0000-4000-8000-000000000002",
      spaceId: incompatible.space.id,
      userId: incompatible.user.id,
      filename: "other-space.txt",
      content: "Incompatible embedding space.",
      embedding: vector(1, 0),
      documentOverrides: { embeddingModel: "other-model" },
    });
    const mixed = await incompatible.agent
      .post(`/api/v1/spaces/${incompatible.space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Mixed index" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(mixed.body).error.code).toBe(
      "knowledge_embedding_incompatible",
    );
  });

  it("short-circuits empty retrieval to canonical insufficient context without a generator", async () => {
    const answers = answerGenerator();
    const test = harness(embeddingGenerator(), answers);
    const agent = request.agent(test.app);
    const user = await register(agent, "ask-empty@example.com");
    const space = await createSpace(agent);
    const id = "40000000-0000-4000-8000-000000000003";
    test.documentRepository.documents.set(
      id,
      documentRecord(id, space.id, user.id, "empty-active.txt"),
    );

    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "No matching chunks" })
      .expect(200);
    expect(parseAnswer(response.body)).toEqual({
      status: "insufficient_context",
      answer: insufficientMessage,
      citations: [],
    });
    expect(answers.generate.mock.calls).toHaveLength(0);
  });

  it("requires configured generation only when retrieval is non-empty", async () => {
    const { agent, space } = await setupWithSource(undefined);
    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Needs generation" })
      .expect(503);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(
      "answer_generation_unavailable",
    );
  });

  it("uses a fixed internal retrieval limit of eight complete sources", async () => {
    const answers = answerGenerator();
    const test = harness(embeddingGenerator(), answers);
    const agent = request.agent(test.app);
    const user = await register(agent, "ask-fixed-limit@example.com");
    const space = await createSpace(agent);
    for (let index = 1; index <= 9; index += 1) {
      const id = `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      addSource(test, {
        id,
        spaceId: space.id,
        userId: user.id,
        filename: `source-${index}.txt`,
        content: `Complete source content ${index}.`,
        embedding: vector(1, index / 100),
      });
    }

    await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Use the fixed context policy" })
      .expect(200);
    const generationInput = answers.generate.mock.calls[0]?.[0] as
      | GroundedAnswerGenerationInput
      | undefined;
    expect(generationInput?.sources).toHaveLength(8);
    expect(generationInput?.sources.map((source) => source.sourceId)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
      "S7",
      "S8",
    ]);
    expect(generationInput?.sources.every((source) => source.content.length > 0)).toBe(true);
  });

  it("assigns S1..Sn in retrieval order and derives citations only from trusted metadata", async () => {
    const answers = answerGenerator(() =>
      Promise.resolve({
        status: "answered",
        answer: "The second source adds detail. [S2] The first establishes the rule. [S1] [S2]",
        sourceIds: ["S2", "S1"],
      }),
    );
    const test = harness(embeddingGenerator(), answers);
    const agent = request.agent(test.app);
    const user = await register(agent, "ask-citations@example.com");
    const space = await createSpace(agent);
    addSource(test, {
      id: "40000000-0000-4000-8000-000000000010",
      spaceId: space.id,
      userId: user.id,
      filename: "first.pdf",
      content: "First ranked evidence.",
      embedding: vector(1, 0),
      ordinal: 4,
      pageNumber: 2,
      startOffset: 100,
    });
    addSource(test, {
      id: "40000000-0000-4000-8000-000000000011",
      spaceId: space.id,
      userId: user.id,
      filename: "second.txt",
      content: "Second ranked evidence.",
      embedding: vector(0, 1),
      ordinal: 7,
      startOffset: 20,
    });

    const response = parseAnswer(
      (
        await agent
          .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
          .set("Origin", origin)
          .send({ query: "Combine the evidence" })
          .expect(200)
      ).body,
    );
    const generationInput = answers.generate.mock.calls[0]?.[0] as
      | GroundedAnswerGenerationInput
      | undefined;
    expect(generationInput?.sources.map(({ sourceId, originalFilename }) => ({
      sourceId,
      originalFilename,
    }))).toEqual([
      { sourceId: "S1", originalFilename: "first.pdf" },
      { sourceId: "S2", originalFilename: "second.txt" },
    ]);
    expect(response.status).toBe("answered");
    if (response.status !== "answered") throw new Error("Expected an answered response.");
    expect(response.citations.map((citation) => citation.sourceId)).toEqual(["S2", "S1"]);
    expect(response.citations[0]).toEqual({
      sourceId: "S2",
      documentId: "40000000-0000-4000-8000-000000000011",
      originalFilename: "second.txt",
      ordinal: 7,
      contentHash: contentHash("Second ranked evidence."),
      pageNumber: null,
      startOffset: 20,
      endOffset: 43,
    });
    expect(JSON.stringify(response)).not.toContain("cosineDistance");
    expect(JSON.stringify(response)).not.toContain("First ranked evidence.");
  });

  it.each([
    [
      "unknown source marker",
      { status: "answered", answer: "Unsupported. [S99]", sourceIds: ["S99"] },
    ],
    [
      "marker/list mismatch",
      { status: "answered", answer: "Supported. [S1]", sourceIds: ["S1", "S2"] },
    ],
    ["answered without sources", { status: "answered", answer: "No citation.", sourceIds: [] }],
    [
      "insufficient with sources",
      { status: "insufficient_context", answer: "Not enough.", sourceIds: ["S1"] },
    ],
    [
      "insufficient with an inline marker",
      { status: "insufficient_context", answer: "Not enough. [S1]", sourceIds: [] },
    ],
    [
      "invented provenance metadata",
      {
        status: "answered",
        answer: "Supported. [S1]",
        sourceIds: ["S1"],
        documentId: "40000000-0000-4000-8000-000000000099",
        originalFilename: "invented.txt",
      },
    ],
  ])("rejects %s without repair", async (_label, generated) => {
    const answers = answerGenerator(() => Promise.resolve(generated as never));
    const { agent, space } = await setupWithSource(answers);
    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Validate citations" })
      .expect(502);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("answer_invalid_response");
  });

  it("uses the canonical insufficient response for a valid generator abstention", async () => {
    const answers = answerGenerator(() =>
      Promise.resolve({
        status: "insufficient_context",
        answer: "Model-specific wording that must not escape.",
        sourceIds: [],
      }),
    );
    const { agent, space } = await setupWithSource(answers);
    const response = parseAnswer(
      (
        await agent
          .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
          .set("Origin", origin)
          .send({ query: "Can this be answered?" })
          .expect(200)
      ).body,
    );
    expect(response).toEqual({
      status: "insufficient_context",
      answer: insufficientMessage,
      citations: [],
    });
  });

  it("discards a generated answer when membership is revoked during generation", async () => {
    let release: (() => void) | undefined;
    let reached: (() => void) | undefined;
    const reachedPromise = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answers = answerGenerator(async () => {
      reached?.();
      await releasePromise;
      return {
        status: "answered",
        answer: "This must be discarded. [S1]",
        sourceIds: ["S1"],
      };
    });
    const test = await setupWithSource(answers);
    const pending = test.agent
      .post(`/api/v1/spaces/${test.space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Race membership revocation" })
      .then((response) => response);

    await reachedPromise;
    test.spaceRepository.memberships.delete(`${test.space.id}:${test.user.id}`);
    release?.();
    const response = await pending;
    expect(response.status).toBe(404);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("space_not_found");
    expect(JSON.stringify(response.body)).not.toContain("This must be discarded");
  });

  it("inherits Phase 7A membership revocation during embedding", async () => {
    let revoke: () => void = () => undefined;
    const embeddings = embeddingGenerator(() => {
      revoke();
      return Promise.resolve({
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddings: [vector(1, 0)],
      });
    });
    const answers = answerGenerator();
    const test = await setupWithSource(answers, embeddings);
    revoke = () => test.spaceRepository.memberships.delete(`${test.space.id}:${test.user.id}`);
    const response = await test.agent
      .post(`/api/v1/spaces/${test.space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Revoke during embedding" })
      .expect(404);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("space_not_found");
    expect(answers.generate.mock.calls).toHaveLength(0);
  });

  it.each([
    ["ANSWER_UPSTREAM_TIMEOUT", 504, "answer_upstream_timeout"],
    ["ANSWER_UPSTREAM_FAILURE", 502, "answer_upstream_failure"],
    ["ANSWER_UPSTREAM_REJECTED", 502, "answer_upstream_failure"],
    ["ANSWER_INVALID_RESPONSE", 502, "answer_invalid_response"],
    ["ANSWER_RESPONSE_TOO_LARGE", 502, "answer_invalid_response"],
  ] as const)("maps %s without exposing provider details", async (code, status, apiCode) => {
    const answers = answerGenerator(() =>
      Promise.reject(new GroundedAnswerGeneratorError(code, "private provider detail")),
    );
    const { agent, space } = await setupWithSource(answers);
    const response = await agent
      .post(`/api/v1/spaces/${space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Provider mapping" })
      .expect(status);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(apiCode);
    expect(JSON.stringify(response.body)).not.toContain("private provider detail");
  });

  it("does not mutate document, chunk, or summary persistence", async () => {
    const answers = answerGenerator();
    const test = await setupWithSource(answers);
    const documentsBefore = structuredClone([...test.documentRepository.documents.entries()]);
    const chunksBefore = structuredClone([...test.documentRepository.documentChunks.entries()]);
    const summariesBefore = structuredClone([...test.summaryRepository.summaries.entries()]);

    await test.agent
      .post(`/api/v1/spaces/${test.space.id}/knowledge/ask`)
      .set("Origin", origin)
      .send({ query: "Read only answer" })
      .expect(200);

    expect([...test.documentRepository.documents.entries()]).toEqual(documentsBefore);
    expect([...test.documentRepository.documentChunks.entries()]).toEqual(chunksBefore);
    expect([...test.summaryRepository.summaries.entries()]).toEqual(summariesBefore);
  });
});
