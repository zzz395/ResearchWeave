import assert from "node:assert/strict";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ACTIVITY_PAPER_TITLE_MAX_CHARACTERS } from "../shared/contracts/activity";
import { createDatabase } from "../server/db/client";
import {
  chatMessages,
  connections,
  documents,
  papers,
  researchSpaces,
  savedPapers,
  spaceMembers,
  users,
} from "../server/db/schema";
import { AppError } from "../server/middleware/app-error";
import { createDrizzleActivityRepository } from "../server/modules/activity/repository";
import { createActivityService } from "../server/modules/activity/service";
import { createOverviewService } from "../server/modules/overview/service";

const smokeDatabaseUrl = process.env.PHASE10A_SMOKE_DATABASE_URL;
if (!smokeDatabaseUrl) {
  throw new Error("PHASE10A_SMOKE_DATABASE_URL is required; DATABASE_URL is never used by this smoke.");
}
const parsedDatabaseUrl = new URL(smokeDatabaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error("PHASE10A_SMOKE_DATABASE_URL must use the postgres or postgresql protocol.");
}
const smokeDatabaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//u, ""));
if (!/phase10a[_-]?smoke/iu.test(smokeDatabaseName)) {
  throw new Error("The disposable database name must contain 'phase10a_smoke'.");
}

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PEER_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const SPACE_ID = "20000000-0000-4000-8000-000000000001";
const OUTSIDER_SPACE_ID = "20000000-0000-4000-8000-000000000002";
const PAPER_ID = "60000000-0000-4000-8000-000000000001";
const BASE_TIME = new Date("2026-09-05T00:00:00.000Z");
const OVERSIZED_PAPER_TITLE = "T".repeat(ACTIVITY_PAPER_TITLE_MAX_CHARACTERS + 200);

function pass(label: string): void {
  process.stdout.write(`[PASS] ${label}\n`);
}

const raw = postgres(smokeDatabaseUrl, { connect_timeout: 5, idle_timeout: 10, max: 3 });
const database = createDatabase(smokeDatabaseUrl);

async function assertFreshDisposableTarget(): Promise<void> {
  const [identity] = await raw<[{ database_name: string; table_count: number }]>`
    select current_database() as database_name,
           (select count(*)::int from pg_tables
            where schemaname not in ('pg_catalog', 'information_schema')
              and not (schemaname = 'drizzle' and tablename = '__drizzle_migrations')) as table_count
  `;
  assert.equal(identity.database_name, smokeDatabaseName);
  assert.equal(identity.table_count, 0, "Phase 10A smoke requires a fresh disposable database.");
}

function documentFixture(id: string, status: "queued" | "ready", updatedAt: Date) {
  return {
    id,
    spaceId: SPACE_ID,
    uploadedByUserId: null,
    originalFilename: `${status}.txt`,
    mediaType: "text" as const,
    sizeBytes: 10,
    sourceSha256: id.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    storageKey: `private/${id}`,
    status,
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
    createdAt: updatedAt,
    updatedAt,
  } satisfies typeof documents.$inferInsert;
}

async function seed(): Promise<void> {
  await database.db.insert(users).values([
    { id: OWNER_ID, email: "phase10a-owner@example.com", displayName: "Owner", passwordHash: "x".repeat(60), createdAt: BASE_TIME, updatedAt: BASE_TIME },
    { id: PEER_ID, email: "phase10a-peer@example.com", displayName: "Peer", passwordHash: "x".repeat(60), createdAt: BASE_TIME, updatedAt: BASE_TIME },
    { id: OUTSIDER_ID, email: "phase10a-outsider@example.com", displayName: "Outsider", passwordHash: "x".repeat(60), createdAt: BASE_TIME, updatedAt: BASE_TIME },
  ]);
  await database.db.insert(researchSpaces).values([
    { id: SPACE_ID, name: "Authorized Space", description: null, ownerId: OWNER_ID, createdAt: BASE_TIME, updatedAt: BASE_TIME },
    { id: OUTSIDER_SPACE_ID, name: "Outsider Space", description: null, ownerId: OUTSIDER_ID, createdAt: BASE_TIME, updatedAt: BASE_TIME },
  ]);
  await database.db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, userId: OWNER_ID, role: "owner", joinedAt: BASE_TIME },
    { spaceId: SPACE_ID, userId: PEER_ID, role: "member", joinedAt: BASE_TIME },
    { spaceId: OUTSIDER_SPACE_ID, userId: OUTSIDER_ID, role: "owner", joinedAt: BASE_TIME },
  ]);
  await database.db.insert(connections).values({
    id: "30000000-0000-4000-8000-000000000001",
    userLowId: OWNER_ID,
    userHighId: PEER_ID,
    requestedByUserId: OWNER_ID,
    status: "accepted",
    createdAt: new Date("2026-09-05T00:01:00.000Z"),
    respondedAt: new Date("2026-09-05T00:02:00.000Z"),
  });
  const tiedAt = new Date("2026-09-05T01:00:00.000Z");
  await database.db.insert(chatMessages).values([
    { id: "40000000-0000-4000-8000-000000000001", spaceId: SPACE_ID, senderUserId: OWNER_ID, body: "private one", createdAt: tiedAt },
    { id: "40000000-0000-4000-8000-000000000002", spaceId: SPACE_ID, senderUserId: OWNER_ID, body: "private two", createdAt: tiedAt },
    { id: "40000000-0000-4000-8000-000000000003", spaceId: SPACE_ID, senderUserId: OWNER_ID, body: "private three", createdAt: tiedAt },
    { id: "40000000-0000-4000-8000-000000000004", spaceId: OUTSIDER_SPACE_ID, senderUserId: OUTSIDER_ID, body: "must not leak", createdAt: tiedAt },
  ]);
  await database.db.insert(documents).values([
    documentFixture("50000000-0000-4000-8000-000000000001", "queued", new Date("2026-09-05T02:00:00.000Z")),
    documentFixture("50000000-0000-4000-8000-000000000002", "ready", new Date("2026-09-05T02:01:00.000Z")),
  ]);
  await database.db.insert(papers).values({
    id: PAPER_ID,
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v1",
    version: 1,
    title: OVERSIZED_PAPER_TITLE,
    abstract: "This abstract must not enter the Activity projection.",
    authors: ["Researcher"],
    primaryCategory: "cs.AI",
    categories: ["cs.AI"],
    publishedAt: BASE_TIME,
    updatedAt: BASE_TIME,
    comment: null,
    journalRef: null,
    doi: null,
    absUrl: "https://arxiv.org/abs/2609.00001v1",
    pdfUrl: "https://arxiv.org/pdf/2609.00001v1",
    fetchedAt: BASE_TIME,
  });
  await database.db.insert(savedPapers).values({
    spaceId: SPACE_ID,
    paperId: PAPER_ID,
    savedByUserId: OWNER_ID,
    savedAt: new Date("2026-09-05T02:02:00.000Z"),
  });
}

