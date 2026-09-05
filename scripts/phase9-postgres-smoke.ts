import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { and, count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";

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
import { AppError } from "../server/middleware/app-error";
import { AGENT_EXECUTION_LIMITS } from "../server/modules/agents/state";
import { createDrizzleAgentRepository } from "../server/modules/agents/repository";
import type {
  AgentDecision,
  AgentDecisionProviderInput,
} from "../server/modules/agents/decision-provider";
import { createAgentRunExecutor } from "../server/modules/agents/run-executor";
import { createAgentRuntime } from "../server/modules/agents/runtime";
import { createAgentService } from "../server/modules/agents/service";
import { createAgentWorker } from "../server/modules/agents/worker";
import { agentToolExecutionResultSchema } from "../server/modules/agents/tools/contracts";
import { createAgentToolRegistry } from "../server/modules/agents/tools/registry";

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

  const [systemDefinition] = await database.db
    .select()
    .from(agentDefinitions)
    .where(eq(agentDefinitions.id, AGENT_ID));
  assert.equal(systemDefinition?.stableKey, "research-agent");
  assert.equal(systemDefinition?.systemManaged, true);
  assert.deepEqual(systemDefinition?.limitsJson, AGENT_EXECUTION_LIMITS);
  const systemTools = await database.db
    .select({ toolName: agentDefinitionTools.toolName })
    .from(agentDefinitionTools)
    .where(eq(agentDefinitionTools.agentId, AGENT_ID));
  assert.deepEqual(
    systemTools.map((item) => item.toolName).sort(),
    ["ask_knowledge", "search_arxiv", "search_knowledge_base"],
  );
  pass("Agent tables, enums, indexes, and system definition provisioning");
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
  const unavailableCreate = await repository.createTaskWithInitialRun({
    ...createAInput,
    taskId: "41000000-0000-4000-8000-000000000098",
    runId: "51000000-0000-4000-8000-000000000098",
    clientRequestId: "91000000-0000-4000-8000-000000000098",
    providerModel: null,
  });
  assert.equal(unavailableCreate.status, "runtime_unavailable");
  const createdA = await repository.createTaskWithInitialRun(createAInput);
  assert.equal(createdA.status, "created");
  const existingA = await repository.createTaskWithInitialRun({
    ...createAInput,
    taskId: "41000000-0000-4000-8000-000000000099",
    runId: "51000000-0000-4000-8000-000000000099",
    providerModel: null,
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

  const completedStateStepId = "61000000-0000-4000-8000-000000000101";
  const failedStateStepId = "61000000-0000-4000-8000-000000000102";
  const runningStateStepId = "61000000-0000-4000-8000-000000000103";
  const completedStateStep = await repository.reserveStep({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    stepId: completedStateStepId,
    toolName: "search_arxiv",
    safeArguments: { query: "execution state" },
    now: new Date("2026-09-03T01:01:11.000Z"),
  });
  assert.equal(completedStateStep.status, "reserved");
  const completedStateWrite = await repository.completeToolStepWithEvidence({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    stepId: completedStateStepId,
    observation: { resultCount: 1 },
    evidence: [{
      id: "a1000000-0000-4000-8000-000000000101",
      kind: "arxiv_abstract",
      paperId: null,
      canonicalArxivId: "2609.10101",
      versionedArxivId: "2609.10101v1",
      sourceVersion: 1,
      title: "Execution State Snapshot",
      url: "https://arxiv.org/abs/2609.10101v1",
      excerpt: "Evidence retained for fenced execution recovery.",
    }],
    contextBytes: 100,
    now: new Date("2026-09-03T01:01:12.000Z"),
  });
  assert.equal(completedStateWrite.status, "completed");
  const failedStateStep = await repository.reserveStep({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    stepId: failedStateStepId,
    toolName: "search_knowledge_base",
    safeArguments: { query: "atomic context accounting" },
    now: new Date("2026-09-03T01:01:13.000Z"),
  });
  assert.equal(failedStateStep.status, "reserved");

  const staleStepFailure = await repository.failStep({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration + 1,
    stepId: failedStateStepId,
    errorCode: "retrieval_embedding_unavailable",
    contextBytes: 321,
    now: new Date("2026-09-03T01:01:14.000Z"),
  });
  assert.equal(staleStepFailure.status, "stale");
  const excessiveContextFailure = await repository.failStep({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    stepId: failedStateStepId,
    errorCode: "retrieval_embedding_unavailable",
    contextBytes: activeA.run.contextMaxBytes + 1,
    now: new Date("2026-09-03T01:01:15.000Z"),
  });
  assert.equal(excessiveContextFailure.status, "context_limit_exceeded");
  const [unchangedFailedStep] = await database.db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.id, failedStateStepId));
  const [unchangedFailedRun] = await database.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, activeA.run.id));
  assert.equal(unchangedFailedStep?.status, "running");
  assert.equal(unchangedFailedRun?.contextBytes, 100);

  await raw`
    create function phase9_smoke_reject_context_update()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.id = '51000000-0000-4000-8000-000000000001'::uuid
         and new.context_bytes = 222 then
        return null;
      end if;
      return new;
    end
    $$
  `;
  await raw`
    create trigger phase9_smoke_reject_context_update
    before update of context_bytes on agent_runs
    for each row execute function phase9_smoke_reject_context_update()
  `;
  try {
    await expectRejected(
      () => repository.failStep({
        runId: activeA.run.id,
        leaseOwnerId: activeA.run.leaseOwnerId!,
        leaseGeneration: activeA.run.leaseGeneration,
        stepId: failedStateStepId,
        errorCode: "retrieval_embedding_rejected",
        contextBytes: 222,
        now: new Date("2026-09-03T01:01:15.500Z"),
      }),
      "A rejected Run context update must abort the failed-Step transaction.",
    );
  } finally {
    await raw`drop trigger phase9_smoke_reject_context_update on agent_runs`;
    await raw`drop function phase9_smoke_reject_context_update()`;
  }
  const [rolledBackFailedStep] = await database.db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.id, failedStateStepId));
  const [rolledBackFailedRun] = await database.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, activeA.run.id));
  assert.equal(rolledBackFailedStep?.status, "running");
  assert.equal(rolledBackFailedRun?.contextBytes, 100);

  const atomicStepFailure = await repository.failStep({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    stepId: failedStateStepId,
    errorCode: "retrieval_embedding_unavailable",
    contextBytes: 321,
    now: new Date("2026-09-03T01:01:16.000Z"),
  });
  assert.equal(atomicStepFailure.status, "failed");
  if (atomicStepFailure.status === "failed") {
    assert.equal(atomicStepFailure.step.observationJson, null);
    assert.equal(atomicStepFailure.step.errorCode, "retrieval_embedding_unavailable");
    assert.equal(atomicStepFailure.run.contextBytes, 321);
  }
  const [persistedFailedStep] = await database.db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.id, failedStateStepId));
  const [persistedFailedRun] = await database.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, activeA.run.id));
  assert.equal(persistedFailedStep?.status, "failed");
  assert.equal(persistedFailedStep?.observationJson, null);
  assert.equal(persistedFailedRun?.contextBytes, 321);

  const runningStateStep = await repository.reserveStep({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    stepId: runningStateStepId,
    toolName: "ask_knowledge",
    safeArguments: { question: "What has already been persisted?" },
    now: new Date("2026-09-03T01:01:17.000Z"),
  });
  assert.equal(runningStateStep.status, "reserved");
  const executionState = await repository.readExecutionState({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration,
    now: new Date("2026-09-03T01:01:18.000Z"),
  });
  assert.equal(executionState.status, "ok");
  if (executionState.status === "ok") {
    assert.equal(executionState.state.task.id, activeA.task.id);
    assert.equal(executionState.state.run.id, activeA.run.id);
    assert.deepEqual(executionState.state.steps.map((step) => step.sequence), [1, 2, 3]);
    assert.deepEqual(executionState.state.steps.map((step) => step.status), [
      "completed",
      "failed",
      "running",
    ]);
    assert.deepEqual(executionState.state.evidence.map((item) => item.evidenceKey), ["E1"]);
  }
  const wrongOwnerState = await repository.readExecutionState({
    runId: activeA.run.id,
    leaseOwnerId: "91000000-0000-4000-8000-000000000099",
    leaseGeneration: activeA.run.leaseGeneration,
    now: new Date("2026-09-03T01:01:18.000Z"),
  });
  assert.equal(wrongOwnerState.status, "stale");
  const wrongGenerationState = await repository.readExecutionState({
    runId: activeA.run.id,
    leaseOwnerId: activeA.run.leaseOwnerId!,
    leaseGeneration: activeA.run.leaseGeneration + 1,
    now: new Date("2026-09-03T01:01:18.000Z"),
  });
  assert.equal(wrongGenerationState.status, "stale");

  const accessState = claimC.claim;
  await database.db
    .delete(spaceMembers)
    .where(eq(spaceMembers.spaceId, OTHER_SPACE_ID));
  const accessRevokedState = await repository.readExecutionState({
    runId: accessState.run.id,
    leaseOwnerId: accessState.run.leaseOwnerId!,
    leaseGeneration: accessState.run.leaseGeneration,
    now: new Date("2026-09-03T01:01:19.000Z"),
  });
  assert.equal(accessRevokedState.status, "access_revoked");
  assert.equal("state" in accessRevokedState, false);
  await database.db.insert(spaceMembers).values({
    spaceId: OTHER_SPACE_ID,
    userId: OWNER_ID,
    role: "owner",
    joinedAt: BASE_TIME,
  });
  const deadlineState = await repository.readExecutionState({
    runId: accessState.run.id,
    leaseOwnerId: accessState.run.leaseOwnerId!,
    leaseGeneration: accessState.run.leaseGeneration,
    now: accessState.run.deadlineAt!,
  });
  assert.equal(deadlineState.status, "deadline_exceeded");

  const expiredState = await repository.readExecutionState({
    runId: activeB.run.id,
    leaseOwnerId: activeB.run.leaseOwnerId!,
    leaseGeneration: activeB.run.leaseGeneration,
    now: new Date("2026-09-03T01:02:01.000Z"),
  });
  assert.equal(expiredState.status, "stale");
  pass("Repository fenced execution-state reads and atomic failed-step context accounting");

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
  const cancellationState = await repository.readExecutionState({
    runId: cancelTarget.run.id,
    leaseOwnerId: cancelTarget.run.leaseOwnerId!,
    leaseGeneration: cancelTarget.run.leaseGeneration,
    now: new Date("2026-09-03T01:01:20.000Z"),
  });
  assert.equal(cancellationState.status, "cancel_requested");
  const lateFinal = await repository.completeRun({
    runId: cancelTarget.run.id,
    leaseOwnerId: cancelTarget.run.leaseOwnerId!,
    leaseGeneration: cancelTarget.run.leaseGeneration,
    finalStepId: "61000000-0000-4000-8000-000000000004",
    finalResult: { status: "insufficient_context", answer: "No context.", evidenceIds: [] },
    now: new Date("2026-09-03T01:01:21.000Z"),
  });
  assert.equal(lateFinal.status, "cancel_requested");
  const terminalExecutionState = await repository.readExecutionState({
    runId: cancelTarget.run.id,
    leaseOwnerId: cancelTarget.run.leaseOwnerId!,
    leaseGeneration: cancelTarget.run.leaseGeneration,
    now: new Date("2026-09-03T01:01:22.000Z"),
  });
  assert.equal(terminalExecutionState.status, "stale");
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
  const retryReplayWithoutRuntime = await repository.createRetryRun({
    runId: "51000000-0000-4000-8000-000000000022",
    taskId: taskB,
    actorUserId: OWNER_ID,
    clientRequestId: retryRequest,
    requestFingerprint: retryFingerprint,
    providerModel: null,
    now: new Date("2026-09-03T01:04:01.000Z"),
  });
  assert.equal(retryReplayWithoutRuntime.status, "existing");
  pass("Repository retry attempt and idempotency race serialization");

  const expiryOwner = "91000000-0000-4000-8000-000000000090";
  const expiryStartedAt = new Date("2026-09-03T01:05:00.000Z");
  const expiryAt = new Date("2026-09-03T01:05:01.000Z");
  const expiryDeadline = new Date("2026-09-03T01:08:00.000Z");
  async function createExpiryCase(index: number, reserveStep = false) {
    const suffix = String(90 + index).padStart(12, "0");
    const taskId = `41000000-0000-4000-8000-${suffix}`;
    const runId = `51000000-0000-4000-8000-${suffix}`;
    const created = await repository.createTaskWithInitialRun({
      ...createAInput,
      taskId,
      runId,
      clientRequestId: `91000000-0000-4000-8000-${suffix}`,
      requestFingerprint: (90 + index).toString(16).padStart(64, "0"),
      prompt: `Expired lease fencing case ${index}`,
      now: expiryStartedAt,
    });
    assert.equal(created.status, "created");
    await database.db
      .update(agentRuns)
      .set({
        status: "running",
        leaseOwnerId: expiryOwner,
        leaseGeneration: 1,
        leaseExpiresAt: expiryAt,
        startedAt: expiryStartedAt,
        deadlineAt: expiryDeadline,
        updatedAt: expiryStartedAt,
      })
      .where(eq(agentRuns.id, runId));
    const fence = { runId, leaseOwnerId: expiryOwner, leaseGeneration: 1 };
    let stepId: string | undefined;
    if (reserveStep) {
      stepId = `61000000-0000-4000-8000-${suffix}`;
      const reservedStep = await repository.reserveStep({
        ...fence,
        stepId,
        toolName: "search_arxiv",
        safeArguments: { query: `expiry case ${index}` },
        now: new Date(expiryAt.getTime() - 1),
      });
      assert.equal(reservedStep.status, "reserved");
    }
    return { fence, stepId };
  }

  const heartbeatExpiry = await createExpiryCase(1);
  assert.equal((await repository.heartbeatLease({
    ...heartbeatExpiry.fence,
    now: expiryAt,
    leaseDurationMs: 60_000,
  })).status, "stale");
  const reserveExpiry = await createExpiryCase(2);
  assert.equal((await repository.reserveStep({
    ...reserveExpiry.fence,
    stepId: "61000000-0000-4000-8000-000000000092",
    toolName: "search_arxiv",
    safeArguments: { query: "expired reserve" },
    now: expiryAt,
  })).status, "stale");
  const completeStepExpiry = await createExpiryCase(3, true);
  assert.equal((await repository.completeToolStepWithEvidence({
    ...completeStepExpiry.fence,
    stepId: completeStepExpiry.stepId!,
    observation: { resultCount: 0 },
    evidence: [],
    contextBytes: 0,
    now: expiryAt,
  })).status, "stale");
  const failStepExpiry = await createExpiryCase(4, true);
  assert.equal((await repository.failStep({
    ...failStepExpiry.fence,
    stepId: failStepExpiry.stepId!,
    errorCode: "agent_tool_timeout",
    contextBytes: 0,
    now: expiryAt,
  })).status, "stale");
  const completeRunExpiry = await createExpiryCase(5);
  assert.equal((await repository.completeRun({
    ...completeRunExpiry.fence,
    finalStepId: "61000000-0000-4000-8000-000000000095",
    finalResult: {
      status: "insufficient_context",
      answer: "Insufficient context.",
      evidenceIds: [],
    },
    now: expiryAt,
  })).status, "stale");
  const failRunExpiry = await createExpiryCase(6);
  assert.equal((await repository.failRun({
    ...failRunExpiry.fence,
    errorCode: "agent_provider_unavailable",
    now: new Date(expiryAt.getTime() + 1),
  })).status, "stale");
  pass("Repository rejects every ordinary execution write at or after lease expiry");

  const cancellationPriority = await createExpiryCase(7);
  const cancellationRequested = await repository.cancelRun(
    cancellationPriority.fence.runId,
    OWNER_ID,
    new Date(expiryAt.getTime() - 1),
  );
  assert.equal(cancellationRequested.status, "cancellation_requested");
  assert.equal((await repository.reserveStep({
    ...cancellationPriority.fence,
    stepId: "61000000-0000-4000-8000-000000000097",
    toolName: "search_arxiv",
    safeArguments: { query: "cancellation priority" },
    now: expiryAt,
  })).status, "cancel_requested");

  const accessPriority = await createExpiryCase(8);
  await database.db
    .delete(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, OTHER_SPACE_ID), eq(spaceMembers.userId, OWNER_ID)));
  assert.equal((await repository.reserveStep({
    ...accessPriority.fence,
    stepId: "61000000-0000-4000-8000-000000000098",
    toolName: "search_arxiv",
    safeArguments: { query: "access priority" },
    now: expiryAt,
  })).status, "access_revoked");
  await database.db.insert(spaceMembers).values({
    spaceId: OTHER_SPACE_ID,
    userId: OWNER_ID,
    role: "owner",
    joinedAt: BASE_TIME,
  });

  const deadlinePriority = await createExpiryCase(9);
  await database.db
    .update(agentRuns)
    .set({ deadlineAt: expiryAt })
    .where(eq(agentRuns.id, deadlinePriority.fence.runId));
  assert.equal((await repository.reserveStep({
    ...deadlinePriority.fence,
    stepId: "61000000-0000-4000-8000-000000000099",
    toolName: "search_arxiv",
    safeArguments: { query: "deadline priority" },
    now: expiryAt,
  })).status, "deadline_exceeded");
  pass("Repository preserves cancellation, access, and deadline priority over expiry");

  await database.db.delete(researchSpaces).where(eq(researchSpaces.id, OTHER_SPACE_ID));
  const [repositoryTasks] = await database.db.select({ count: count() }).from(agentTasks);
  assert.equal(repositoryTasks.count, 0);
  pass("Repository Space cascade cleanup");
}

