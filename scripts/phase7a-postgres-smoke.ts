import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createDatabase } from "../server/db/client";
import {
  documentChunks,
  documents,
  researchSpaces,
  spaceMembers,
  users,
} from "../server/db/schema";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  type DocumentEmbeddingGenerator,
} from "../server/modules/documents/document-embedding-generator";
import { AppError } from "../server/middleware/app-error";
import { createDrizzleSemanticRetrievalRepository } from "../server/modules/retrieval/repository";
import { createSemanticRetrievalService } from "../server/modules/retrieval/service";

const smokeDatabaseUrl = process.env.PHASE7A_SMOKE_DATABASE_URL;
if (!smokeDatabaseUrl) {
  throw new Error(
    "PHASE7A_SMOKE_DATABASE_URL is required; DATABASE_URL is never used by this smoke.",
  );
}

const parsedDatabaseUrl = new URL(smokeDatabaseUrl);
if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
  throw new Error("PHASE7A_SMOKE_DATABASE_URL must use the postgres or postgresql protocol.");
}
const smokeDatabaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//u, ""));
if (!/phase7a[_-]?smoke/iu.test(smokeDatabaseName)) {
  throw new Error("The disposable database name must contain 'phase7a_smoke'.");
}

const raw = postgres(smokeDatabaseUrl, { connect_timeout: 5, idle_timeout: 10, max: 2 });
const database = createDatabase(smokeDatabaseUrl);
const repository = createDrizzleSemanticRetrievalRepository(database);

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000002";
const SPACE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_SPACE_ID = "20000000-0000-4000-8000-000000000002";
const NO_ACTIVE_SPACE_ID = "20000000-0000-4000-8000-000000000003";
const MIXED_MODEL_SPACE_ID = "20000000-0000-4000-8000-000000000004";
const MIXED_DIMENSIONS_SPACE_ID = "20000000-0000-4000-8000-000000000005";
const BASE_TIME = new Date("2026-08-29T00:00:00.000Z");

