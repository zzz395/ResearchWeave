import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createDatabase } from "../server/db/client";
import {
  agentDefinitionTools,
  agentDefinitions,
  agentRunEvidence,
  agentRuns,
  agentRunSteps,
  agentTasks,
  documents,
  papers,
  researchSpaces,
  spaceMembers,
  users,
} from "../server/db/schema";
import { AGENT_EXECUTION_LIMITS } from "../server/modules/agents/state";
import { createDrizzleAgentRepository } from "../server/modules/agents/repository";

const smokeDatabaseUrl = process.env.PHASE9_SMOKE_DATABASE_URL;
if (!smokeDatabaseUrl) {
  throw new Error("PHASE9_SMOKE_DATABASE_URL is required; DATABASE_URL is never used by this smoke.");
}

const parsedDatabaseUrl = new URL(smokeDatabaseUrl);
if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
  throw new Error("PHASE9_SMOKE_DATABASE_URL must use the postgres or postgresql protocol.");
}
const smokeDatabaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//u, ""));
if (!/phase9[_-]?smoke/iu.test(smokeDatabaseName)) {
  throw new Error("The disposable database name must contain 'phase9_smoke'.");
}

const raw = postgres(smokeDatabaseUrl, { connect_timeout: 5, idle_timeout: 10, max: 3 });
const database = createDatabase(smokeDatabaseUrl);
const migrationsRoot = path.resolve(process.cwd(), "drizzle");
let phase8MigrationsRoot: string | null = null;

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER_ID = "10000000-0000-4000-8000-000000000002";
const SPACE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_SPACE_ID = "20000000-0000-4000-8000-000000000002";
const AGENT_ID = "30000000-0000-4000-8000-000000000001";
const TASK_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_TASK_ID = "40000000-0000-4000-8000-000000000002";
const RUN_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_RUN_ID = "50000000-0000-4000-8000-000000000002";
const RUNNING_RUN_ID = "50000000-0000-4000-8000-000000000003";
const STEP_ID = "60000000-0000-4000-8000-000000000001";
const KNOWLEDGE_STEP_ID = "60000000-0000-4000-8000-000000000002";
const PAPER_ID = "70000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "80000000-0000-4000-8000-000000000001";
const BASE_TIME = new Date("2026-09-03T00:00:00.000Z");

function pass(label: string): void {
  process.stdout.write(`[PASS] ${label}\n`);
}

async function expectRejected(action: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, message);
}

async function assertFreshDisposableTarget(): Promise<void> {
  const [identity] = await raw<[{ database_name: string; table_count: number }]>`
    select current_database() as database_name,
           (select count(*)::int
            from pg_tables
            where schemaname not in ('pg_catalog', 'information_schema')
              and not (schemaname = 'drizzle' and tablename = '__drizzle_migrations')) as table_count
  `;
  assert.equal(identity.database_name, smokeDatabaseName);
  assert.equal(identity.table_count, 0, "Phase 9 smoke requires a fresh disposable database.");
}

async function createPhase8MigrationSet(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "researchweave-phase8-migrations-"));
  const metaRoot = path.join(root, "meta");
  await mkdir(metaRoot);
  const journal = JSON.parse(
    await readFile(path.join(migrationsRoot, "meta", "_journal.json"), "utf8"),
  ) as { version: string; dialect: string; entries: Array<{ idx: number; tag: string }> };
  const phase8Entries = journal.entries.filter((entry) => entry.idx <= 5);
  assert.equal(phase8Entries.length, 6, "Expected the complete Phase 8C migration baseline.");
  await writeFile(
    path.join(metaRoot, "_journal.json"),
    `${JSON.stringify({ ...journal, entries: phase8Entries }, null, 2)}\n`,
    "utf8",
  );
  for (const entry of phase8Entries) {
    await copyFile(path.join(migrationsRoot, `${entry.tag}.sql`), path.join(root, `${entry.tag}.sql`));
  }
  return root;
}

