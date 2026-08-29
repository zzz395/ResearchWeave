import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import pino from "pino";
import postgres from "postgres";

import { createDatabase } from "../server/db/client";
import {
  documentChunks,
  documents,
  researchSpaces,
  spaceMembers,
  users,
  type DocumentRecord,
} from "../server/db/schema";
import { createDocumentTextExtractor } from "../server/integrations/document-extraction/document-text-extractor";
import { LocalFilesystemDocumentStorage } from "../server/integrations/document-storage/local-filesystem-storage";
import { createDocumentChunker } from "../server/modules/documents/document-chunker";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  type DocumentEmbeddingGenerator,
} from "../server/modules/documents/document-embedding-generator";
import { createDocumentIndexFingerprint } from "../server/modules/documents/document-index-fingerprint";
import { DocumentIndexingWorker } from "../server/modules/documents/document-indexing-worker";
import { createDrizzleDocumentRepository } from "../server/modules/documents/repository";

const smokeDatabaseUrl = process.env.PHASE6_SMOKE_DATABASE_URL;
if (!smokeDatabaseUrl) {
  throw new Error("PHASE6_SMOKE_DATABASE_URL is required; DATABASE_URL is never used by this smoke.");
}

const parsedDatabaseUrl = new URL(smokeDatabaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error("PHASE6_SMOKE_DATABASE_URL must use the postgres or postgresql protocol.");
}
const smokeDatabaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//u, ""));
if (!/phase6[_-]?smoke/iu.test(smokeDatabaseName)) {
  throw new Error("The disposable database name must contain 'phase6_smoke'.");
}

const raw = postgres(smokeDatabaseUrl, { connect_timeout: 5, idle_timeout: 10, max: 2 });
const database = createDatabase(smokeDatabaseUrl);
const repository = createDrizzleDocumentRepository(database);
const logger = pino({ level: "silent" });
let storageRoot: string | null = null;

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const SPACE_ID = "20000000-0000-4000-8000-000000000001";
const BASE_TIME = new Date("2026-08-29T00:00:00.000Z");