function pass(label: string): void {
  process.stdout.write(`[PASS] ${label}\n`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function vector(first: number, second: number): number[] {
  return [first, second, ...Array.from({ length: DOCUMENT_EMBEDDING_DIMENSIONS - 2 }, () => 0)];
}

function documentFixture(
  id: string,
  spaceId: string,
  source: string,
  overrides: Partial<typeof documents.$inferInsert> = {},
): typeof documents.$inferInsert {
  return {
    id,
    spaceId,
    uploadedByUserId: OWNER_ID,
    originalFilename: `${id.slice(-4)}.txt`,
    mediaType: "text",
    sizeBytes: Buffer.byteLength(source),
    sourceSha256: sha256(source),
    storageKey: `spaces/${spaceId}/${id}/source`,
    status: "ready",
    stage: null,
    attemptCount: 1,
    lastAttemptAt: BASE_TIME,
    errorCode: null,
    failedAt: null,
    pageCount: null,
    characterCount: source.length,
    chunkCount: 1,
    extractorVersion: "utf8-source-v1",
    chunkerVersion: "deterministic-char-v1",
    embeddingModel: DOCUMENT_EMBEDDING_MODEL,
    embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
    indexFingerprint: sha256(`index:${source}`),
    indexedAt: BASE_TIME,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

async function assertFreshDisposableTarget(): Promise<void> {
  const [server] = await raw<[{ database_name: string; server_version_num: string }]>`
    select current_database() as database_name, current_setting('server_version_num') as server_version_num
  `;
  assert.equal(server.database_name, smokeDatabaseName);
  assert.equal(Math.floor(Number(server.server_version_num) / 10_000), 17, "PostgreSQL 17 is required.");
  const existingTables = await raw<{ schemaname: string; tablename: string }[]>`
    select schemaname, tablename
    from pg_tables
    where schemaname in ('public', 'drizzle')
    order by schemaname, tablename
  `;
  assert.equal(
    existingTables.length,
    0,
    "Smoke target is not empty; refusing to modify a database with existing tables.",
  );
}

async function seed(): Promise<void> {
  await migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  await database.db.insert(users).values([
    {
      id: OWNER_ID,
      email: "phase7a-owner@example.com",
      displayName: "Phase 7A Owner",
      passwordHash: "x".repeat(60),
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: OUTSIDER_ID,
      email: "phase7a-outsider@example.com",
      displayName: "Phase 7A Outsider",
      passwordHash: "y".repeat(60),
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
  ]);
  await database.db.insert(researchSpaces).values([
    {
      id: SPACE_ID,
      name: "Phase 7A Smoke",
      description: null,
      ownerId: OWNER_ID,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: OTHER_SPACE_ID,
      name: "Other Smoke Space",
      description: null,
      ownerId: OWNER_ID,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: NO_ACTIVE_SPACE_ID,
      name: "No Active Index Smoke Space",
      description: null,
      ownerId: OWNER_ID,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: MIXED_MODEL_SPACE_ID,
      name: "Mixed Model Smoke Space",
      description: null,
      ownerId: OWNER_ID,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: MIXED_DIMENSIONS_SPACE_ID,
      name: "Mixed Dimensions Smoke Space",
      description: null,
      ownerId: OWNER_ID,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
  ]);
  await database.db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, userId: OWNER_ID, role: "owner", joinedAt: BASE_TIME },
    { spaceId: OTHER_SPACE_ID, userId: OWNER_ID, role: "owner", joinedAt: BASE_TIME },
    { spaceId: NO_ACTIVE_SPACE_ID, userId: OWNER_ID, role: "owner", joinedAt: BASE_TIME },
    { spaceId: MIXED_MODEL_SPACE_ID, userId: OWNER_ID, role: "owner", joinedAt: BASE_TIME },
    { spaceId: MIXED_DIMENSIONS_SPACE_ID, userId: OWNER_ID, role: "owner", joinedAt: BASE_TIME },
  ]);

  const fixtures = [
    {
      id: "30000000-0000-4000-8000-000000000001",
      spaceId: SPACE_ID,
      source: "first exact tie",
      overrides: { status: "failed" as const, stage: "embedding" as const },
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      spaceId: SPACE_ID,
      source: "second exact tie",
      overrides: { status: "processing" as const, stage: "embedding" as const },
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000003",
      spaceId: SPACE_ID,
      source: "orthogonal result",
      overrides: {},
      embedding: vector(0, 1),
    },
    {
      id: "30000000-0000-4000-8000-000000000004",
      spaceId: SPACE_ID,
      source: "not active",
      overrides: { indexedAt: null },
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000005",
      spaceId: MIXED_MODEL_SPACE_ID,
      source: "wrong model",
      overrides: { embeddingModel: "other-model" },
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000006",
      spaceId: MIXED_DIMENSIONS_SPACE_ID,
      source: "wrong metadata dimensions",
      overrides: { embeddingDimensions: 3072 },
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000007",
      spaceId: OTHER_SPACE_ID,
      source: "other space",
      overrides: {},
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000008",
      spaceId: MIXED_MODEL_SPACE_ID,
      source: "compatible model companion",
      overrides: {},
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000009",
      spaceId: MIXED_DIMENSIONS_SPACE_ID,
      source: "compatible dimensions companion",
      overrides: {},
      embedding: vector(1, 0),
    },
    {
      id: "30000000-0000-4000-8000-000000000010",
      spaceId: NO_ACTIVE_SPACE_ID,
      source: "inactive only",
      overrides: { indexedAt: null },
      embedding: vector(1, 0),
    },
  ];
  for (const fixture of fixtures) {
    await database.db
      .insert(documents)
      .values(documentFixture(fixture.id, fixture.spaceId, fixture.source, fixture.overrides));
    await database.db.insert(documentChunks).values({
      id: randomUUID(),
      documentId: fixture.id,
      ordinal: 0,
      content: fixture.source,
      contentHash: sha256(fixture.source),
      pageNumber: null,
      startOffset: 0,
      endOffset: fixture.source.length,
      embedding: fixture.embedding,
    });
  }
  pass("production migrations and fixtures");
}

async function runRetrieval(): Promise<void> {
  const embed: DocumentEmbeddingGenerator = {
    embed: () =>
      Promise.resolve({
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddings: [vector(1, 0)],
      }),
  };
  const service = createSemanticRetrievalService(repository, embed);
  const beforeDocuments = await database.db.select({ value: count() }).from(documents);
  const beforeChunks = await database.db.select({ value: count() }).from(documentChunks);

  const response = await service.retrieve(SPACE_ID, OWNER_ID, { query: "exact search", limit: 20 });
  assert.deepEqual(
    response.results.map((result) => result.documentId),
    [
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
    ],
  );
  assert.deepEqual(
    response.results.map((result) => result.cosineDistance),
    [0, 0, 1],
  );
  pass("exact cosine ranking, stable ties, active index, compatibility, and Space filters");

  const limited = await service.retrieve(SPACE_ID, OWNER_ID, { query: "exact search", limit: 1 });
  assert.equal(limited.results.length, 1);
  assert.equal(limited.results[0]?.documentId, "30000000-0000-4000-8000-000000000001");
  pass("limit");

  await assert.rejects(
    service.retrieve(NO_ACTIVE_SPACE_ID, OWNER_ID, { query: "nothing indexed", limit: 8 }),
    (error: unknown) => error instanceof AppError && error.code === "knowledge_not_indexed",
  );
  pass("no active index is explicit");

  await assert.rejects(
    service.retrieve(MIXED_MODEL_SPACE_ID, OWNER_ID, {
      query: "mixed model compatibility",
      limit: 8,
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === "knowledge_embedding_incompatible",
  );
  pass("mixed model compatibility is explicit");

  await assert.rejects(
    service.retrieve(MIXED_DIMENSIONS_SPACE_ID, OWNER_ID, {
      query: "mixed dimensions compatibility",
      limit: 8,
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === "knowledge_embedding_incompatible",
  );
  pass("mixed dimensions compatibility is explicit");

  await assert.rejects(
    service.retrieve(SPACE_ID, OUTSIDER_ID, { query: "not authorized", limit: 8 }),
    (error: unknown) => error instanceof AppError && error.code === "space_not_found",
  );
  pass("current membership authorization");

  const incompatibleService = createSemanticRetrievalService(repository, {
    embed: () =>
      Promise.resolve({
        model: "other-model",
        dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddings: [vector(1, 0)],
      }),
  });
  await assert.rejects(
    incompatibleService.retrieve(SPACE_ID, OWNER_ID, {
      query: "different vector space",
      limit: 8,
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === "knowledge_embedding_incompatible",
  );
  pass("query embedding model compatibility is explicit");

  const incompatibleDimensionsService = createSemanticRetrievalService(repository, {
    embed: () =>
      Promise.resolve({
        model: DOCUMENT_EMBEDDING_MODEL,
        dimensions: 3072,
        embeddings: [Array.from({ length: 3072 }, (_, index) => (index === 0 ? 1 : 0))],
      } as never),
  });
  await assert.rejects(
    incompatibleDimensionsService.retrieve(SPACE_ID, OWNER_ID, {
      query: "different query dimensions",
      limit: 8,
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === "knowledge_embedding_incompatible",
  );
  pass("query embedding dimensions are rejected before vector comparison");

  assert.deepEqual(await database.db.select({ value: count() }).from(documents), beforeDocuments);
  assert.deepEqual(await database.db.select({ value: count() }).from(documentChunks), beforeChunks);
  const [active] = await database.db
    .select({ status: documents.status, indexedAt: documents.indexedAt })
    .from(documents)
    .where(eq(documents.id, "30000000-0000-4000-8000-000000000001"));
  assert.equal(active?.status, "failed");
  assert.deepEqual(active?.indexedAt, BASE_TIME);
  pass("retrieval is read-only");
}

try {
  await assertFreshDisposableTarget();
  await seed();
  await runRetrieval();
} finally {
  await database.close();
  await raw.end({ timeout: 5 });
}