async function migrateFromPhase8Baseline(): Promise<void> {
  phase8MigrationsRoot = await createPhase8MigrationSet();
  await migrate(database.db, { migrationsFolder: phase8MigrationsRoot });
  const [phase8State] = await raw<[{ documents: string | null; agent_runs: string | null }]>`
    select to_regclass('public.documents')::text as documents,
           to_regclass('public.agent_runs')::text as agent_runs
  `;
  assert.equal(phase8State.documents, "documents");
  assert.equal(phase8State.agent_runs, null);

  await database.db.insert(users).values({
    id: OWNER_ID,
    email: "phase9-owner@example.com",
    displayName: "Phase Nine Owner",
    passwordHash: "x".repeat(60),
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  await database.db.insert(researchSpaces).values({
    id: SPACE_ID,
    name: "Phase 9 Existing Space",
    description: "Created before the Phase 9 migration",
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

  await migrate(database.db, { migrationsFolder: migrationsRoot });
  const [preserved] = await database.db
    .select({ count: count() })
    .from(researchSpaces)
    .where(eq(researchSpaces.id, SPACE_ID));
  assert.equal(preserved.count, 1);
  pass("Phase 8C -> Phase 9 additive migration and existing-data compatibility");
}

async function assertSchemaShape(): Promise<void> {
  const tables = await raw<{ name: string }[]>`
    select tablename as name from pg_tables
    where schemaname = 'public' and tablename like 'agent_%'
    order by tablename
  `;
  assert.deepEqual(tables.map((table) => table.name), [
    "agent_definition_tools",
    "agent_definitions",
    "agent_run_evidence",
    "agent_run_steps",
    "agent_runs",
    "agent_tasks",
  ]);

  const enumRows = await raw<{ enum_name: string; enum_value: string }[]>`
    select type.typname as enum_name, enum.enumlabel as enum_value
    from pg_type type
    join pg_enum enum on enum.enumtypid = type.oid
    where type.typname like 'agent_%'
    order by type.typname, enum.enumsortorder
  `;
  const values = (name: string) => enumRows
    .filter((row) => row.enum_name === name)
    .map((row) => row.enum_value);
  assert.deepEqual(values("agent_run_status"), ["queued", "running", "completed", "failed", "cancelled"]);
  assert.deepEqual(values("agent_step_kind"), ["tool_call", "final_answer", "decision_error"]);
  assert.deepEqual(values("agent_step_status"), ["running", "completed", "failed", "cancelled"]);
  assert.deepEqual(values("agent_evidence_kind"), ["arxiv_abstract", "knowledge_chunk"]);

  const indexes = await raw<{ name: string }[]>`
    select indexname as name from pg_indexes
    where schemaname = 'public' and indexname like 'agent_%'
  `;
  const indexNames = new Set(indexes.map((item) => item.name));
  for (const name of [
    "agent_tasks_creation_idempotency_unique",
    "agent_tasks_space_cursor_index",
    "agent_runs_task_attempt_unique",
    "agent_runs_retry_idempotency_unique",
    "agent_runs_queued_claim_index",
    "agent_runs_expired_claim_index",
    "agent_run_steps_run_sequence_unique",
    "agent_run_evidence_run_key_unique",
    "agent_run_evidence_run_final_ordinal_unique",
  ]) assert(indexNames.has(name), `Missing Agent index ${name}.`);
  pass("Agent tables, enums, and indexes");
}

async function seedAgentFixtures(): Promise<void> {
  await database.db.insert(users).values({
    id: MEMBER_ID,
    email: "phase9-member@example.com",
    displayName: "Phase Nine Member",
    passwordHash: "y".repeat(60),
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  await database.db.insert(researchSpaces).values({
    id: OTHER_SPACE_ID,
    name: "Phase 9 Other Space",
    description: null,
    ownerId: OWNER_ID,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  await database.db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, userId: MEMBER_ID, role: "member", joinedAt: BASE_TIME },
    { spaceId: OTHER_SPACE_ID, userId: OWNER_ID, role: "owner", joinedAt: BASE_TIME },
  ]);
  await database.db.insert(agentDefinitions).values({
    id: AGENT_ID,
    spaceId: null,
    stableKey: "research-agent",
    name: "Research Agent",
    purpose: "Bounded research orchestration smoke fixture",
    enabled: true,
    systemManaged: true,
    revision: 1,
    limitsJson: AGENT_EXECUTION_LIMITS,
    promptVersion: "research-agent-v1",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  await database.db.insert(agentDefinitionTools).values([
    { agentId: AGENT_ID, toolName: "search_arxiv" },
    { agentId: AGENT_ID, toolName: "search_knowledge_base" },
    { agentId: AGENT_ID, toolName: "ask_knowledge" },
  ]);
}

function taskFixture(id: string, spaceId: string, clientRequestId: string) {
  return {
    id,
    spaceId,
    agentId: AGENT_ID,
    createdByUserId: OWNER_ID,
    prompt: `Research task ${id}`,
    clientRequestId,
    requestFingerprint: id.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    createdAt: BASE_TIME,
  } satisfies typeof agentTasks.$inferInsert;
}

function runFixture(
  id: string,
  taskId: string,
  spaceId: string,
  overrides: Partial<typeof agentRuns.$inferInsert> = {},
) {
  return {
    id,
    taskId,
    spaceId,
    actorUserId: OWNER_ID,
    attemptNumber: 1,
    status: "queued",
    definitionRevision: 1,
    toolNames: ["search_arxiv", "search_knowledge_base", "ask_knowledge"],
    ...AGENT_EXECUTION_LIMITS,
    promptVersion: "research-agent-v1",
    providerModel: "phase9-smoke-model",
    stepCount: 0,
    toolCallCount: 0,
    contextBytes: 0,
    leaseOwnerId: null,
    leaseGeneration: 0,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    cancelRequestedByUserId: null,
    startedAt: null,
    deadlineAt: null,
    finishedAt: null,
    errorCode: null,
    finalStatus: null,
    finalAnswer: null,
    retryClientRequestId: null,
    retryRequestFingerprint: null,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  } satisfies typeof agentRuns.$inferInsert;
}

async function runConstraintSmoke(): Promise<void> {
  await seedAgentFixtures();
  await expectRejected(
    () => database.db.insert(agentDefinitions).values({
      id: "30000000-0000-4000-8000-000000000099",
      spaceId: null,
      stableKey: "invalid-limits-agent",
      name: "Invalid Limits Agent",
      purpose: "Must be rejected by the database constraint",
      enabled: true,
      systemManaged: true,
      revision: 1,
      limitsJson: { ...AGENT_EXECUTION_LIMITS, maxSteps: 0 },
      promptVersion: "research-agent-v1",
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    }),
    "Invalid definition execution limits were not rejected.",
  );
  const firstTask = taskFixture(TASK_ID, SPACE_ID, "90000000-0000-4000-8000-000000000001");
  const otherTask = taskFixture(OTHER_TASK_ID, SPACE_ID, "90000000-0000-4000-8000-000000000002");
  await database.db.insert(agentTasks).values([firstTask, otherTask]);
  await expectRejected(
    () => database.db.insert(agentTasks).values({ ...firstTask, id: "40000000-0000-4000-8000-000000000099" }),
    "Task creation idempotency uniqueness was not enforced.",
  );

  await database.db.insert(agentRuns).values([
    runFixture(RUN_ID, TASK_ID, SPACE_ID),
    runFixture(OTHER_RUN_ID, OTHER_TASK_ID, SPACE_ID),
    runFixture(RUNNING_RUN_ID, OTHER_TASK_ID, SPACE_ID, {
      attemptNumber: 2,
      status: "running",
      retryClientRequestId: "90000000-0000-4000-8000-000000000003",
      retryRequestFingerprint: "b".repeat(64),
      leaseOwnerId: "90000000-0000-4000-8000-000000000004",
      leaseGeneration: 1,
      leaseExpiresAt: new Date("2026-09-03T00:01:00.000Z"),
      cancelRequestedAt: new Date("2026-09-03T00:00:30.000Z"),
      cancelRequestedByUserId: MEMBER_ID,
      startedAt: BASE_TIME,
      deadlineAt: new Date("2026-09-03T00:03:00.000Z"),
    }),
  ]);
  await expectRejected(
    () => database.db.insert(agentRuns).values(runFixture("50000000-0000-4000-8000-000000000099", TASK_ID, SPACE_ID)),
    "Run attempt uniqueness was not enforced.",
  );
  await database.db.insert(agentRuns).values(runFixture(
    "50000000-0000-4000-8000-000000000004",
    TASK_ID,
    SPACE_ID,
    {
      attemptNumber: 2,
      retryClientRequestId: "90000000-0000-4000-8000-000000000010",
      retryRequestFingerprint: "c".repeat(64),
    },
  ));
  await expectRejected(
    () => database.db.insert(agentRuns).values(runFixture(
      "50000000-0000-4000-8000-000000000098",
      TASK_ID,
      SPACE_ID,
      {
        attemptNumber: 2,
        retryClientRequestId: "90000000-0000-4000-8000-000000000011",
        retryRequestFingerprint: "d".repeat(64),
      },
    )),
    "Duplicate attempt number was not rejected.",
  );
  await expectRejected(
    () => database.db.insert(agentRuns).values(runFixture(
      "50000000-0000-4000-8000-000000000005",
      TASK_ID,
      SPACE_ID,
      {
        attemptNumber: 3,
        retryClientRequestId: "90000000-0000-4000-8000-000000000010",
        retryRequestFingerprint: "d".repeat(64),
      },
    )),
    "Retry idempotency uniqueness was not enforced.",
  );
  await expectRejected(
    () => database.db.insert(agentRuns).values(runFixture(
      "50000000-0000-4000-8000-000000000006",
      TASK_ID,
      OTHER_SPACE_ID,
    )),
    "Task/Run Space consistency was not enforced.",
  );

  const completedToolStep = {
    id: STEP_ID,
    runId: RUN_ID,
    sequence: 1,
    kind: "tool_call" as const,
    status: "completed" as const,
    toolName: "search_arxiv",
    safeArgumentsJson: { query: "durable agents" },
    observationJson: { resultCount: 1 },
    executionCount: 1,
    errorCode: null,
    startedAt: BASE_TIME,
    completedAt: BASE_TIME,
    durationMs: 1,
  } satisfies typeof agentRunSteps.$inferInsert;
  await database.db.insert(agentRunSteps).values([
    completedToolStep,
    { ...completedToolStep, id: KNOWLEDGE_STEP_ID, sequence: 2, toolName: "search_knowledge_base" },
  ]);
  await expectRejected(
    () => database.db.insert(agentRunSteps).values({ ...completedToolStep, id: "60000000-0000-4000-8000-000000000099" }),
    "Run step sequence uniqueness was not enforced.",
  );
  pass("Task/Run idempotency, attempts, Space pairing, and Step ordering");
}

async function runEvidenceSmoke(): Promise<void> {
  await database.db.insert(papers).values({
    id: PAPER_ID,
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v1",
    version: 1,
    title: "Durable Agent Evidence",
    abstract: "Evidence snapshot source.",
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
  await database.db.insert(documents).values({
    id: DOCUMENT_ID,
    spaceId: SPACE_ID,
    uploadedByUserId: OWNER_ID,
    originalFilename: "evidence.md",
    mediaType: "markdown",
    sizeBytes: 20,
    sourceSha256: "e".repeat(64),
    storageKey: `spaces/${SPACE_ID}/${DOCUMENT_ID}/source`,
    status: "ready",
    stage: null,
    attemptCount: 1,
    lastAttemptAt: BASE_TIME,
    errorCode: null,
    failedAt: null,
    pageCount: null,
    characterCount: 20,
    chunkCount: 1,
    extractorVersion: "utf8-source-v1",
    chunkerVersion: "deterministic-char-v1",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    indexFingerprint: "f".repeat(64),
    indexedAt: BASE_TIME,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });

  const arxivEvidence = {
    id: "a0000000-0000-4000-8000-000000000001",
    runId: RUN_ID,
    stepId: STEP_ID,
    evidenceKey: "E1",
    kind: "arxiv_abstract" as const,
    paperId: PAPER_ID,
    documentId: null,
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v1",
    sourceVersion: 1,
    sourceTitle: "Durable Agent Evidence",
    sourceUrl: "https://arxiv.org/abs/2609.00001v1",
    originalFilename: null,
    contentHash: null,
    chunkOrdinal: null,
    pageNumber: null,
    startOffset: null,
    endOffset: null,
    excerpt: "Evidence snapshot source.",
    finalOrdinal: 1,
    createdAt: BASE_TIME,
  } satisfies typeof agentRunEvidence.$inferInsert;
  const knowledgeEvidence = {
    id: "a0000000-0000-4000-8000-000000000002",
    runId: RUN_ID,
    stepId: KNOWLEDGE_STEP_ID,
    evidenceKey: "E2",
    kind: "knowledge_chunk" as const,
    paperId: null,
    documentId: DOCUMENT_ID,
    canonicalArxivId: null,
    versionedArxivId: null,
    sourceVersion: null,
    sourceTitle: null,
    sourceUrl: null,
    originalFilename: "evidence.md",
    contentHash: "1".repeat(64),
    chunkOrdinal: 0,
    pageNumber: null,
    startOffset: 0,
    endOffset: 20,
    excerpt: "Bounded knowledge snapshot.",
    finalOrdinal: 2,
    createdAt: BASE_TIME,
  } satisfies typeof agentRunEvidence.$inferInsert;
  await database.db.insert(agentRunEvidence).values([arxivEvidence, knowledgeEvidence]);
  await expectRejected(
    () => database.db.insert(agentRunEvidence).values({
      ...arxivEvidence,
      id: "a0000000-0000-4000-8000-000000000003",
      runId: OTHER_RUN_ID,
      evidenceKey: "E3",
      finalOrdinal: null,
    }),
    "Cross-Run Evidence was not rejected.",
  );
  await expectRejected(
    () => database.db.insert(agentRunEvidence).values({
      ...arxivEvidence,
      id: "a0000000-0000-4000-8000-000000000004",
      finalOrdinal: null,
    }),
    "Evidence key uniqueness was not enforced.",
  );
  await expectRejected(
    () => database.db.insert(agentRunEvidence).values({
      ...arxivEvidence,
      id: "a0000000-0000-4000-8000-000000000005",
      evidenceKey: "E3",
    }),
    "Final Evidence ordinal uniqueness was not enforced.",
  );

  await database.db.delete(papers).where(eq(papers.id, PAPER_ID));
  await database.db.delete(documents).where(eq(documents.id, DOCUMENT_ID));
  const retained = await database.db
    .select()
    .from(agentRunEvidence)
    .where(eq(agentRunEvidence.runId, RUN_ID));
  assert.equal(retained.length, 2);
  assert(retained.every((item) => item.paperId === null && item.documentId === null));
  assert.equal(retained.find((item) => item.evidenceKey === "E1")?.sourceTitle, "Durable Agent Evidence");
  assert.equal(retained.find((item) => item.evidenceKey === "E2")?.originalFilename, "evidence.md");
  pass("Run-local Evidence and source snapshot retention");
}

async function runClaimPlanSmoke(): Promise<void> {
  await raw`set enable_seqscan = off`;
  const plan = await raw<Record<string, unknown>[]>`
    explain (format json)
    select id
    from agent_runs
    where status = 'queued'
       or (status = 'running' and lease_expires_at <= ${new Date("2026-09-03T00:02:00.000Z")})
    order by created_at, id
    for update skip locked
    limit 1
  `;
  const planText = JSON.stringify(plan);
  assert.match(planText, /agent_runs_queued_claim_index/u);
  assert.match(planText, /agent_runs_expired_claim_index/u);
  await raw`reset enable_seqscan`;
  pass("queued/expired claim query indexes");
}

async function runAttributionAndCascadeSmoke(): Promise<void> {
  await database.db.delete(users).where(eq(users.id, MEMBER_ID));
  const [running] = await database.db
    .select({
      cancelRequestedAt: agentRuns.cancelRequestedAt,
      cancelRequestedByUserId: agentRuns.cancelRequestedByUserId,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, RUNNING_RUN_ID));
  assert.deepEqual(running.cancelRequestedAt, new Date("2026-09-03T00:00:30.000Z"));
  assert.equal(running.cancelRequestedByUserId, null);

  await database.db.delete(researchSpaces).where(eq(researchSpaces.id, SPACE_ID));
  const [remainingTasks] = await database.db.select({ count: count() }).from(agentTasks);
  const [remainingRuns] = await database.db.select({ count: count() }).from(agentRuns);
  const [remainingSteps] = await database.db.select({ count: count() }).from(agentRunSteps);
  const [remainingEvidence] = await database.db.select({ count: count() }).from(agentRunEvidence);
  const [remainingDefinitions] = await database.db
    .select({ count: count() })
    .from(agentDefinitions)
    .where(eq(agentDefinitions.id, AGENT_ID));
  assert.equal(remainingTasks.count, 0);
  assert.equal(remainingRuns.count, 0);
  assert.equal(remainingSteps.count, 0);
  assert.equal(remainingEvidence.count, 0);
  assert.equal(remainingDefinitions.count, 1);
  pass("cancellation attribution SET NULL and Space cascade");
}

async function runRepositorySmoke(): Promise<void> {
  const repository = createDrizzleAgentRepository(database);
  const taskA = "41000000-0000-4000-8000-000000000001";
  const taskB = "41000000-0000-4000-8000-000000000002";
  const taskC = "41000000-0000-4000-8000-000000000003";
  const runA = "51000000-0000-4000-8000-000000000001";
  const runB = "51000000-0000-4000-8000-000000000002";
  const runC = "51000000-0000-4000-8000-000000000003";
  const ownerA = "91000000-0000-4000-8000-000000000001";
  const ownerB = "91000000-0000-4000-8000-000000000002";
  const createRequestA = "91000000-0000-4000-8000-000000000011";
  const createRequestB = "91000000-0000-4000-8000-000000000012";
  const createRequestC = "91000000-0000-4000-8000-000000000013";
  const fingerprintA = "1".repeat(64);
  const firstCreatedAt = new Date("2026-09-03T01:00:00.000Z");
  const secondCreatedAt = new Date("2026-09-03T01:00:01.000Z");
  const thirdCreatedAt = new Date("2026-09-03T01:00:02.000Z");

  const definition = await repository.findDefinition(AGENT_ID, OTHER_SPACE_ID);
  assert(definition);
  assert.deepEqual(definition.tools, ["ask_knowledge", "search_arxiv", "search_knowledge_base"]);

  const createAInput = {
    taskId: taskA,
    runId: runA,
    spaceId: OTHER_SPACE_ID,
    agentId: AGENT_ID,
    actorUserId: OWNER_ID,
    prompt: "Repository lifecycle task A",
    clientRequestId: createRequestA,
    requestFingerprint: fingerprintA,
    providerModel: "phase9-repository-smoke",
    now: firstCreatedAt,
  };
  const createdA = await repository.createTaskWithInitialRun(createAInput);
  assert.equal(createdA.status, "created");
  const existingA = await repository.createTaskWithInitialRun({
    ...createAInput,
    taskId: "41000000-0000-4000-8000-000000000099",
    runId: "51000000-0000-4000-8000-000000000099",
  });
  assert.equal(existingA.status, "existing");
  if (existingA.status === "existing") {
    assert.equal(existingA.task.id, taskA);
    assert.equal(existingA.run.record.id, runA);
    assert.deepEqual(existingA.run.finalEvidenceIds, []);
  }
  const conflictingA = await repository.createTaskWithInitialRun({
    ...createAInput,
    requestFingerprint: "2".repeat(64),
  });
  assert.equal(conflictingA.status, "idempotency_conflict");

  const [createdB, createdC] = await Promise.all([
    repository.createTaskWithInitialRun({
      ...createAInput,
      taskId: taskB,
      runId: runB,
      clientRequestId: createRequestB,
      requestFingerprint: "3".repeat(64),
      prompt: "Repository lifecycle task B",
      now: secondCreatedAt,
    }),
    repository.createTaskWithInitialRun({
      ...createAInput,
      taskId: taskC,
      runId: runC,
      clientRequestId: createRequestC,
      requestFingerprint: "4".repeat(64),
      prompt: "Repository lifecycle task C",
      now: thirdCreatedAt,
    }),
  ]);
  assert.equal(createdB.status, "created");
  assert.equal(createdC.status, "created");
  pass("Repository atomic task creation and idempotency mapping");

  const [claimA, claimB] = await Promise.all([
    repository.claimRun({ leaseOwnerId: ownerA, now: new Date("2026-09-03T01:01:00.000Z"), leaseDurationMs: 60_000 }),
    repository.claimRun({ leaseOwnerId: ownerB, now: new Date("2026-09-03T01:01:00.000Z"), leaseDurationMs: 60_000 }),
  ]);
  assert.equal(claimA.status, "claimed");
  assert.equal(claimB.status, "claimed");
  if (claimA.status !== "claimed" || claimB.status !== "claimed") {
    throw new Error("Expected two concurrent repository claims.");
  }
  assert.notEqual(claimA.claim.run.id, claimB.claim.run.id);
  assert.deepEqual(
    [claimA.claim.run.id, claimB.claim.run.id].sort(),
    [runA, runB].sort(),
  );
  assert.equal(claimA.claim.run.leaseGeneration, 1);
  assert.equal(claimB.claim.run.leaseGeneration, 1);
  const claimC = await repository.claimRun({
    leaseOwnerId: ownerA,
    now: new Date("2026-09-03T01:01:00.000Z"),
    leaseDurationMs: 60_000,
  });
  assert.equal(claimC.status, "claimed");
  if (claimC.status !== "claimed") throw new Error("Expected third ordered claim.");
  assert.equal(claimC.claim.run.id, runC);
  const noHealthyClaim = await repository.claimRun({
    leaseOwnerId: "91000000-0000-4000-8000-000000000003",
    now: new Date("2026-09-03T01:01:30.000Z"),
    leaseDurationMs: 60_000,
  });
  assert.equal(noHealthyClaim.status, "empty");
  pass("Repository concurrent SKIP LOCKED claims, ordering, and healthy-lease exclusion");

  const activeA = claimA.claim.run.id === runA ? claimA.claim : claimB.claim;
  const activeB = claimA.claim.run.id === runB ? claimA.claim : claimB.claim;
  const staleHeartbeat = await repository.heartbeatLease({
    runId: activeA.run.id,
    leaseOwnerId: ownerA,
    leaseGeneration: activeA.run.leaseGeneration + 1,
    now: new Date("2026-09-03T01:01:10.000Z"),
    leaseDurationMs: 60_000,
  });
  assert.equal(staleHeartbeat.status, "stale");
  const currentHeartbeat = await repository.heartbeatLease({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    now: new Date("2026-09-03T01:01:10.000Z"),
    leaseDurationMs: 60_000,
  });
  assert.equal(currentHeartbeat.status, "updated");

  const originalDeadline = activeB.run.deadlineAt;
  const reclaimed = await repository.claimRun({
    leaseOwnerId: "91000000-0000-4000-8000-000000000004",
    now: new Date("2026-09-03T01:02:01.000Z"),
    leaseDurationMs: 30_000,
  });
  assert.equal(reclaimed.status, "claimed");
  if (reclaimed.status !== "claimed") throw new Error("Expected expired lease reclaim.");
  assert.equal(reclaimed.claim.run.id, activeB.run.id);
  assert.equal(reclaimed.claim.run.leaseGeneration, activeB.run.leaseGeneration + 1);
  assert.deepEqual(reclaimed.claim.run.deadlineAt, originalDeadline);
  pass("Repository heartbeat fencing, expired reclaim, and immutable deadline");

  const stepId = "61000000-0000-4000-8000-000000000001";
  const reserved = await repository.reserveStep({
    runId: reclaimed.claim.run.id,
    leaseOwnerId: reclaimed.claim.run.leaseOwnerId!,
    leaseGeneration: reclaimed.claim.run.leaseGeneration,
    stepId,
    toolName: "search_arxiv",
    safeArguments: { query: "fenced persistence" },
    now: new Date("2026-09-03T01:02:02.000Z"),
  });
  assert.equal(reserved.status, "reserved");
  const duplicateLogicalStep = await repository.reserveStep({
    runId: reclaimed.claim.run.id,
    leaseOwnerId: reclaimed.claim.run.leaseOwnerId!,
    leaseGeneration: reclaimed.claim.run.leaseGeneration,
    stepId: "61000000-0000-4000-8000-000000000002",
    toolName: "search_arxiv",
    safeArguments: { query: "different logical step" },
    now: new Date("2026-09-03T01:02:03.000Z"),
  });
  assert.equal(duplicateLogicalStep.status, "incomplete_step");
  const staleCompletion = await repository.completeToolStepWithEvidence({
    runId: reclaimed.claim.run.id,
    leaseOwnerId: activeB.run.leaseOwnerId!,
    leaseGeneration: activeB.run.leaseGeneration,
    stepId,
    observation: { resultCount: 1 },
    evidence: [],
    contextBytes: 100,
    now: new Date("2026-09-03T01:02:04.000Z"),
  });
  assert.equal(staleCompletion.status, "stale");
  const completedStep = await repository.completeToolStepWithEvidence({
    runId: reclaimed.claim.run.id,
    leaseOwnerId: reclaimed.claim.run.leaseOwnerId!,
    leaseGeneration: reclaimed.claim.run.leaseGeneration,
    stepId,
    observation: { resultCount: 1 },
    evidence: [{
      id: "a1000000-0000-4000-8000-000000000001",
      kind: "arxiv_abstract",
      paperId: null,
      canonicalArxivId: "2609.99999",
      versionedArxivId: "2609.99999v1",
      sourceVersion: 1,
      title: "Fenced Agent Persistence",
      url: "https://arxiv.org/abs/2609.99999v1",
      excerpt: "A bounded evidence snapshot.",
    }],
    contextBytes: 100,
    now: new Date("2026-09-03T01:02:04.000Z"),
  });
  assert.equal(completedStep.status, "completed");
  const staleFinal = await repository.completeRun({
    runId: reclaimed.claim.run.id,
    leaseOwnerId: activeB.run.leaseOwnerId!,
    leaseGeneration: activeB.run.leaseGeneration,
    finalStepId: "61000000-0000-4000-8000-000000000003",
    finalResult: { status: "answered", answer: "Result [E1]", evidenceIds: ["E1"] },
    now: new Date("2026-09-03T01:02:05.000Z"),
  });
  assert.equal(staleFinal.status, "stale");
  const completedRun = await repository.completeRun({
    runId: reclaimed.claim.run.id,
    leaseOwnerId: reclaimed.claim.run.leaseOwnerId!,
    leaseGeneration: reclaimed.claim.run.leaseGeneration,
    finalStepId: "61000000-0000-4000-8000-000000000003",
    finalResult: { status: "answered", answer: "Result [E1]", evidenceIds: ["E1"] },
    now: new Date("2026-09-03T01:02:05.000Z"),
  });
  assert.equal(completedRun.status, "completed");
  if (completedRun.status === "completed") {
    assert.equal(completedRun.run.leaseOwnerId, null);
    assert.equal(completedRun.run.leaseExpiresAt, null);
    assert.equal(completedRun.run.stepCount, 2);
  }
  const trace = await repository.readRunTraceForMember(reclaimed.claim.run.id, OWNER_ID);
  assert.equal(trace.status, "ok");
  if (trace.status === "ok") {
    assert.deepEqual(trace.record.steps.map((step) => step.sequence), [1, 2]);
    assert.deepEqual(trace.record.evidence.map((item) => item.finalOrdinal), [1]);
  }
  const completedRunRead = await repository.readRunForMember(reclaimed.claim.run.id, OWNER_ID);
  assert.equal(completedRunRead.status, "ok");
  if (completedRunRead.status === "ok") {
    assert.equal(completedRunRead.record.record.status, "completed");
    assert.deepEqual(completedRunRead.record.finalEvidenceIds, ["E1"]);
  }
  const completedTaskRead = await repository.readTaskForMember(taskB, OWNER_ID);
  assert.equal(completedTaskRead.status, "ok");
  if (completedTaskRead.status === "ok") {
    assert.deepEqual(completedTaskRead.record.runs.map((view) => view.record.id), [runB]);
    assert.deepEqual(completedTaskRead.record.latestRun.finalEvidenceIds, ["E1"]);
  }
  const taskList = await repository.listTasksForMember({
    spaceId: OTHER_SPACE_ID,
    actorUserId: OWNER_ID,
    cursor: null,
    limit: 10,
  });
  assert.equal(taskList.status, "ok");
  if (taskList.status === "ok") {
    const completedTask = taskList.records.find((item) => item.task.id === taskB);
    assert.deepEqual(completedTask?.latestRun.finalEvidenceIds, ["E1"]);
  }
  const delayedCreateReplay = await repository.createTaskWithInitialRun({
    ...createAInput,
    taskId: "41000000-0000-4000-8000-000000000098",
    runId: "51000000-0000-4000-8000-000000000098",
    clientRequestId: createRequestB,
    requestFingerprint: "3".repeat(64),
    prompt: "Repository lifecycle task B",
    now: secondCreatedAt,
  });
  assert.equal(delayedCreateReplay.status, "existing");
  if (delayedCreateReplay.status === "existing") {
    assert.equal(delayedCreateReplay.run.record.id, runB);
    assert.deepEqual(delayedCreateReplay.run.finalEvidenceIds, ["E1"]);
  }
  const terminalCancellation = await repository.cancelRun(
    reclaimed.claim.run.id,
    OWNER_ID,
    new Date("2026-09-03T01:02:06.000Z"),
  );
  assert.equal(terminalCancellation.status, "terminal");
  if (terminalCancellation.status === "terminal") {
    assert.equal(terminalCancellation.terminalStatus, "completed");
    assert.deepEqual(terminalCancellation.run.finalEvidenceIds, ["E1"]);
  }
  pass("Repository ordered Steps, atomic Evidence, stale-write rejection, and final atomicity");

  const cancelTarget = claimC.claim;
  const cancellation = await repository.cancelRun(cancelTarget.run.id, OWNER_ID, new Date("2026-09-03T01:01:20.000Z"));
  assert.equal(cancellation.status, "cancellation_requested");
  const lateFinal = await repository.completeRun({
    runId: cancelTarget.run.id,
    leaseOwnerId: cancelTarget.run.leaseOwnerId!,
    leaseGeneration: cancelTarget.run.leaseGeneration,
    finalStepId: "61000000-0000-4000-8000-000000000004",
    finalResult: { status: "insufficient_context", answer: "No context.", evidenceIds: [] },
    now: new Date("2026-09-03T01:01:21.000Z"),
  });
  assert.equal(lateFinal.status, "cancel_requested");
  const cancelledRecord = await repository.readRunForMember(cancelTarget.run.id, OWNER_ID);
  assert.equal(cancelledRecord.status, "ok");
  if (cancelledRecord.status === "ok") {
    assert.equal(cancelledRecord.record.record.status, "cancelled");
    assert.equal(cancelledRecord.record.record.leaseOwnerId, null);
    assert.deepEqual(cancelledRecord.record.finalEvidenceIds, []);
  }

  const queuedCancelTask = "41000000-0000-4000-8000-000000000010";
  const queuedCancelRun = "51000000-0000-4000-8000-000000000010";
  await repository.createTaskWithInitialRun({
    ...createAInput,
    taskId: queuedCancelTask,
    runId: queuedCancelRun,
    clientRequestId: "91000000-0000-4000-8000-000000000020",
    requestFingerprint: "5".repeat(64),
    now: new Date("2026-09-03T01:03:00.000Z"),
  });
  const [cancelRace, claimRace] = await Promise.all([
    repository.cancelRun(queuedCancelRun, OWNER_ID, new Date("2026-09-03T01:03:01.000Z")),
    repository.claimRun({
      leaseOwnerId: "91000000-0000-4000-8000-000000000005",
      now: new Date("2026-09-03T01:03:01.000Z"),
      leaseDurationMs: 60_000,
    }),
  ]);
  const racedRun = await repository.readRunForMember(queuedCancelRun, OWNER_ID);
  assert.equal(racedRun.status, "ok");
  if (racedRun.status === "ok") {
    assert(["running", "cancelled"].includes(racedRun.record.record.status));
    assert(
      !(
        cancelRace.status === "cancelled" &&
        claimRace.status === "claimed" &&
        claimRace.claim.run.id === queuedCancelRun
      ),
    );
  }
  pass("Repository queued cancel/claim exclusion and running cancel/final priority");

  const retryRequest = "91000000-0000-4000-8000-000000000030";
  const retryFingerprint = "6".repeat(64);
  const [retryOne, retryTwo] = await Promise.all([
    repository.createRetryRun({
      runId: "51000000-0000-4000-8000-000000000020",
      taskId: taskB,
      actorUserId: OWNER_ID,
      clientRequestId: retryRequest,
      requestFingerprint: retryFingerprint,
      providerModel: "phase9-repository-smoke",
      now: new Date("2026-09-03T01:04:00.000Z"),
    }),
    repository.createRetryRun({
      runId: "51000000-0000-4000-8000-000000000021",
      taskId: taskB,
      actorUserId: OWNER_ID,
      clientRequestId: retryRequest,
      requestFingerprint: retryFingerprint,
      providerModel: "phase9-repository-smoke",
      now: new Date("2026-09-03T01:04:00.000Z"),
    }),
  ]);
  assert.deepEqual([retryOne.status, retryTwo.status].sort(), ["created", "existing"]);
  if (retryOne.status === "created" && retryTwo.status === "existing") {
    assert.equal(retryOne.run.record.id, retryTwo.run.record.id);
    assert.deepEqual(retryOne.run.finalEvidenceIds, []);
    assert.deepEqual(retryTwo.run.finalEvidenceIds, []);
  } else if (retryOne.status === "existing" && retryTwo.status === "created") {
    assert.equal(retryOne.run.record.id, retryTwo.run.record.id);
    assert.deepEqual(retryOne.run.finalEvidenceIds, []);
    assert.deepEqual(retryTwo.run.finalEvidenceIds, []);
  }
  pass("Repository retry attempt and idempotency race serialization");

  await database.db.delete(researchSpaces).where(eq(researchSpaces.id, OTHER_SPACE_ID));
  const [repositoryTasks] = await database.db.select({ count: count() }).from(agentTasks);
  assert.equal(repositoryTasks.count, 0);
  pass("Repository Space cascade cleanup");
}

try {
  await assertFreshDisposableTarget();
  await migrateFromPhase8Baseline();
  await assertSchemaShape();
  await runConstraintSmoke();
  await runEvidenceSmoke();
  await runClaimPlanSmoke();
  await runAttributionAndCascadeSmoke();
  await runRepositorySmoke();
} finally {
  await database.close();
  await raw.end({ timeout: 5 });
  if (phase8MigrationsRoot) await rm(phase8MigrationsRoot, { recursive: true, force: true });
}