function pass(label: string): void {
  process.stdout.write(`[PASS] ${label}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function vector(seed: number): number[] {
  return Array.from(
    { length: DOCUMENT_EMBEDDING_DIMENSIONS },
    (_value, index) => ((seed + 1) * (index + 1) % 997) / 997,
  );
}

const deterministicEmbeddings: DocumentEmbeddingGenerator = {
  embed({ texts }) {
    return Promise.resolve({
      model: DOCUMENT_EMBEDDING_MODEL,
      dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      embeddings: texts.map((_text, index) => vector(index + 1)),
    });
  },
};

function documentFixture(
  id: string,
  source: string | Uint8Array,
  overrides: Partial<typeof documents.$inferInsert> = {},
): typeof documents.$inferInsert {
  return {
    id,
    spaceId: SPACE_ID,
    uploadedByUserId: OWNER_ID,
    originalFilename: `${id.slice(-4)}.txt`,
    mediaType: "text",
    sizeBytes: Math.max(1, Buffer.byteLength(source)),
    sourceSha256: sha256(source),
    storageKey: `spaces/${SPACE_ID}/${id}/source`,
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
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

async function readDocument(id: string): Promise<DocumentRecord> {
  const [record] = await database.db.select().from(documents).where(eq(documents.id, id)).limit(1);
  assert(record, `Document ${id} was not found.`);
  return record;
}

async function writeDurableSource(storageKey: string, bytes: Uint8Array): Promise<void> {
  assert(storageRoot);
  const target = path.join(storageRoot, ...storageKey.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
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

async function runMigrationsAndSchemaSmoke(): Promise<void> {
  await migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  const [migrationCount] = await raw<[{ count: number }]>`
    select count(*)::int as count from drizzle.__drizzle_migrations
  `;
  assert.equal(migrationCount.count, 6);
  pass("migrations");

  const [schemaState] = await raw<[{
    documents_table: string | null;
    chunks_table: string | null;
    vector_extension: string | null;
  }]>`
    select
      to_regclass('public.documents')::text as documents_table,
      to_regclass('public.document_chunks')::text as chunks_table,
      (select extname from pg_extension where extname = 'vector') as vector_extension
  `;
  assert.equal(schemaState.documents_table, "documents");
  assert.equal(schemaState.chunks_table, "document_chunks");
  assert.equal(schemaState.vector_extension, "vector");

  const [embeddingColumn] = await raw<[{ formatted_type: string; not_null: boolean }]>`
    select format_type(attribute.atttypid, attribute.atttypmod) as formatted_type,
           attribute.attnotnull as not_null
    from pg_attribute attribute
    where attribute.attrelid = 'public.document_chunks'::regclass
      and attribute.attname = 'embedding'
      and not attribute.attisdropped
  `;
  assert.equal(embeddingColumn.formatted_type, "vector(1536)");
  assert.equal(embeddingColumn.not_null, true);

  const enumRows = await raw<{ enum_name: string; enum_value: string; sort_order: number }[]>`
    select type.typname as enum_name, enum.enumlabel as enum_value,
           enum.enumsortorder::float as sort_order
    from pg_type type
    join pg_enum enum on enum.enumtypid = type.oid
    where type.typname in ('document_media_type', 'document_status', 'document_stage')
    order by type.typname, enum.enumsortorder
  `;
  const enumValues = (name: string) => enumRows
    .filter((row) => row.enum_name === name)
    .map((row) => row.enum_value);
  assert.deepEqual(enumValues("document_media_type"), ["pdf", "text", "markdown"]);
  assert.deepEqual(enumValues("document_status"), ["queued", "processing", "ready", "failed"]);
  assert.deepEqual(enumValues("document_stage"), ["extracting", "chunking", "embedding"]);

  const constraints = await raw<{ name: string }[]>`
    select conname as name
    from pg_constraint
    where conrelid in ('public.documents'::regclass, 'public.document_chunks'::regclass)
  `;
  const constraintNames = new Set(constraints.map((row) => row.name));
  for (const name of [
    "documents_space_id_research_spaces_id_fk",
    "documents_uploaded_by_user_id_users_id_fk",
    "documents_size_bytes_positive",
    "documents_attempt_count_nonnegative",
    "documents_chunk_count_nonnegative",
    "documents_source_sha256_format",
    "documents_index_fingerprint_format",
    "document_chunks_document_id_documents_id_fk",
    "document_chunks_ordinal_nonnegative",
    "document_chunks_end_offset_order",
    "document_chunks_content_hash_format",
  ]) assert(constraintNames.has(name), `Missing constraint ${name}.`);

  const [indexes] = await raw<[{
    documents_unique: string | null;
    chunks_unique: string | null;
  }]>`
    select
      to_regclass('public.documents_space_source_sha256_unique')::text as documents_unique,
      to_regclass('public.document_chunks_document_ordinal_unique')::text as chunks_unique
  `;
  assert.equal(indexes.documents_unique, "documents_space_source_sha256_unique");
  assert.equal(indexes.chunks_unique, "document_chunks_document_ordinal_unique");
  pass("schema and pgvector");
}

async function seedAuthorization(): Promise<void> {
  await database.db.insert(users).values({
    id: OWNER_ID,
    email: "phase6-smoke@example.com",
    displayName: "Phase Six Smoke",
    passwordHash: "x".repeat(60),
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  await database.db.insert(researchSpaces).values({
    id: SPACE_ID,
    name: "Phase 6 Smoke Space",
    description: "Disposable runtime validation",
    ownerId: OWNER_ID,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  await database.db.insert(spaceMembers).values({
    spaceId: SPACE_ID,
    userId: OWNER_ID,
    role: "owner",
    joinedAt: BASE_TIME,
  });
}

async function runVectorDimensionSmoke(): Promise<void> {
  const documentId = "30000000-0000-4000-8000-000000000001";
  await database.db.insert(documents).values(documentFixture(documentId, "dimension source"));
  await database.db.insert(documentChunks).values({
    id: randomUUID(),
    documentId,
    ordinal: 0,
    content: "valid dimension",
    contentHash: sha256("valid dimension"),
    pageNumber: null,
    startOffset: 0,
    endOffset: 15,
    embedding: vector(0),
  });
  const [dimensions] = await raw<[{ dimensions: number }]>`
    select vector_dims(embedding)::int as dimensions
    from document_chunks where document_id = ${documentId}::uuid
  `;
  assert.equal(dimensions.dimensions, DOCUMENT_EMBEDDING_DIMENSIONS);
  pass("1536 vector insert");

  let rejected = false;
  try {
    await database.db.insert(documentChunks).values({
      id: randomUUID(),
      documentId,
      ordinal: 1,
      content: "wrong dimension",
      contentHash: sha256("wrong dimension"),
      pageNumber: null,
      startOffset: 0,
      endOffset: 15,
      embedding: [0.1, 0.2, 0.3],
    });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, "PostgreSQL accepted a wrong-dimension vector.");
  pass("wrong-dimension rejection");
  await database.db.delete(documents).where(eq(documents.id, documentId));
}

async function runClaimSmoke(): Promise<void> {
  const firstId = "30000000-0000-4000-8000-000000000011";
  const secondId = "30000000-0000-4000-8000-000000000012";
  const failureTime = new Date("2026-08-28T00:00:00.000Z");
  await database.db.insert(documents).values([
    documentFixture(firstId, "ordered first", {
      updatedAt: new Date("2026-08-28T00:00:00.000Z"),
      errorCode: "old_failure",
      failedAt: failureTime,
    }),
    documentFixture(secondId, "ordered second", {
      updatedAt: new Date("2026-08-28T00:01:00.000Z"),
    }),
  ]);

  const claimTime = new Date("2026-08-29T01:00:00.000Z");
  const firstClaim = await repository.claimNextQueuedDocument(claimTime);
  assert.equal(firstClaim?.documentId, firstId);
  const claimed = await readDocument(firstId);
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.stage, "extracting");
  assert.equal(claimed.attemptCount, 1);
  assert.deepEqual(claimed.lastAttemptAt, claimTime);
  assert.equal(claimed.errorCode, null);
  assert.equal(claimed.failedAt, null);
  assert.equal((await repository.claimNextQueuedDocument(claimTime))?.documentId, secondId);
  pass("ordered claim");

  const concurrentA = "30000000-0000-4000-8000-000000000021";
  const concurrentB = "30000000-0000-4000-8000-000000000022";
  await database.db.insert(documents).values([
    documentFixture(concurrentA, "concurrent a", { updatedAt: new Date("2026-08-28T02:00:00.000Z") }),
    documentFixture(concurrentB, "concurrent b", { updatedAt: new Date("2026-08-28T02:00:00.000Z") }),
  ]);
  const [claimA, claimB] = await Promise.all([
    repository.claimNextQueuedDocument(claimTime),
    repository.claimNextQueuedDocument(claimTime),
  ]);
  assert(claimA && claimB);
  assert.notEqual(claimA.documentId, claimB.documentId);
  assert.deepEqual(new Set([claimA.documentId, claimB.documentId]), new Set([concurrentA, concurrentB]));
  pass("concurrent claim");
}

async function runFullWorkerSmoke(): Promise<{ documentId: string; source: Uint8Array }> {
  assert(storageRoot);
  const documentId = "30000000-0000-4000-8000-000000000031";
  const source = new TextEncoder().encode(
    "ResearchWeave persists this deterministic source before building its durable index.",
  );
  const fixture = documentFixture(documentId, source, {
    originalFilename: "worker-smoke.txt",
    sizeBytes: source.byteLength,
  });
  await database.db.insert(documents).values(fixture);
  await writeDurableSource(fixture.storageKey, source);

  const workerTime = new Date("2026-08-29T02:00:00.000Z");
  const worker = new DocumentIndexingWorker({
    repository,
    storage: new LocalFilesystemDocumentStorage(storageRoot),
    extractor: createDocumentTextExtractor(),
    chunker: createDocumentChunker(),
    embeddingGenerator: deterministicEmbeddings,
    logger,
    now: () => new Date(workerTime),
  });
  assert.equal(await worker.processNext(), true);

  const ready = await readDocument(documentId);
  assert.equal(ready.status, "ready");
  assert.equal(ready.stage, null);
  assert.equal(ready.attemptCount, 1);
  assert.equal(ready.errorCode, null);
  assert.equal(ready.failedAt, null);
  assert(ready.chunkCount > 0);
  assert.equal(ready.characterCount, source.byteLength);
  assert.equal(ready.embeddingDimensions, DOCUMENT_EMBEDDING_DIMENSIONS);
  assert.equal(ready.embeddingModel, DOCUMENT_EMBEDDING_MODEL);
  assert.match(ready.indexFingerprint ?? "", /^[0-9a-f]{64}$/u);
  assert.deepEqual(ready.indexedAt, workerTime);
  const persisted = await raw<{ ordinal: number; dimensions: number }[]>`
    select ordinal, vector_dims(embedding)::int as dimensions
    from document_chunks where document_id = ${documentId}::uuid order by ordinal
  `;
  assert.equal(persisted.length, ready.chunkCount);
  assert(persisted.every((chunk) => chunk.dimensions === DOCUMENT_EMBEDDING_DIMENSIONS));
  pass("full worker");
  return { documentId, source };
}

async function runAtomicRollbackSmoke(): Promise<void> {
  const documentId = "30000000-0000-4000-8000-000000000041";
  const oldIndexedAt = new Date("2026-08-27T00:00:00.000Z");
  const oldFingerprint = "a".repeat(64);
  await database.db.insert(documents).values(documentFixture(documentId, "atomic source", {
    status: "processing",
    stage: "embedding",
    attemptCount: 7,
    lastAttemptAt: new Date("2026-08-29T02:30:00.000Z"),
    pageCount: null,
    characterCount: 18,
    chunkCount: 1,
    extractorVersion: "old-extractor-v1",
    chunkerVersion: "old-chunker-v1",
    embeddingModel: DOCUMENT_EMBEDDING_MODEL,
    embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
    indexFingerprint: oldFingerprint,
    indexedAt: oldIndexedAt,
  }));
  const oldContent = "OLD active knowledge";
  await database.db.insert(documentChunks).values({
    id: randomUUID(),
    documentId,
    ordinal: 0,
    content: oldContent,
    contentHash: sha256(oldContent),
    pageNumber: null,
    startOffset: 0,
    endOffset: oldContent.length,
    embedding: vector(5),
  });
  const before = await readDocument(documentId);
  const beforeChunks = await database.db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));

  let failedAtReplacementInsert = false;
  try {
    await repository.activateDocumentIndex({
      documentId,
      attemptNumber: 7,
      pageCount: null,
      characterCount: 16,
      extractorVersion: "new-extractor-v1",
      chunkerVersion: "new-chunker-v1",
      embeddingModel: DOCUMENT_EMBEDDING_MODEL,
      embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      indexFingerprint: "b".repeat(64),
      chunks: [{
        ordinal: 0,
        content: "replacement text",
        contentHash: sha256("replacement text"),
        pageNumber: null,
        startOffset: 0,
        endOffset: 16,
        embedding: [0.1, 0.2, 0.3],
      }],
    }, new Date("2026-08-29T03:00:00.000Z"));
  } catch {
    failedAtReplacementInsert = true;
  }
  assert.equal(failedAtReplacementInsert, true);

  const after = await readDocument(documentId);
  const afterChunks = await database.db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));
  assert.deepEqual(afterChunks, beforeChunks);
  for (const field of [
    "status",
    "stage",
    "attemptCount",
    "pageCount",
    "characterCount",
    "chunkCount",
    "extractorVersion",
    "chunkerVersion",
    "embeddingModel",
    "embeddingDimensions",
    "indexFingerprint",
    "indexedAt",
    "updatedAt",
  ] as const) assert.deepEqual(after[field], before[field], `Atomic rollback changed ${field}.`);
  pass("atomic rollback (delete old chunks -> replacement dimension failure -> rollback -> old index intact)");
}

async function runReindexSmoke(workerFixture: { documentId: string; source: Uint8Array }): Promise<void> {
  assert(storageRoot);
  const oldIndexedAt = new Date("2026-08-28T04:00:00.000Z");
  const oldFingerprint = "c".repeat(64);
  const oldContent = "OLD reindex knowledge";
  await database.db.delete(documentChunks).where(eq(documentChunks.documentId, workerFixture.documentId));
  await database.db.insert(documentChunks).values({
    id: randomUUID(),
    documentId: workerFixture.documentId,
    ordinal: 0,
    content: oldContent,
    contentHash: sha256(oldContent),
    pageNumber: null,
    startOffset: 0,
    endOffset: oldContent.length,
    embedding: vector(7),
  });
  await database.db.update(documents).set({
    status: "ready",
    stage: null,
    chunkCount: 1,
    indexFingerprint: oldFingerprint,
    indexedAt: oldIndexedAt,
    errorCode: "old_failure",
    failedAt: new Date("2026-08-28T03:00:00.000Z"),
  }).where(eq(documents.id, workerFixture.documentId));
  const beforeQueue = await readDocument(workerFixture.documentId);
  const beforeChunks = await database.db.select().from(documentChunks)
    .where(eq(documentChunks.documentId, workerFixture.documentId));

  const queued = await repository.queueReindexForMember(SPACE_ID, workerFixture.documentId, OWNER_ID);
  assert.equal(queued.status, "accepted");
  if (queued.status !== "accepted") throw new Error("Reindex authorization was unexpectedly rejected.");
  assert.equal(queued.record.status, "queued");
  assert.equal(queued.record.attemptCount, beforeQueue.attemptCount);
  assert.deepEqual(queued.record.indexedAt, oldIndexedAt);
  assert.equal(queued.record.indexFingerprint, oldFingerprint);
  assert.equal(queued.record.errorCode, null);
  assert.equal(queued.record.failedAt, null);
  assert.deepEqual(
    await database.db.select().from(documentChunks).where(eq(documentChunks.documentId, workerFixture.documentId)),
    beforeChunks,
  );

  const extractor = createDocumentTextExtractor();
  const chunker = createDocumentChunker();
  const extracted = await extractor.extract({ mediaType: "text", bytes: workerFixture.source });
  const chunked = chunker.chunk(extracted);
  const expectedFingerprint = createDocumentIndexFingerprint({
    sourceSha256: sha256(workerFixture.source),
    mediaType: "text",
    extractorVersion: extracted.extractorVersion,
    chunkerVersion: chunked.chunkerVersion,
    embeddingModel: DOCUMENT_EMBEDDING_MODEL,
    embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
    chunks: chunked.chunks,
  });
  const rebuildTime = new Date("2026-08-29T04:00:00.000Z");
  const worker = new DocumentIndexingWorker({
    repository,
    storage: new LocalFilesystemDocumentStorage(storageRoot),
    extractor,
    chunker,
    embeddingGenerator: deterministicEmbeddings,
    logger,
    now: () => new Date(rebuildTime),
  });
  assert.equal(await worker.processNext(), true);
  const rebuilt = await readDocument(workerFixture.documentId);
  assert.equal(rebuilt.status, "ready");
  assert.equal(rebuilt.stage, null);
  assert.equal(rebuilt.attemptCount, beforeQueue.attemptCount + 1);
  assert.deepEqual(rebuilt.indexedAt, rebuildTime);
  assert.equal(rebuilt.indexFingerprint, expectedFingerprint);
  const rebuiltChunks = await database.db.select().from(documentChunks)
    .where(eq(documentChunks.documentId, workerFixture.documentId));
  assert.equal(rebuiltChunks.length, chunked.chunks.length);
  assert.equal(rebuiltChunks.some((chunk) => chunk.content === oldContent), false);
  pass("reindex");
}

async function runRecoverySmoke(): Promise<void> {
  const documentId = "30000000-0000-4000-8000-000000000051";
  const indexedAt = new Date("2026-08-26T00:00:00.000Z");
  const lastAttemptAt = new Date("2026-08-29T04:30:00.000Z");
  const fingerprint = "d".repeat(64);
  const activeContent = "recovery active knowledge";
  await database.db.insert(documents).values(documentFixture(documentId, "recovery source", {
    status: "processing",
    stage: "embedding",
    attemptCount: 9,
    lastAttemptAt,
    pageCount: null,
    characterCount: 25,
    chunkCount: 1,
    extractorVersion: "utf8-source-v1",
    chunkerVersion: "deterministic-char-v1",
    embeddingModel: DOCUMENT_EMBEDDING_MODEL,
    embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
    indexFingerprint: fingerprint,
    indexedAt,
  }));
  await database.db.insert(documentChunks).values({
    id: randomUUID(),
    documentId,
    ordinal: 0,
    content: activeContent,
    contentHash: sha256(activeContent),
    pageNumber: null,
    startOffset: 0,
    endOffset: activeContent.length,
    embedding: vector(9),
  });
  const before = await readDocument(documentId);
  const beforeChunks = await database.db.select().from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));
  const [{ count: processingBefore }] = await raw<[{ count: number }]>`
    select count(*)::int as count from documents where status = 'processing'
  `;
  const recovered = await repository.recoverProcessingDocuments(new Date("2026-08-29T05:00:00.000Z"));
  assert.equal(recovered, processingBefore);
  const after = await readDocument(documentId);
  assert.equal(after.status, "queued");
  assert.equal(after.stage, null);
  for (const field of [
    "attemptCount",
    "lastAttemptAt",
    "pageCount",
    "characterCount",
    "chunkCount",
    "extractorVersion",
    "chunkerVersion",
    "embeddingModel",
    "embeddingDimensions",
    "indexFingerprint",
    "indexedAt",
  ] as const) assert.deepEqual(after[field], before[field], `Recovery changed ${field}.`);
  assert.deepEqual(
    await database.db.select().from(documentChunks).where(eq(documentChunks.documentId, documentId)),
    beforeChunks,
  );
  pass("recovery");
}

try {
  await assertFreshDisposableTarget();
  await runMigrationsAndSchemaSmoke();
  await seedAuthorization();
  await runVectorDimensionSmoke();
  await runClaimSmoke();
  storageRoot = await mkdtemp(path.join(tmpdir(), "researchweave-phase6-smoke-"));
  const workerFixture = await runFullWorkerSmoke();
  await runAtomicRollbackSmoke();
  await runReindexSmoke(workerFixture);
  await runRecoverySmoke();
} finally {
  await database.close();
  await raw.end({ timeout: 5 });
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
}