try {
  await assertFreshDisposableTarget();
  await migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  const [schemaState] = await raw<[{ activity_events: string | null }]>`
    select to_regclass('public.activity_events')::text as activity_events
  `;
  assert.equal(schemaState.activity_events, null);
  pass("Existing migrations apply without an activity_events table");

  await seed();
  const repository = createDrizzleActivityRepository(database);
  const activity = createActivityService(repository);
  const overview = createOverviewService(repository);

  const first = await activity.list(OWNER_ID, {
    spaceId: SPACE_ID,
    category: "collaboration",
    limit: 2,
  });
  assert.equal(first.events.length, 2);
  assert(first.nextCursor);
  const second = await activity.list(OWNER_ID, {
    spaceId: SPACE_ID,
    category: "collaboration",
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.equal(new Set([...first.events, ...second.events].map((event) => event.id)).size, 4);
  assert(first.events.every((event) => event.space?.id === SPACE_ID));
  assert(!JSON.stringify(first).includes("private one"));
  pass("Real PostgreSQL union query, stable pagination, filtering, and safe projection");

  const researchActivity = await activity.list(OWNER_ID, {
    spaceId: SPACE_ID,
    category: "research",
    limit: 20,
  });
  assert.equal(researchActivity.events.length, 1);
  const paperSubject = researchActivity.events[0]?.subject;
  assert.equal(paperSubject?.type, "paper");
  if (paperSubject?.type !== "paper") throw new Error("Expected a Paper Activity subject.");
  assert.equal(paperSubject.title.length, ACTIVITY_PAPER_TITLE_MAX_CHARACTERS);
  const [storedPaper] = await database.db
    .select({ title: papers.title })
    .from(papers)
    .where(eq(papers.id, PAPER_ID));
  assert.equal(storedPaper?.title, OVERSIZED_PAPER_TITLE);
  pass("Oversized durable Paper titles are bounded only in the read projection");

  await assert.rejects(
    activity.list(OWNER_ID, { spaceId: OUTSIDER_SPACE_ID, limit: 20 }),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
  const global = await activity.list(OWNER_ID, { limit: 50 });
  assert(global.events.some((event) => event.kind === "connection_accepted"));
  assert(global.events.every((event) => event.space?.id !== OUTSIDER_SPACE_ID));
  pass("Space authorization and Connection participant isolation");

  const beforeRevocation = await overview.get(OWNER_ID);
  assert(beforeRevocation.activeWork.some((item) => item.kind === "document" && item.document.status === "queued"));
  assert(!JSON.stringify(beforeRevocation.activeWork).includes("ready.txt"));
  await database.db.delete(spaceMembers).where(and(
    eq(spaceMembers.spaceId, SPACE_ID),
    eq(spaceMembers.userId, OWNER_ID),
  ));
  await assert.rejects(
    activity.list(OWNER_ID, { spaceId: SPACE_ID, limit: 20 }),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
  const afterRevocation = await overview.get(OWNER_ID);
  assert(afterRevocation.activeWork.every((item) => item.space.id !== SPACE_ID));
  assert(afterRevocation.recentSpaces.every((item) => item.space.id !== SPACE_ID));
  assert(afterRevocation.recentActivity.every((event) => event.space?.id !== SPACE_ID));
  pass("Overview active-state projection and membership revocation recheck");
} finally {
  await database.close();
  await raw.end({ timeout: 5 });
}