async function runExecutorSmoke(): Promise<void> {
  const repository = createDrizzleAgentRepository(database);
  const executorSpaceId = "22000000-0000-4000-8000-000000000001";
  let clock = new Date("2026-09-03T02:00:00.000Z");
  let idCounter = 0;
  const nextId = () => {
    idCounter += 1;
    return `a2000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
  };

  await database.db.insert(researchSpaces).values({
    id: executorSpaceId,
    name: "Phase 9 Executor Space",
    description: null,
    ownerId: OWNER_ID,
    createdAt: clock,
    updatedAt: clock,
  });
  await database.db.insert(spaceMembers).values({
    spaceId: executorSpaceId,
    userId: OWNER_ID,
    role: "owner",
    joinedAt: clock,
  });

  async function createAndClaim(index: number, leaseDurationMs = 60_000) {
    const suffix = String(index).padStart(12, "0");
    const taskId = `42000000-0000-4000-8000-${suffix}`;
    const runId = `52000000-0000-4000-8000-${suffix}`;
    const created = await repository.createTaskWithInitialRun({
      taskId,
      runId,
      spaceId: executorSpaceId,
      agentId: AGENT_ID,
      actorUserId: OWNER_ID,
      prompt: `Executor smoke task ${index}`,
      clientRequestId: `92000000-0000-4000-8000-${suffix}`,
      requestFingerprint: index.toString(16).padStart(64, "0"),
      providerModel: "phase9-executor-smoke",
      now: clock,
    });
    assert.equal(created.status, "created");
    const claimed = await repository.claimRun({
      leaseOwnerId: `93000000-0000-4000-8000-${suffix}`,
      now: clock,
      leaseDurationMs,
    });
    assert.equal(claimed.status, "claimed");
    if (claimed.status !== "claimed") throw new Error("Expected Executor smoke claim.");
    assert.equal(claimed.claim.run.id, runId);
    return claimed.claim;
  }

  function registry(onExecute?: () => Promise<void>) {
    return createAgentToolRegistry([{
      name: "search_arxiv",
      description: "Deterministic read-only Executor smoke Tool.",
      argumentsSchema: z.object({ query: z.string().trim().min(1) }).strict(),
      resultSchema: agentToolExecutionResultSchema,
      isAvailable: () => true,
      execute: async () => {
        await onExecute?.();
        return {
          observation: { resultCount: 1, source: "deterministic-smoke" },
          evidence: [{
            kind: "arxiv_abstract" as const,
            paperId: null,
            canonicalArxivId: "2609.12345",
            versionedArxivId: "2609.12345v1",
            sourceVersion: 1,
            title: "Executor Boundary Smoke",
            url: "https://arxiv.org/abs/2609.12345v1",
            excerpt: "Deterministic local evidence for the Executor smoke.",
          }],
        };
      },
    }]);
  }

  function executor(input: {
    decisions: AgentDecision[];
    repository?: Parameters<typeof createAgentRunExecutor>[0]["repository"];
    toolRegistry?: ReturnType<typeof registry>;
    observedInputs?: AgentDecisionProviderInput[];
  }) {
    const decisions = [...input.decisions];
    return createAgentRunExecutor({
      repository: input.repository ?? repository,
      toolRegistry: input.toolRegistry ?? registry(),
      decisionProvider: {
        model: "phase9-executor-smoke",
        decide: (providerInput) => {
          input.observedInputs?.push(providerInput);
          const decision = decisions.shift();
          if (!decision) throw new Error("Missing scripted Executor smoke decision.");
          return Promise.resolve(decision);
        },
      },
      now: () => clock,
      createId: nextId,
    });
  }

  const toolDecision: AgentDecision = {
    kind: "tool_call",
    toolName: "search_arxiv",
    arguments: { query: "executor smoke" },
  };
  const finalDecision: AgentDecision = {
    kind: "final_answer",
    result: { status: "answered", answer: "Executor result [E1]", evidenceIds: ["E1"] },
  };
  const insufficientDecision: AgentDecision = {
    kind: "final_answer",
    result: {
      status: "insufficient_context",
      answer: "Insufficient context.",
      evidenceIds: [],
    },
  };

  const successClaim = await createAndClaim(1);
  const observedInputs: AgentDecisionProviderInput[] = [];
  const successExecutor = executor({
    decisions: [toolDecision, finalDecision],
    observedInputs,
  });
  const success = await successExecutor.execute({
    runId: successClaim.run.id,
    leaseOwnerId: successClaim.run.leaseOwnerId!,
    leaseGeneration: successClaim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.equal(success.status, "completed");
  const successTrace = await repository.readRunTraceForMember(successClaim.run.id, OWNER_ID);
  assert.equal(successTrace.status, "ok");
  if (successTrace.status !== "ok") throw new Error("Expected completed Executor trace.");
  assert.deepEqual(successTrace.record.steps.map((step) => step.kind), ["tool_call", "final_answer"]);
  assert.deepEqual(successTrace.record.evidence.map((item) => item.evidenceKey), ["E1"]);
  assert.equal(
    successTrace.record.run.contextBytes,
    new TextEncoder().encode(JSON.stringify(observedInputs[1]?.context)).byteLength,
  );
  const duplicate = await successExecutor.execute({
    runId: successClaim.run.id,
    leaseOwnerId: successClaim.run.leaseOwnerId!,
    leaseGeneration: successClaim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.equal(duplicate.status, "stale");
  const duplicateTrace = await repository.readRunTraceForMember(successClaim.run.id, OWNER_ID);
  assert.equal(duplicateTrace.status, "ok");
  if (duplicateTrace.status === "ok") assert.equal(duplicateTrace.record.steps.length, 2);
  pass("Executor success, context accounting, and single durable final publication");

  clock = new Date("2026-09-03T02:01:00.000Z");
  const cancellationClaim = await createAndClaim(2);
  const cancellationRegistry = registry(async () => {
    const requested = await repository.cancelRun(cancellationClaim.run.id, OWNER_ID, clock);
    assert.equal(requested.status, "cancellation_requested");
  });
  const cancellationExecutor = executor({
    decisions: [toolDecision],
    toolRegistry: cancellationRegistry,
  });
  const cancellation = await cancellationExecutor.execute({
    runId: cancellationClaim.run.id,
    leaseOwnerId: cancellationClaim.run.leaseOwnerId!,
    leaseGeneration: cancellationClaim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.equal(cancellation.status, "cancelled");
  const cancellationTrace = await repository.readRunTraceForMember(
    cancellationClaim.run.id,
    OWNER_ID,
  );
  assert.equal(cancellationTrace.status, "ok");
  if (cancellationTrace.status === "ok") {
    assert.deepEqual(cancellationTrace.record.steps.map((step) => step.status), ["cancelled"]);
    assert.deepEqual(cancellationTrace.record.evidence, []);
    assert.equal(cancellationTrace.record.run.contextBytes, 0);
  }
  pass("Executor cancellation after Tool return discards observation and Evidence");

  clock = new Date("2026-09-03T02:02:00.000Z");
  const staleClaim = await createAndClaim(3, 1_000);
  clock = new Date(clock.getTime() + 2_000);
  const replacement = await repository.claimRun({
    leaseOwnerId: "93000000-0000-4000-8000-000000000099",
    now: clock,
    leaseDurationMs: 60_000,
  });
  assert.equal(replacement.status, "claimed");
  if (replacement.status !== "claimed") throw new Error("Expected replacement claim.");
  assert.equal(replacement.claim.run.id, staleClaim.run.id);
  assert.equal(replacement.claim.run.leaseGeneration, staleClaim.run.leaseGeneration + 1);
  const staleResult = await executor({ decisions: [insufficientDecision] }).execute({
    runId: staleClaim.run.id,
    leaseOwnerId: staleClaim.run.leaseOwnerId!,
    leaseGeneration: staleClaim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.equal(staleResult.status, "stale");
  const replacementFinish = await executor({ decisions: [insufficientDecision] }).execute({
    runId: replacement.claim.run.id,
    leaseOwnerId: replacement.claim.run.leaseOwnerId!,
    leaseGeneration: replacement.claim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.equal(replacementFinish.status, "completed");
  pass("Executor rejects the old lease generation after a higher-generation claim");

  clock = new Date("2026-09-03T02:03:00.000Z");
  const recoveryClaim = await createAndClaim(4, 1_000);
  const recoveryStepId = "62000000-0000-4000-8000-000000000004";
  const reserved = await repository.reserveStep({
    runId: recoveryClaim.run.id,
    leaseOwnerId: recoveryClaim.run.leaseOwnerId!,
    leaseGeneration: recoveryClaim.run.leaseGeneration,
    stepId: recoveryStepId,
    toolName: "search_arxiv",
    safeArguments: { query: "recover same step" },
    now: clock,
  });
  assert.equal(reserved.status, "reserved");
  clock = new Date(clock.getTime() + 2_000);
  const recoveryReclaim = await repository.claimRun({
    leaseOwnerId: "93000000-0000-4000-8000-000000000104",
    now: clock,
    leaseDurationMs: 60_000,
  });
  assert.equal(recoveryReclaim.status, "claimed");
  if (recoveryReclaim.status !== "claimed") throw new Error("Expected recovery claim.");
  const recovery = await executor({ decisions: [finalDecision] }).execute({
    runId: recoveryReclaim.claim.run.id,
    leaseOwnerId: recoveryReclaim.claim.run.leaseOwnerId!,
    leaseGeneration: recoveryReclaim.claim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.equal(recovery.status, "completed");
  const recoveryTrace = await repository.readRunTraceForMember(
    recoveryReclaim.claim.run.id,
    OWNER_ID,
  );
  assert.equal(recoveryTrace.status, "ok");
  if (recoveryTrace.status === "ok") {
    const toolSteps = recoveryTrace.record.steps.filter((step) => step.kind === "tool_call");
    assert.equal(toolSteps.length, 1);
    assert.equal(toolSteps[0]?.id, recoveryStepId);
    assert.equal(toolSteps[0]?.executionCount, 2);
  }
  pass("Executor recovery reuses the same logical Tool Step and increments executionCount");

  clock = new Date("2026-09-03T02:04:00.000Z");
  const invalidClaim = await createAndClaim(5);
  const invalidFinal = await executor({ decisions: [finalDecision] }).execute({
    runId: invalidClaim.run.id,
    leaseOwnerId: invalidClaim.run.leaseOwnerId!,
    leaseGeneration: invalidClaim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.deepEqual(invalidFinal, {
    status: "failed",
    runId: invalidClaim.run.id,
    errorCode: "agent_invalid_final_answer",
  });
  const invalidRecord = await repository.readRunForMember(invalidClaim.run.id, OWNER_ID);
  assert.equal(invalidRecord.status, "ok");
  if (invalidRecord.status === "ok") {
    assert.equal(invalidRecord.record.record.errorCode, "agent_invalid_final_answer");
    assert.deepEqual(invalidRecord.record.finalEvidenceIds, []);
  }
  pass("Executor live Evidence validation rejects absent and cross-Run Evidence identifiers");

  clock = new Date("2026-09-03T02:05:00.000Z");
  const failedEvidenceClaim = await createAndClaim(6);
  const failedStepId = "62000000-0000-4000-8000-000000000006";
  const failedReserved = await repository.reserveStep({
    runId: failedEvidenceClaim.run.id,
    leaseOwnerId: failedEvidenceClaim.run.leaseOwnerId!,
    leaseGeneration: failedEvidenceClaim.run.leaseGeneration,
    stepId: failedStepId,
    toolName: "search_arxiv",
    safeArguments: { query: "failed evidence origin" },
    now: clock,
  });
  assert.equal(failedReserved.status, "reserved");
  const failedContextBytes = new TextEncoder().encode(
    JSON.stringify({ taskPrompt: failedEvidenceClaim.task.prompt, completedToolCalls: [] }),
  ).byteLength;
  const failedStep = await repository.failStep({
    runId: failedEvidenceClaim.run.id,
    leaseOwnerId: failedEvidenceClaim.run.leaseOwnerId!,
    leaseGeneration: failedEvidenceClaim.run.leaseGeneration,
    stepId: failedStepId,
    errorCode: "research_upstream_timeout",
    contextBytes: failedContextBytes,
    now: clock,
  });
  assert.equal(failedStep.status, "failed");
  await database.db.insert(agentRunEvidence).values({
    id: "a3000000-0000-4000-8000-000000000006",
    runId: failedEvidenceClaim.run.id,
    stepId: failedStepId,
    evidenceKey: "E1",
    kind: "arxiv_abstract",
    paperId: null,
    canonicalArxivId: "2609.54321",
    versionedArxivId: "2609.54321v1",
    sourceVersion: 1,
    sourceTitle: "Invalid Failed Origin",
    sourceUrl: "https://arxiv.org/abs/2609.54321v1",
    excerpt: "Must not become final Evidence.",
    createdAt: clock,
  });
  const failedOrigin = await executor({ decisions: [finalDecision] }).execute({
    runId: failedEvidenceClaim.run.id,
    leaseOwnerId: failedEvidenceClaim.run.leaseOwnerId!,
    leaseGeneration: failedEvidenceClaim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.deepEqual(failedOrigin, {
    status: "failed",
    runId: failedEvidenceClaim.run.id,
    errorCode: "agent_persistence_failed",
  });
  pass("Executor rejects Evidence originating from a failed Tool Step");

  clock = new Date("2026-09-03T02:06:00.000Z");
  const completionRaceClaim = await createAndClaim(7);
  const completionRaceRepository = {
    ...repository,
    completeToolStepWithEvidence: async (
      input: Parameters<typeof repository.completeToolStepWithEvidence>[0],
    ) => {
      await database.db
        .delete(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, executorSpaceId),
            eq(spaceMembers.userId, OWNER_ID),
          ),
        );
      return repository.completeToolStepWithEvidence(input);
    },
  };
  const completionRace = await executor({
    decisions: [toolDecision],
    repository: completionRaceRepository,
  }).execute({
    runId: completionRaceClaim.run.id,
    leaseOwnerId: completionRaceClaim.run.leaseOwnerId!,
    leaseGeneration: completionRaceClaim.run.leaseGeneration,
    signal: new AbortController().signal,
  });
  assert.deepEqual(completionRace, {
    status: "failed",
    runId: completionRaceClaim.run.id,
    errorCode: "agent_space_access_revoked",
  });
  const [completionRaceRun] = await database.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, completionRaceClaim.run.id));
  const [completionRaceStep] = await database.db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, completionRaceClaim.run.id));
  assert.equal(completionRaceRun?.status, "failed");
  assert.equal(completionRaceRun?.errorCode, "agent_space_access_revoked");
  assert.equal(completionRaceStep?.status, "failed");
  assert.equal(completionRaceStep?.errorCode, "agent_space_access_revoked");
  pass("Executor durably terminalizes an access revocation at Tool completion");

  await database.db.delete(researchSpaces).where(eq(researchSpaces.id, executorSpaceId));
}

async function runWorkerSmoke(): Promise<void> {
  const repository = createDrizzleAgentRepository(database);
  const workerSpaceId = "23000000-0000-4000-8000-000000000001";
  const workerLogger = pino({ level: "silent" });
  const workerTiming = {
    idlePollMs: 20,
    leaseDurationMs: 400,
    heartbeatIntervalMs: 50,
    heartbeatRetryMs: 20,
    leaseSafetyMarginMs: 100,
    shutdownGraceMs: 100,
    shutdownSettleMs: 100,
  } as const;
  let generatedId = 0;
  const nextExecutionId = () => {
    generatedId += 1;
    return `a4000000-0000-4000-8000-${String(generatedId).padStart(12, "0")}`;
  };

  await database.db.insert(researchSpaces).values({
    id: workerSpaceId,
    name: "Phase 9 Worker Space",
    description: null,
    ownerId: OWNER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await database.db.insert(spaceMembers).values({
    spaceId: workerSpaceId,
    userId: OWNER_ID,
    role: "owner",
    joinedAt: new Date(),
  });

  async function createWorkerRun(index: number) {
    const suffix = String(index).padStart(12, "0");
    const runId = `53000000-0000-4000-8000-${suffix}`;
    const created = await repository.createTaskWithInitialRun({
      taskId: `43000000-0000-4000-8000-${suffix}`,
      runId,
      spaceId: workerSpaceId,
      agentId: AGENT_ID,
      actorUserId: OWNER_ID,
      prompt: `Worker smoke task ${index}`,
      clientRequestId: `94000000-0000-4000-8000-${suffix}`,
      requestFingerprint: (200 + index).toString(16).padStart(64, "0"),
      providerModel: "phase9-worker-smoke",
      now: new Date(),
    });
    assert.equal(created.status, "created");
    return runId;
  }

  function workerRegistry(input?: {
    onExecute?: (signal: AbortSignal) => Promise<void>;
    withEvidence?: boolean;
  }) {
    return createAgentToolRegistry([{
      name: "search_arxiv",
      description: "Deterministic read-only Worker smoke Tool.",
      argumentsSchema: z.object({ query: z.string().trim().min(1) }).strict(),
      resultSchema: agentToolExecutionResultSchema,
      isAvailable: () => true,
      execute: async ({ signal }) => {
        await input?.onExecute?.(signal);
        return {
          observation: { resultCount: input?.withEvidence ? 1 : 0 },
          evidence: input?.withEvidence
            ? [{
                kind: "arxiv_abstract" as const,
                paperId: null,
                canonicalArxivId: "2609.67890",
                versionedArxivId: "2609.67890v1",
                sourceVersion: 1,
                title: "Worker Core Boundary Smoke",
                url: "https://arxiv.org/abs/2609.67890v1",
                excerpt: "Durable evidence published through the Worker and Executor boundary.",
              }]
            : [],
        };
      },
    }]);
  }

  function workerExecutor(
    decisions: AgentDecision[],
    toolRegistry = workerRegistry(),
  ) {
    const scripted = [...decisions];
    return createAgentRunExecutor({
      repository,
      toolRegistry,
      decisionProvider: {
        model: "phase9-worker-smoke",
        decide: () => {
          const decision = scripted.shift();
          if (!decision) throw new Error("Missing scripted Worker smoke decision.");
          return Promise.resolve(decision);
        },
      },
      now: () => new Date(),
      createId: nextExecutionId,
    });
  }

  async function waitForRunStatus(runId: string, status: "completed" | "cancelled") {
    const timeoutAt = Date.now() + 5_000;
    while (Date.now() < timeoutAt) {
      const record = await repository.readRunForMember(runId, OWNER_ID);
      if (record.status === "ok" && record.record.record.status === status) return record.record;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Worker smoke Run ${runId} did not reach ${status}.`);
  }

  const toolDecision: AgentDecision = {
    kind: "tool_call",
    toolName: "search_arxiv",
    arguments: { query: "worker heartbeat" },
  };
  const answeredDecision: AgentDecision = {
    kind: "final_answer",
    result: { status: "answered", answer: "Worker result [E1]", evidenceIds: ["E1"] },
  };
  const insufficientDecision: AgentDecision = {
    kind: "final_answer",
    result: {
      status: "insufficient_context",
      answer: "Insufficient context.",
      evidenceIds: [],
    },
  };

  const heartbeatRunId = await createWorkerRun(1);
  let releaseHeartbeatTool!: () => void;
  let markHeartbeatToolStarted!: () => void;
  const heartbeatToolStarted = new Promise<void>((resolve) => {
    markHeartbeatToolStarted = resolve;
  });
  const heartbeatToolRelease = new Promise<void>((resolve) => {
    releaseHeartbeatTool = resolve;
  });
  let heartbeatCount = 0;
  const heartbeatRepository = {
    claimRun: (input: Parameters<typeof repository.claimRun>[0]) => repository.claimRun(input),
    heartbeatLease: async (input: Parameters<typeof repository.heartbeatLease>[0]) => {
      heartbeatCount += 1;
      return repository.heartbeatLease(input);
    },
  };
  const heartbeatWorker = createAgentWorker({
    repository: heartbeatRepository,
    executor: workerExecutor(
      [toolDecision, answeredDecision],
      workerRegistry({
        withEvidence: true,
        onExecute: async () => {
          markHeartbeatToolStarted();
          await heartbeatToolRelease;
        },
      }),
    ),
    logger: workerLogger,
    timing: workerTiming,
    createId: () => "95000000-0000-4000-8000-000000000001",
  });
  await heartbeatWorker.start();
  await heartbeatToolStarted;
  const heartbeatsAtToolStart = heartbeatCount;
  await new Promise<void>((resolve) => setTimeout(resolve, 130));
  assert(heartbeatCount > heartbeatsAtToolStart, "Periodic heartbeat must run during unresolved Tool I/O.");
  releaseHeartbeatTool();
  const heartbeatCompleted = await waitForRunStatus(heartbeatRunId, "completed");
  await heartbeatWorker.stop();
  assert.deepEqual(heartbeatCompleted.finalEvidenceIds, ["E1"]);
  pass("Worker claims and completes a real Executor chain while heartbeating unresolved I/O");

  const cancellationRunId = await createWorkerRun(2);
  let markCancellationToolStarted!: () => void;
  const cancellationToolStarted = new Promise<void>((resolve) => {
    markCancellationToolStarted = resolve;
  });
  const cancellationWorker = createAgentWorker({
    repository,
    executor: workerExecutor(
      [toolDecision],
      workerRegistry({
        onExecute: (signal) =>
          new Promise<void>((_resolve, reject) => {
            markCancellationToolStarted();
            signal.addEventListener(
              "abort",
              () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted")),
              { once: true },
            );
          }),
      }),
    ),
    logger: workerLogger,
    timing: workerTiming,
    createId: () => "95000000-0000-4000-8000-000000000002",
  });
  await cancellationWorker.start();
  await cancellationToolStarted;
  const requested = await repository.cancelRun(cancellationRunId, OWNER_ID, new Date());
  assert.equal(requested.status, "cancellation_requested");
  const cancelled = await waitForRunStatus(cancellationRunId, "cancelled");
  await cancellationWorker.stop();
  assert.deepEqual(cancelled.finalEvidenceIds, []);
  pass("Worker observes durable cancellation by heartbeat and prevents late publication");

  const recoveryRunId = await createWorkerRun(3);
  let recoveryClaim: Awaited<ReturnType<typeof repository.claimRun>> | undefined;
  let markRecoveryToolStarted!: () => void;
  const recoveryToolStarted = new Promise<void>((resolve) => {
    markRecoveryToolStarted = resolve;
  });
  const firstRecoveryWorker = createAgentWorker({
    repository: {
      claimRun: async (input) => {
        const result = await repository.claimRun(input);
        recoveryClaim = result;
        return result;
      },
      heartbeatLease: (input) => repository.heartbeatLease(input),
    },
    executor: workerExecutor(
      [toolDecision],
      workerRegistry({
        onExecute: (signal) =>
          new Promise<void>((_resolve, reject) => {
            markRecoveryToolStarted();
            signal.addEventListener(
              "abort",
              () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted")),
              { once: true },
            );
          }),
      }),
    ),
    logger: workerLogger,
    timing: workerTiming,
    createId: () => "95000000-0000-4000-8000-000000000003",
  });
  await firstRecoveryWorker.start();
  await recoveryToolStarted;
  await firstRecoveryWorker.stop();
  assert.equal(recoveryClaim?.status, "claimed");
  if (!recoveryClaim || recoveryClaim.status !== "claimed") {
    throw new Error("Expected the first recovery Worker claim.");
  }
  const firstGeneration = recoveryClaim.claim.run.leaseGeneration;
  const firstStep = recoveryClaim.claim.incompleteToolStep ??
    (await database.db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.runId, recoveryRunId)))[0];
  assert(firstStep);
  await new Promise<void>((resolve) => setTimeout(resolve, workerTiming.leaseDurationMs + 100));
  assert.equal((await repository.heartbeatLease({
    runId: recoveryRunId,
    leaseOwnerId: recoveryClaim.claim.run.leaseOwnerId!,
    leaseGeneration: firstGeneration,
    now: new Date(),
    leaseDurationMs: workerTiming.leaseDurationMs,
  })).status, "stale");
  assert.equal((await repository.completeToolStepWithEvidence({
    runId: recoveryRunId,
    leaseOwnerId: recoveryClaim.claim.run.leaseOwnerId!,
    leaseGeneration: firstGeneration,
    stepId: firstStep.id,
    observation: { resultCount: 0 },
    evidence: [],
    contextBytes: 0,
    now: new Date(),
  })).status, "stale");

  let replacementGeneration = 0;
  const replacementWorker = createAgentWorker({
    repository: {
      claimRun: async (input) => {
        const result = await repository.claimRun(input);
        if (result.status === "claimed") replacementGeneration = result.claim.run.leaseGeneration;
        return result;
      },
      heartbeatLease: (input) => repository.heartbeatLease(input),
    },
    executor: workerExecutor([insufficientDecision], workerRegistry()),
    logger: workerLogger,
    timing: workerTiming,
    createId: () => "95000000-0000-4000-8000-000000000004",
  });
  await replacementWorker.start();
  await waitForRunStatus(recoveryRunId, "completed");
  await replacementWorker.stop();
  assert(replacementGeneration > firstGeneration);
  const recoveryTrace = await repository.readRunTraceForMember(recoveryRunId, OWNER_ID);
  assert.equal(recoveryTrace.status, "ok");
  if (recoveryTrace.status === "ok") {
    const toolSteps = recoveryTrace.record.steps.filter((step) => step.kind === "tool_call");
    assert.equal(toolSteps.length, 1);
    assert.equal(toolSteps[0]?.executionCount, 2);
  }
  pass("Worker shutdown leaves recovery to lease expiry and a higher-generation Worker resumes the Tool Step");

  const competitionRunId = await createWorkerRun(4);
  let durableExecutions = 0;
  const competitionExecutor = () => {
    const inner = workerExecutor([insufficientDecision]);
    return {
      execute: async (input: Parameters<typeof inner.execute>[0]) => {
        durableExecutions += 1;
        return inner.execute(input);
      },
    };
  };
  const competitorA = createAgentWorker({
    repository,
    executor: competitionExecutor(),
    logger: workerLogger,
    timing: workerTiming,
    createId: () => "95000000-0000-4000-8000-000000000005",
  });
  const competitorB = createAgentWorker({
    repository,
    executor: competitionExecutor(),
    logger: workerLogger,
    timing: workerTiming,
    createId: () => "95000000-0000-4000-8000-000000000006",
  });
  await Promise.all([competitorA.start(), competitorB.start()]);
  await waitForRunStatus(competitionRunId, "completed");
  await Promise.all([competitorA.stop(), competitorB.stop()]);
  assert.equal(durableExecutions, 1);
  pass("Two Workers competing for one Run produce one durable execution");

  await database.db.delete(researchSpaces).where(eq(researchSpaces.id, workerSpaceId));
}

async function runRuntimeLifecycleSmoke(): Promise<void> {
  const repository = createDrizzleAgentRepository(database);
  const runtimeSpaceId = "24000000-0000-4000-8000-000000000001";
  const runtimeLogger = pino({ level: "silent" });
  const decisions: AgentDecision[] = [
    {
      kind: "tool_call",
      toolName: "search_arxiv",
      arguments: { query: "runtime lifecycle" },
    },
    {
      kind: "final_answer",
      result: {
        status: "answered",
        answer: "Runtime lifecycle result [E1]",
        evidenceIds: ["E1"],
      },
    },
  ];
  const toolRegistry = createAgentToolRegistry([{
    name: "search_arxiv",
    description: "Deterministic read-only runtime lifecycle Tool.",
    argumentsSchema: z.object({ query: z.string().trim().min(1) }).strict(),
    resultSchema: agentToolExecutionResultSchema,
    isAvailable: () => true,
    execute: () => Promise.resolve({
      observation: { resultCount: 1 },
      evidence: [{
        kind: "arxiv_abstract" as const,
        paperId: null,
        canonicalArxivId: "2609.24680",
        versionedArxivId: "2609.24680v1",
        sourceVersion: 1,
        title: "Production Runtime Lifecycle Smoke",
        url: "https://arxiv.org/abs/2609.24680v1",
        excerpt: "Durable evidence created through the production runtime lifecycle boundary.",
      }],
    }),
  }]);
  const decisionProvider = {
    model: "phase9-runtime-smoke",
    decide: () => {
      const decision = decisions.shift();
      return decision
        ? Promise.resolve(decision)
        : Promise.reject(new Error("Missing scripted runtime lifecycle decision."));
    },
  };
  const executor = createAgentRunExecutor({
    repository,
    decisionProvider,
    toolRegistry,
  });
  const worker = createAgentWorker({
    repository,
    executor,
    logger: runtimeLogger,
    timing: {
      idlePollMs: 20,
      leaseDurationMs: 400,
      heartbeatIntervalMs: 50,
      heartbeatRetryMs: 20,
      leaseSafetyMarginMs: 100,
      shutdownGraceMs: 100,
      shutdownSettleMs: 100,
    },
    createId: () => "96000000-0000-4000-8000-000000000001",
  });
  const runtime = createAgentRuntime({
    configured: true,
    providerModel: decisionProvider.model,
    worker,
  });
  const service = createAgentService(repository, runtime);

  await database.db.insert(researchSpaces).values({
    id: runtimeSpaceId,
    name: "Phase 9 Runtime Lifecycle Space",
    description: null,
    ownerId: OWNER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await database.db.insert(spaceMembers).values({
    spaceId: runtimeSpaceId,
    userId: OWNER_ID,
    role: "owner",
    joinedAt: new Date(),
  });

  try {
    assert.deepEqual(runtime.getSnapshot(), {
      ready: false,
      reason: "runtime_unavailable",
    });
    await assert.rejects(
      service.createTask(runtimeSpaceId, OWNER_ID, {
        agentId: AGENT_ID,
        prompt: "Must not be accepted before runtime startup.",
        clientRequestId: "97000000-0000-4000-8000-000000000001",
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 503 &&
        error.code === "agent_runtime_unavailable",
    );

    await runtime.start();
    assert.deepEqual(runtime.getSnapshot(), {
      ready: true,
      providerModel: "phase9-runtime-smoke",
    });
    const created = await service.createTask(runtimeSpaceId, OWNER_ID, {
      agentId: AGENT_ID,
      prompt: "Exercise the production runtime lifecycle.",
      clientRequestId: "97000000-0000-4000-8000-000000000002",
    });
    assert.equal(created.created, true);

    const timeoutAt = Date.now() + 5_000;
    let completed = await service.getRun(created.run.id, OWNER_ID);
    while (completed.run.status !== "completed" && Date.now() < timeoutAt) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      completed = await service.getRun(created.run.id, OWNER_ID);
    }
    assert.equal(completed.run.status, "completed");
    assert.deepEqual(completed.run.finalResult, {
      status: "answered",
      answer: "Runtime lifecycle result [E1]",
      evidenceIds: ["E1"],
    });

    await runtime.stop();
    assert.deepEqual(runtime.getSnapshot(), {
      ready: false,
      reason: "runtime_unavailable",
    });
    await assert.rejects(
      service.createTask(runtimeSpaceId, OWNER_ID, {
        agentId: AGENT_ID,
        prompt: "Must not be accepted after runtime shutdown.",
        clientRequestId: "97000000-0000-4000-8000-000000000003",
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 503 &&
        error.code === "agent_runtime_unavailable",
    );
    pass("Agent Runtime lifecycle exposes live readiness and durably executes through AgentService");
  } finally {
    await runtime.stop();
    await database.db.delete(researchSpaces).where(eq(researchSpaces.id, runtimeSpaceId));
  }
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
  await runExecutorSmoke();
  await runWorkerSmoke();
  await runRuntimeLifecycleSmoke();
} finally {
  await database.close();
  await raw.end({ timeout: 5 });
  if (phase8MigrationsRoot) await rm(phase8MigrationsRoot, { recursive: true, force: true });
}
