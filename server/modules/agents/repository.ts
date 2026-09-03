import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
  agentErrorCodeSchema,
  agentEvidenceSchema,
  agentExecutionLimitsSchema,
  agentFinalResultSchema,
  agentObservationSchema,
  agentToolNameSchema,
  type AgentErrorCode,
  type AgentEvidence,
  type AgentExecutionLimits,
  type AgentFinalResult,
  type AgentObservation,
  type AgentRunStatus,
  type AgentToolName,
} from "../../../shared/contracts/agents";
import type { Database } from "../../db/client";
import {
  agentDefinitions,
  agentDefinitionTools,
  agentRunEvidence,
  agentRuns,
  agentRunSteps,
  agentTasks,
  documents,
  spaceMembers,
  type AgentDefinitionRecord,
  type AgentRunEvidenceRecord,
  type AgentRunRecord,
  type AgentRunStepRecord,
  type AgentTaskRecord,
} from "../../db/schema";

type JsonObject = Record<string, unknown>;
type TerminalRunStatus = Extract<AgentRunStatus, "completed" | "failed" | "cancelled">;

export interface AgentDefinitionWithTools {
  definition: AgentDefinitionRecord;
  tools: AgentToolName[];
  limits: AgentExecutionLimits;
}

export interface AgentRunPersistenceView {
  record: AgentRunRecord;
  finalEvidenceIds: string[];
}

export interface AgentFinalEvidenceReference {
  runId: string;
  evidenceKey: string;
  finalOrdinal: number;
}

export interface AgentTaskWithLatestRun {
  task: AgentTaskRecord;
  latestRun: AgentRunPersistenceView;
}

export interface AgentTaskWithRuns extends AgentTaskWithLatestRun {
  runs: AgentRunPersistenceView[];
}

export interface AgentRunTrace {
  run: AgentRunRecord;
  steps: AgentRunStepRecord[];
  evidence: AgentRunEvidenceRecord[];
}

export interface CreateAgentTaskRepositoryInput {
  taskId: string;
  runId: string;
  spaceId: string;
  agentId: string;
  actorUserId: string;
  prompt: string;
  clientRequestId: string;
  requestFingerprint: string;
  providerModel: string;
  now: Date;
}

export type CreateAgentTaskRepositoryResult =
  | { status: "created" | "existing"; task: AgentTaskRecord; run: AgentRunPersistenceView }
  | { status: "idempotency_conflict" | "space_not_found" | "agent_not_found" };

export interface CreateAgentRetryRepositoryInput {
  runId: string;
  taskId: string;
  actorUserId: string;
  clientRequestId: string;
  requestFingerprint: string;
  providerModel: string;
  now: Date;
}

export type CreateAgentRetryRepositoryResult =
  | { status: "created" | "existing"; run: AgentRunPersistenceView }
  | { status: "idempotency_conflict" | "retry_not_allowed" | "task_not_found" };

export interface AgentTaskCursorRecord {
  createdAt: Date;
  id: string;
}

export interface ListAgentTasksRepositoryInput {
  spaceId: string;
  actorUserId: string;
  cursor: AgentTaskCursorRecord | null;
  limit: number;
  status?: AgentRunStatus;
  agentId?: string;
}

export type ListAgentTasksRepositoryResult =
  | { status: "ok"; records: AgentTaskWithLatestRun[] }
  | { status: "space_not_found" };

export type ReadAgentTaskRepositoryResult =
  | { status: "ok"; record: AgentTaskWithRuns }
  | { status: "task_not_found" };

export type ReadAgentRunRepositoryResult =
  | { status: "ok"; record: AgentRunPersistenceView }
  | { status: "run_not_found" };

export type ReadAgentRunTraceRepositoryResult =
  | { status: "ok"; record: AgentRunTrace }
  | { status: "run_not_found" };

export interface ClaimAgentRunInput {
  leaseOwnerId: string;
  now: Date;
  leaseDurationMs: number;
}

export interface AgentRunClaim {
  task: AgentTaskRecord;
  run: AgentRunRecord;
  incompleteToolStep: AgentRunStepRecord | null;
}

export type ClaimAgentRunResult =
  | { status: "claimed"; claim: AgentRunClaim }
  | { status: "empty" };

export interface AgentWorkerFence {
  runId: string;
  leaseOwnerId: string;
  leaseGeneration: number;
}

export interface HeartbeatAgentLeaseInput extends AgentWorkerFence {
  now: Date;
  leaseDurationMs: number;
}

export type HeartbeatAgentLeaseResult =
  | { status: "updated"; leaseExpiresAt: Date }
  | { status: "stale" | "cancel_requested" };

export type CancelAgentRunRepositoryResult =
  | { status: "cancelled" | "cancellation_requested"; run: AgentRunPersistenceView }
  | { status: "terminal"; run: AgentRunPersistenceView; terminalStatus: TerminalRunStatus }
  | { status: "run_not_found" };

export interface ReserveAgentStepInput extends AgentWorkerFence {
  stepId: string;
  toolName: AgentToolName;
  safeArguments: JsonObject;
  now: Date;
  resumeStepId?: string;
}

export type ReserveAgentStepResult =
  | { status: "reserved" | "resumed"; step: AgentRunStepRecord; run: AgentRunRecord }
  | {
      status:
        | "stale"
        | "cancel_requested"
        | "deadline_exceeded"
        | "access_revoked"
        | "step_limit_exceeded"
        | "tool_call_limit_exceeded"
        | "incomplete_step";
    };

export type AgentEvidenceDraft =
  | {
      id?: string;
      kind: "arxiv_abstract";
      paperId: string | null;
      canonicalArxivId: string;
      versionedArxivId: string;
      sourceVersion: number;
      title: string;
      url: string;
      excerpt: string;
    }
  | {
      id?: string;
      kind: "knowledge_chunk";
      documentId: string | null;
      originalFilename: string;
      contentHash: string;
      ordinal: number;
      pageNumber: number | null;
      startOffset: number;
      endOffset: number;
      excerpt: string;
    };

export interface CompleteAgentToolStepInput extends AgentWorkerFence {
  stepId: string;
  observation: AgentObservation;
  evidence: AgentEvidenceDraft[];
  contextBytes: number;
  now: Date;
}

export type CompleteAgentToolStepResult =
  | {
      status: "completed";
      step: AgentRunStepRecord;
      evidence: AgentRunEvidenceRecord[];
      run: AgentRunRecord;
    }
  | {
      status:
        | "stale"
        | "cancel_requested"
        | "deadline_exceeded"
        | "access_revoked"
        | "observation_too_large"
        | "evidence_limit_exceeded"
        | "invalid_evidence"
        | "context_limit_exceeded";
    };

export interface FailAgentStepInput extends AgentWorkerFence {
  stepId: string;
  errorCode: AgentErrorCode;
  now: Date;
}

export type FailAgentStepResult =
  | { status: "failed"; step: AgentRunStepRecord }
  | { status: "stale" | "cancel_requested" | "deadline_exceeded" | "access_revoked" };

export interface CompleteAgentRunInput extends AgentWorkerFence {
  finalStepId: string;
  finalResult: AgentFinalResult;
  now: Date;
}

export type CompleteAgentRunResult =
  | { status: "completed"; run: AgentRunRecord; step: AgentRunStepRecord }
  | {
      status:
        | "stale"
        | "cancel_requested"
        | "deadline_exceeded"
        | "access_revoked"
        | "step_limit_exceeded"
        | "invalid_evidence";
    };

export interface FailAgentRunInput extends AgentWorkerFence {
  errorCode: AgentErrorCode;
  now: Date;
  decisionErrorStepId?: string;
}

export type FailAgentRunResult =
  | { status: "failed"; run: AgentRunRecord }
  | {
      status:
        | "stale"
        | "cancel_requested"
        | "deadline_exceeded"
        | "access_revoked"
        | "step_limit_exceeded";
    };

export interface MarkAgentRunCancelledInput extends AgentWorkerFence {
  now: Date;
}

export type MarkAgentRunCancelledResult =
  | { status: "cancelled"; run: AgentRunRecord }
  | { status: "stale" | "not_requested" };

export interface AgentRepository {
  findDefinition(agentId: string, spaceId: string | null): Promise<AgentDefinitionWithTools | null>;
  listDefinitions(spaceId: string | null): Promise<AgentDefinitionWithTools[]>;
  createTaskWithInitialRun(
    input: CreateAgentTaskRepositoryInput,
  ): Promise<CreateAgentTaskRepositoryResult>;
  createRetryRun(input: CreateAgentRetryRepositoryInput): Promise<CreateAgentRetryRepositoryResult>;
  readTaskForMember(
    taskId: string,
    actorUserId: string,
  ): Promise<ReadAgentTaskRepositoryResult>;
  listTasksForMember(
    input: ListAgentTasksRepositoryInput,
  ): Promise<ListAgentTasksRepositoryResult>;
  readRunForMember(runId: string, actorUserId: string): Promise<ReadAgentRunRepositoryResult>;
  readRunTraceForMember(
    runId: string,
    actorUserId: string,
  ): Promise<ReadAgentRunTraceRepositoryResult>;
  claimRun(input: ClaimAgentRunInput): Promise<ClaimAgentRunResult>;
  heartbeatLease(input: HeartbeatAgentLeaseInput): Promise<HeartbeatAgentLeaseResult>;
  cancelRun(
    runId: string,
    actorUserId: string,
    now: Date,
  ): Promise<CancelAgentRunRepositoryResult>;
  reserveStep(input: ReserveAgentStepInput): Promise<ReserveAgentStepResult>;
  completeToolStepWithEvidence(
    input: CompleteAgentToolStepInput,
  ): Promise<CompleteAgentToolStepResult>;
  failStep(input: FailAgentStepInput): Promise<FailAgentStepResult>;
  completeRun(input: CompleteAgentRunInput): Promise<CompleteAgentRunResult>;
  failRun(input: FailAgentRunInput): Promise<FailAgentRunResult>;
  markCancelled(input: MarkAgentRunCancelledInput): Promise<MarkAgentRunCancelledResult>;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function durationMs(startedAt: Date, completedAt: Date): number {
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

function serializedJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function elapsedStepDurationMs(now: Date) {
  return sql<number>`greatest(0, floor(extract(epoch from (${now.toISOString()}::timestamptz - ${agentRunSteps.startedAt})) * 1000)::integer)`;
}

export function calculateAgentLeaseExpiry(now: Date, duration: number, deadlineAt: Date): Date {
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new TypeError("Agent lease duration must be a positive integer number of milliseconds.");
  }
  return new Date(Math.min(now.getTime() + duration, deadlineAt.getTime()));
}

export type AgentWorkerWriteGuard =
  | "allowed"
  | "cancel_requested"
  | "deadline_exceeded"
  | "access_revoked";

export function classifyAgentWorkerWrite(
  run: Readonly<Pick<AgentRunRecord, "cancelRequestedAt" | "deadlineAt">>,
  hasMembership: boolean,
  now: Date,
): AgentWorkerWriteGuard {
  if (run.cancelRequestedAt) return "cancel_requested";
  if (!hasMembership) return "access_revoked";
  if (!run.deadlineAt || run.deadlineAt.getTime() <= now.getTime()) return "deadline_exceeded";
  return "allowed";
}

export function classifyAgentIdempotency(
  existingFingerprint: string,
  requestedFingerprint: string,
): "existing" | "idempotency_conflict" {
  return existingFingerprint === requestedFingerprint ? "existing" : "idempotency_conflict";
}

export function buildAgentRunPersistenceViews(
  records: readonly AgentRunRecord[],
  references: readonly AgentFinalEvidenceReference[],
): AgentRunPersistenceView[] {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  if (recordsById.size !== records.length) {
    throw new Error("Agent Run persistence view received duplicate Run records.");
  }

  const referencesByRun = new Map<string, AgentFinalEvidenceReference[]>();
  for (const reference of references) {
    if (!recordsById.has(reference.runId)) {
      throw new Error("Agent final Evidence reference belongs to an unknown Run.");
    }
    const runReferences = referencesByRun.get(reference.runId) ?? [];
    runReferences.push(reference);
    referencesByRun.set(reference.runId, runReferences);
  }

  return records.map((record) => {
    const runReferences = [...(referencesByRun.get(record.id) ?? [])].sort(
      (left, right) => left.finalOrdinal - right.finalOrdinal,
    );
    if (record.status !== "completed" && runReferences.length > 0) {
      throw new Error("A non-completed Agent Run cannot have final Evidence references.");
    }
    if (record.status === "completed") {
      if (record.finalStatus === "answered" && runReferences.length === 0) {
        throw new Error("An answered Agent Run requires final Evidence references.");
      }
      if (record.finalStatus === "insufficient_context" && runReferences.length > 0) {
        throw new Error("An insufficient-context Agent Run cannot have final Evidence references.");
      }
    }

    const evidenceKeys = new Set<string>();
    for (const [index, reference] of runReferences.entries()) {
      if (reference.finalOrdinal !== index + 1) {
        throw new Error("Agent final Evidence ordinals must form a contiguous one-based sequence.");
      }
      if (evidenceKeys.has(reference.evidenceKey)) {
        throw new Error("Agent final Evidence references must be unique within a Run.");
      }
      evidenceKeys.add(reference.evidenceKey);
    }
    return { record, finalEvidenceIds: runReferences.map((item) => item.evidenceKey) };
  });
}

function definitionLimits(record: AgentDefinitionRecord): AgentExecutionLimits {
  return agentExecutionLimitsSchema.parse(record.limitsJson);
}

function definitionTools(values: string[]): AgentToolName[] {
  return values.map((value) => agentToolNameSchema.parse(value));
}

function runSnapshotValues(
  definition: AgentDefinitionRecord,
  tools: AgentToolName[],
  providerModel: string,
) {
  const limits = definitionLimits(definition);
  return {
    definitionRevision: definition.revision,
    toolNames: tools,
    maxSteps: limits.maxSteps,
    maxToolCalls: limits.maxToolCalls,
    wallTimeSeconds: limits.wallTimeSeconds,
    providerDecisionTimeoutSeconds: limits.providerDecisionTimeoutSeconds,
    toolTimeoutSeconds: limits.toolTimeoutSeconds,
    providerAttempts: limits.providerAttempts,
    providerResponseMaxBytes: limits.providerResponseMaxBytes,
    observationMaxBytes: limits.observationMaxBytes,
    contextMaxBytes: limits.contextMaxBytes,
    finalAnswerMaxCharacters: limits.finalAnswerMaxCharacters,
    maxEvidence: limits.maxEvidence,
    promptVersion: definition.promptVersion,
    providerModel,
  };
}

function evidenceKey(ordinal: number): `E${number}` {
  return `E${ordinal}`;
}

function validateEvidenceDraft(draft: AgentEvidenceDraft, key: string, now: Date): void {
  const common = {
    id: draft.id ?? randomUUID(),
    runId: randomUUID(),
    stepId: randomUUID(),
    evidenceId: key,
    available: draft.kind === "arxiv_abstract" ? draft.paperId !== null : draft.documentId !== null,
    finalOrdinal: null,
    createdAt: now.toISOString(),
  };
  const value: AgentEvidence =
    draft.kind === "arxiv_abstract"
      ? { ...common, ...draft, id: common.id }
      : { ...common, ...draft, id: common.id };
  agentEvidenceSchema.parse(value);
}

export function createDrizzleAgentRepository(database: Database): AgentRepository {
  const db = database.db;

  async function loadRunPersistenceViews(
    executor: Pick<typeof db, "select">,
    records: readonly AgentRunRecord[],
  ): Promise<AgentRunPersistenceView[]> {
    if (records.length === 0) return [];
    const rows = await executor
      .select({
        runId: agentRunEvidence.runId,
        evidenceKey: agentRunEvidence.evidenceKey,
        finalOrdinal: agentRunEvidence.finalOrdinal,
      })
      .from(agentRunEvidence)
      .where(
        and(
          inArray(agentRunEvidence.runId, records.map((record) => record.id)),
          isNotNull(agentRunEvidence.finalOrdinal),
        ),
      )
      .orderBy(asc(agentRunEvidence.runId), asc(agentRunEvidence.finalOrdinal));
    const references = rows.map((row): AgentFinalEvidenceReference => {
      if (row.finalOrdinal === null) {
        throw new Error("Selected Agent final Evidence reference has no ordinal.");
      }
      return { ...row, finalOrdinal: row.finalOrdinal };
    });
    return buildAgentRunPersistenceViews(records, references);
  }

  async function loadRunPersistenceView(
    executor: Pick<typeof db, "select">,
    record: AgentRunRecord,
  ): Promise<AgentRunPersistenceView> {
    const [view] = await loadRunPersistenceViews(executor, [record]);
    if (!view) throw new Error("Agent Run persistence view returned no record.");
    return view;
  }

  async function loadDefinition(
    executor: Pick<typeof db, "select">,
    agentId: string,
    spaceId: string | null,
  ): Promise<AgentDefinitionWithTools | null> {
    const [definition] = await executor
      .select()
      .from(agentDefinitions)
      .where(
        and(
          eq(agentDefinitions.id, agentId),
          spaceId === null
            ? isNull(agentDefinitions.spaceId)
            : or(isNull(agentDefinitions.spaceId), eq(agentDefinitions.spaceId, spaceId)),
        ),
      )
      .limit(1)
      .for("share");
    if (!definition) return null;
    const toolRows = await executor
      .select({ toolName: agentDefinitionTools.toolName })
      .from(agentDefinitionTools)
      .where(eq(agentDefinitionTools.agentId, definition.id))
      .orderBy(asc(agentDefinitionTools.toolName));
    return {
      definition,
      tools: definitionTools(toolRows.map((row) => row.toolName)),
      limits: definitionLimits(definition),
    };
  }

  return {
    async findDefinition(agentId, spaceId) {
      return loadDefinition(db, agentId, spaceId);
    },

    async listDefinitions(spaceId) {
      const definitions = await db
        .select()
        .from(agentDefinitions)
        .where(
          spaceId === null
            ? isNull(agentDefinitions.spaceId)
            : or(isNull(agentDefinitions.spaceId), eq(agentDefinitions.spaceId, spaceId)),
        )
        .orderBy(asc(agentDefinitions.name), asc(agentDefinitions.id));
      if (definitions.length === 0) return [];
      const toolRows = await db
        .select()
        .from(agentDefinitionTools)
        .where(inArray(agentDefinitionTools.agentId, definitions.map((item) => item.id)))
        .orderBy(asc(agentDefinitionTools.toolName));
      const toolsByAgent = new Map<string, string[]>();
      for (const row of toolRows) {
        const tools = toolsByAgent.get(row.agentId) ?? [];
        tools.push(row.toolName);
        toolsByAgent.set(row.agentId, tools);
      }
      return definitions.map((definition) => ({
        definition,
        tools: definitionTools(toolsByAgent.get(definition.id) ?? []),
        limits: definitionLimits(definition),
      }));
    },

    async createTaskWithInitialRun(input) {
      return db.transaction(async (transaction): Promise<CreateAgentTaskRepositoryResult> => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.spaceId, input.spaceId),
              eq(spaceMembers.userId, input.actorUserId),
            ),
          )
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const [alreadyCreatedTask] = await transaction
          .select()
          .from(agentTasks)
          .where(
            and(
              eq(agentTasks.spaceId, input.spaceId),
              eq(agentTasks.createdByUserId, input.actorUserId),
              eq(agentTasks.clientRequestId, input.clientRequestId),
            ),
          )
          .limit(1);
        if (alreadyCreatedTask) {
          if (
            classifyAgentIdempotency(
              alreadyCreatedTask.requestFingerprint,
              input.requestFingerprint,
            ) === "idempotency_conflict"
          ) {
            return { status: "idempotency_conflict" };
          }
          const [alreadyCreatedRun] = await transaction
            .select()
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.taskId, alreadyCreatedTask.id),
                eq(agentRuns.attemptNumber, 1),
              ),
            )
            .limit(1)
            .for("share");
          if (!alreadyCreatedRun) throw new Error("Idempotent Agent task has no initial run.");
          return {
            status: "existing",
            task: alreadyCreatedTask,
            run: await loadRunPersistenceView(transaction, alreadyCreatedRun),
          };
        }

        const bundle = await loadDefinition(transaction, input.agentId, input.spaceId);
        if (!bundle || bundle.tools.length === 0) return { status: "agent_not_found" };

        const [createdTask] = await transaction
          .insert(agentTasks)
          .values({
            id: input.taskId,
            spaceId: input.spaceId,
            agentId: input.agentId,
            createdByUserId: input.actorUserId,
            prompt: input.prompt,
            clientRequestId: input.clientRequestId,
            requestFingerprint: input.requestFingerprint,
            createdAt: input.now,
          })
          .onConflictDoNothing({
            target: [agentTasks.spaceId, agentTasks.createdByUserId, agentTasks.clientRequestId],
          })
          .returning();

        if (!createdTask) {
          const [existingTask] = await transaction
            .select()
            .from(agentTasks)
            .where(
              and(
                eq(agentTasks.spaceId, input.spaceId),
                eq(agentTasks.createdByUserId, input.actorUserId),
                eq(agentTasks.clientRequestId, input.clientRequestId),
              ),
            )
            .limit(1);
          if (!existingTask) throw new Error("Agent task conflict returned no record.");
          if (
            classifyAgentIdempotency(existingTask.requestFingerprint, input.requestFingerprint) ===
            "idempotency_conflict"
          ) {
            return { status: "idempotency_conflict" };
          }
          const [existingRun] = await transaction
            .select()
            .from(agentRuns)
            .where(and(eq(agentRuns.taskId, existingTask.id), eq(agentRuns.attemptNumber, 1)))
            .limit(1)
            .for("share");
          if (!existingRun) throw new Error("Idempotent Agent task has no initial run.");
          return {
            status: "existing",
            task: existingTask,
            run: await loadRunPersistenceView(transaction, existingRun),
          };
        }

        const [createdRun] = await transaction
          .insert(agentRuns)
          .values({
            id: input.runId,
            taskId: createdTask.id,
            spaceId: createdTask.spaceId,
            actorUserId: input.actorUserId,
            attemptNumber: 1,
            ...runSnapshotValues(bundle.definition, bundle.tools, input.providerModel),
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        if (!createdRun) throw new Error("Agent initial run insert returned no record.");
        return {
          status: "created",
          task: createdTask,
          run: await loadRunPersistenceView(transaction, createdRun),
        };
      });
    },

    async createRetryRun(input) {
      return db.transaction(async (transaction): Promise<CreateAgentRetryRepositoryResult> => {
        const [task] = await transaction
          .select()
          .from(agentTasks)
          .where(eq(agentTasks.id, input.taskId))
          .limit(1)
          .for("update");
        if (!task) return { status: "task_not_found" };
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.spaceId, task.spaceId),
              eq(spaceMembers.userId, input.actorUserId),
            ),
          )
          .limit(1)
          .for("share");
        if (!membership) return { status: "task_not_found" };

        const [idempotentRun] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.taskId, input.taskId),
              eq(agentRuns.retryClientRequestId, input.clientRequestId),
            ),
          )
          .limit(1)
          .for("share");
        if (idempotentRun) {
          const status = classifyAgentIdempotency(
            idempotentRun.retryRequestFingerprint ?? "",
            input.requestFingerprint,
          );
          return status === "existing"
            ? {
                status,
                run: await loadRunPersistenceView(transaction, idempotentRun),
              }
            : { status };
        }

        const [latestRun] = await transaction
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.taskId, input.taskId))
          .orderBy(desc(agentRuns.attemptNumber))
          .limit(1);
        if (!latestRun) throw new Error("Agent task has no run.");
        if (!(["completed", "failed", "cancelled"] as AgentRunStatus[]).includes(latestRun.status)) {
          return { status: "retry_not_allowed" };
        }

        const bundle = await loadDefinition(transaction, task.agentId, task.spaceId);
        if (!bundle || bundle.tools.length === 0) return { status: "retry_not_allowed" };

        const [run] = await transaction
          .insert(agentRuns)
          .values({
            id: input.runId,
            taskId: input.taskId,
            spaceId: task.spaceId,
            actorUserId: input.actorUserId,
            attemptNumber: latestRun.attemptNumber + 1,
            retryClientRequestId: input.clientRequestId,
            retryRequestFingerprint: input.requestFingerprint,
            ...runSnapshotValues(bundle.definition, bundle.tools, input.providerModel),
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        if (!run) throw new Error("Agent retry run insert returned no record.");
        return {
          status: "created",
          run: await loadRunPersistenceView(transaction, run),
        };
      });
    },

    async readTaskForMember(taskId, actorUserId) {
      return db.transaction(async (transaction): Promise<ReadAgentTaskRepositoryResult> => {
        const [row] = await transaction
          .select({ task: agentTasks })
          .from(agentTasks)
          .innerJoin(
            spaceMembers,
            and(
              eq(spaceMembers.spaceId, agentTasks.spaceId),
              eq(spaceMembers.userId, actorUserId),
            ),
          )
          .where(eq(agentTasks.id, taskId))
          .limit(1)
          .for("share");
        if (!row) return { status: "task_not_found" };
        const runs = await transaction
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.taskId, taskId))
          .orderBy(asc(agentRuns.attemptNumber))
          .for("share");
        const runViews = await loadRunPersistenceViews(transaction, runs);
        const latestRun = runViews.at(-1);
        if (!latestRun) throw new Error("Agent task has no run.");
        return { status: "ok", record: { task: row.task, latestRun, runs: runViews } };
      });
    },

    async listTasksForMember(input) {
      return db.transaction(async (transaction): Promise<ListAgentTasksRepositoryResult> => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.spaceId, input.spaceId),
              eq(spaceMembers.userId, input.actorUserId),
            ),
          )
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const cursorCondition = input.cursor
          ? or(
              lt(agentTasks.createdAt, input.cursor.createdAt),
              and(
                eq(agentTasks.createdAt, input.cursor.createdAt),
                lt(agentTasks.id, input.cursor.id),
              ),
            )
          : undefined;
        const rows = await transaction
          .select({ task: agentTasks, latestRun: agentRuns })
          .from(agentTasks)
          .innerJoin(
            agentRuns,
            and(
              eq(agentRuns.taskId, agentTasks.id),
              sql`${agentRuns.attemptNumber} = (select max(latest_agent_run.attempt_number) from agent_runs latest_agent_run where latest_agent_run.task_id = ${agentTasks.id})`,
            ),
          )
          .where(
            and(
              eq(agentTasks.spaceId, input.spaceId),
              cursorCondition,
              input.status ? eq(agentRuns.status, input.status) : undefined,
              input.agentId ? eq(agentTasks.agentId, input.agentId) : undefined,
            ),
          )
          .orderBy(desc(agentTasks.createdAt), desc(agentTasks.id))
          .limit(input.limit)
          .for("share", { of: agentRuns });
        const runViews = await loadRunPersistenceViews(
          transaction,
          rows.map((row) => row.latestRun),
        );
        const runViewsById = new Map(runViews.map((view) => [view.record.id, view]));
        return {
          status: "ok",
          records: rows.map((row) => {
            const latestRun = runViewsById.get(row.latestRun.id);
            if (!latestRun) throw new Error("Agent Task list returned no latest Run view.");
            return { task: row.task, latestRun };
          }),
        };
      });
    },

    async readRunForMember(runId, actorUserId) {
      return db.transaction(async (transaction): Promise<ReadAgentRunRepositoryResult> => {
        const [row] = await transaction
          .select({ run: agentRuns })
          .from(agentRuns)
          .innerJoin(
            spaceMembers,
            and(
              eq(spaceMembers.spaceId, agentRuns.spaceId),
              eq(spaceMembers.userId, actorUserId),
            ),
          )
          .where(eq(agentRuns.id, runId))
          .limit(1)
          .for("share");
        return row
          ? { status: "ok", record: await loadRunPersistenceView(transaction, row.run) }
          : { status: "run_not_found" };
      });
    },

    async readRunTraceForMember(runId, actorUserId) {
      return db.transaction(async (transaction): Promise<ReadAgentRunTraceRepositoryResult> => {
        const [row] = await transaction
          .select({ run: agentRuns })
          .from(agentRuns)
          .innerJoin(
            spaceMembers,
            and(
              eq(spaceMembers.spaceId, agentRuns.spaceId),
              eq(spaceMembers.userId, actorUserId),
            ),
          )
          .where(eq(agentRuns.id, runId))
          .limit(1)
          .for("share");
        if (!row) return { status: "run_not_found" };
        const steps = await transaction
          .select()
          .from(agentRunSteps)
          .where(eq(agentRunSteps.runId, runId))
          .orderBy(asc(agentRunSteps.sequence));
        const evidence = await transaction
          .select()
          .from(agentRunEvidence)
          .where(eq(agentRunEvidence.runId, runId))
          .orderBy(sql`substring(${agentRunEvidence.evidenceKey} from 2)::integer`);
        return { status: "ok", record: { run: row.run, steps, evidence } };
      });
    },

    async claimRun(input) {
      return db.transaction(async (transaction): Promise<ClaimAgentRunResult> => {
        for (;;) {
          const [candidate] = await transaction
            .select()
            .from(agentRuns)
            .where(
              or(
                eq(agentRuns.status, "queued"),
                and(
                  eq(agentRuns.status, "running"),
                  lte(agentRuns.leaseExpiresAt, input.now),
                ),
              ),
            )
            .orderBy(asc(agentRuns.createdAt), asc(agentRuns.id))
            .limit(1)
            .for("update", { skipLocked: true });
          if (!candidate) return { status: "empty" };

          const [membership] = candidate.actorUserId
            ? await transaction
                .select({ userId: spaceMembers.userId })
                .from(spaceMembers)
                .where(
                  and(
                    eq(spaceMembers.spaceId, candidate.spaceId),
                    eq(spaceMembers.userId, candidate.actorUserId),
                  ),
                )
                .limit(1)
                .for("share")
            : [];
          const startedAt = candidate.startedAt ?? input.now;
          const deadlineAt =
            candidate.deadlineAt ??
            new Date(startedAt.getTime() + candidate.wallTimeSeconds * 1_000);
          const cancelled = candidate.cancelRequestedAt !== null;
          const timedOut = deadlineAt.getTime() <= input.now.getTime();

          if (cancelled || timedOut || !membership) {
            const terminalStatus = cancelled ? "cancelled" : "failed";
            const errorCode = !cancelled
              ? timedOut
                ? "agent_wall_time_exceeded"
                : "agent_space_access_revoked"
              : null;
            await transaction
              .update(agentRunSteps)
              .set({
                status: cancelled ? "cancelled" : "failed",
                errorCode,
                completedAt: input.now,
                durationMs: elapsedStepDurationMs(input.now),
              })
              .where(
                and(eq(agentRunSteps.runId, candidate.id), eq(agentRunSteps.status, "running")),
              );
            await transaction
              .update(agentRuns)
              .set({
                status: terminalStatus,
                startedAt,
                deadlineAt,
                finishedAt: input.now,
                errorCode,
                leaseOwnerId: null,
                leaseExpiresAt: null,
                updatedAt: input.now,
              })
              .where(eq(agentRuns.id, candidate.id));
            continue;
          }

          const generation = candidate.leaseGeneration + 1;
          const expiresAt = calculateAgentLeaseExpiry(input.now, input.leaseDurationMs, deadlineAt);
          const [run] = await transaction
            .update(agentRuns)
            .set({
              status: "running",
              startedAt,
              deadlineAt,
              leaseOwnerId: input.leaseOwnerId,
              leaseGeneration: generation,
              leaseExpiresAt: expiresAt,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, candidate.id))
            .returning();
          if (!run) continue;
          const [task] = await transaction
            .select()
            .from(agentTasks)
            .where(eq(agentTasks.id, run.taskId))
            .limit(1);
          if (!task) throw new Error("Claimed Agent run has no task.");
          const [incompleteToolStep] = await transaction
            .select()
            .from(agentRunSteps)
            .where(
              and(
                eq(agentRunSteps.runId, run.id),
                eq(agentRunSteps.kind, "tool_call"),
                eq(agentRunSteps.status, "running"),
              ),
            )
            .orderBy(desc(agentRunSteps.sequence))
            .limit(1);
          return {
            status: "claimed",
            claim: { task, run, incompleteToolStep: incompleteToolStep ?? null },
          };
        }
      });
    },

    async heartbeatLease(input) {
      return db.transaction(async (transaction): Promise<HeartbeatAgentLeaseResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .limit(1)
          .for("update");
        if (!run || !run.deadlineAt) return { status: "stale" };
        if (run.cancelRequestedAt) {
          await transaction
            .update(agentRunSteps)
            .set({
              status: "cancelled",
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "cancelled",
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: "cancel_requested" };
        }

        const [membership] = run.actorUserId
          ? await transaction
              .select({ userId: spaceMembers.userId })
              .from(spaceMembers)
              .where(
                and(
                  eq(spaceMembers.spaceId, run.spaceId),
                  eq(spaceMembers.userId, run.actorUserId),
                ),
              )
              .limit(1)
              .for("share")
          : [];
        if (!membership || run.deadlineAt.getTime() <= input.now.getTime()) {
          const errorCode = membership
            ? "agent_wall_time_exceeded"
            : "agent_space_access_revoked";
          await transaction
            .update(agentRunSteps)
            .set({
              status: "failed",
              errorCode,
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "failed",
              errorCode,
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: "stale" };
        }
        const expiresAt = calculateAgentLeaseExpiry(input.now, input.leaseDurationMs, run.deadlineAt);
        const updated = await transaction
          .update(agentRuns)
          .set({ leaseExpiresAt: expiresAt, updatedAt: input.now })
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .returning({ id: agentRuns.id });
        return updated.length === 1
          ? { status: "updated", leaseExpiresAt: expiresAt }
          : { status: "stale" };
      });
    },

    async cancelRun(runId, actorUserId, now) {
      return db.transaction(async (transaction): Promise<CancelAgentRunRepositoryResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.id, runId))
          .limit(1)
          .for("update");
        if (!run) return { status: "run_not_found" };
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.spaceId, run.spaceId),
              eq(spaceMembers.userId, actorUserId),
            ),
          )
          .limit(1)
          .for("share");
        if (!membership) return { status: "run_not_found" };
        if ((["completed", "failed", "cancelled"] as AgentRunStatus[]).includes(run.status)) {
          return {
            status: "terminal",
            run: await loadRunPersistenceView(transaction, run),
            terminalStatus: run.status as TerminalRunStatus,
          };
        }
        if (run.status === "queued") {
          const [cancelled] = await transaction
            .update(agentRuns)
            .set({
              status: "cancelled",
              cancelRequestedAt: now,
              cancelRequestedByUserId: actorUserId,
              finishedAt: now,
              updatedAt: now,
            })
            .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "queued")))
            .returning();
          if (!cancelled) throw new Error("Queued Agent cancellation returned no record.");
          return {
            status: "cancelled",
            run: await loadRunPersistenceView(transaction, cancelled),
          };
        }
        if (run.cancelRequestedAt) {
          return {
            status: "cancellation_requested",
            run: await loadRunPersistenceView(transaction, run),
          };
        }
        const [requested] = await transaction
          .update(agentRuns)
          .set({
            cancelRequestedAt: now,
            cancelRequestedByUserId: actorUserId,
            updatedAt: now,
          })
          .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")))
          .returning();
        if (!requested) throw new Error("Running Agent cancellation returned no record.");
        return {
          status: "cancellation_requested",
          run: await loadRunPersistenceView(transaction, requested),
        };
      });
    },

    async reserveStep(input) {
      return db.transaction(async (transaction): Promise<ReserveAgentStepResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .limit(1)
          .for("update");
        if (!run || !run.deadlineAt) return { status: "stale" };
        const [membership] = run.actorUserId
          ? await transaction
              .select({ userId: spaceMembers.userId })
              .from(spaceMembers)
              .where(
                and(
                  eq(spaceMembers.spaceId, run.spaceId),
                  eq(spaceMembers.userId, run.actorUserId),
                ),
              )
              .limit(1)
              .for("share")
          : [];
        const guard = classifyAgentWorkerWrite(run, Boolean(membership), input.now);
        if (guard === "cancel_requested") return { status: guard };
        if (guard === "access_revoked" || guard === "deadline_exceeded") {
          const errorCode = membership
            ? "agent_wall_time_exceeded"
            : "agent_space_access_revoked";
          await transaction
            .update(agentRunSteps)
            .set({
              status: "failed",
              errorCode,
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "failed",
              errorCode,
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: guard };
        }
        if (!isJsonObject(input.safeArguments)) throw new TypeError("Safe Agent arguments must be a JSON object.");
        agentToolNameSchema.parse(input.toolName);

        const [incomplete] = await transaction
          .select()
          .from(agentRunSteps)
          .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")))
          .orderBy(desc(agentRunSteps.sequence))
          .limit(1)
          .for("update");
        if (incomplete) {
          if (
            incomplete.id !== input.resumeStepId ||
            incomplete.kind !== "tool_call" ||
            incomplete.toolName !== input.toolName ||
            !isDeepStrictEqual(incomplete.safeArgumentsJson, input.safeArguments)
          ) {
            return { status: "incomplete_step" };
          }
          const [resumed] = await transaction
            .update(agentRunSteps)
            .set({ executionCount: incomplete.executionCount + 1, startedAt: input.now })
            .where(
              and(
                eq(agentRunSteps.id, incomplete.id),
                eq(agentRunSteps.runId, run.id),
                eq(agentRunSteps.status, "running"),
              ),
            )
            .returning();
          if (!resumed) return { status: "stale" };
          return { status: "resumed", step: resumed, run };
        }
        if (run.stepCount >= run.maxSteps) return { status: "step_limit_exceeded" };
        if (run.toolCallCount >= run.maxToolCalls) return { status: "tool_call_limit_exceeded" };
        const [step] = await transaction
          .insert(agentRunSteps)
          .values({
            id: input.stepId,
            runId: run.id,
            sequence: run.stepCount + 1,
            kind: "tool_call",
            status: "running",
            toolName: input.toolName,
            safeArgumentsJson: input.safeArguments,
            startedAt: input.now,
          })
          .returning();
        if (!step) throw new Error("Agent step insert returned no record.");
        const [updatedRun] = await transaction
          .update(agentRuns)
          .set({
            stepCount: run.stepCount + 1,
            toolCallCount: run.toolCallCount + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(agentRuns.id, run.id),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .returning();
        if (!updatedRun) throw new Error("Agent step counter update returned no record.");
        return { status: "reserved", step, run: updatedRun };
      });
    },

    async completeToolStepWithEvidence(input) {
      const observationResult = agentObservationSchema.safeParse(input.observation);
      if (!observationResult.success) return { status: "observation_too_large" };
      return db.transaction(async (transaction): Promise<CompleteAgentToolStepResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .limit(1)
          .for("update");
        if (!run || !run.deadlineAt) return { status: "stale" };
        const [membership] = run.actorUserId
          ? await transaction
              .select({ userId: spaceMembers.userId })
              .from(spaceMembers)
              .where(
                and(
                  eq(spaceMembers.spaceId, run.spaceId),
                  eq(spaceMembers.userId, run.actorUserId),
                ),
              )
              .limit(1)
              .for("share")
          : [];
        const guard = classifyAgentWorkerWrite(run, Boolean(membership), input.now);
        if (guard !== "allowed") return { status: guard };
        if (serializedJsonBytes(observationResult.data) > run.observationMaxBytes) {
          return { status: "observation_too_large" };
        }
        if (!Number.isInteger(input.contextBytes) || input.contextBytes < 0 || input.contextBytes > run.contextMaxBytes) {
          return { status: "context_limit_exceeded" };
        }

        const [step] = await transaction
          .select()
          .from(agentRunSteps)
          .where(
            and(
              eq(agentRunSteps.id, input.stepId),
              eq(agentRunSteps.runId, run.id),
              eq(agentRunSteps.kind, "tool_call"),
              eq(agentRunSteps.status, "running"),
            ),
          )
          .limit(1)
          .for("update");
        if (!step) return { status: "stale" };
        const [{ count: existingEvidenceCount }] = await transaction
          .select({ count: sql<number>`count(*)::integer` })
          .from(agentRunEvidence)
          .where(eq(agentRunEvidence.runId, run.id));
        if (existingEvidenceCount + input.evidence.length > run.maxEvidence) {
          return { status: "evidence_limit_exceeded" };
        }
        const documentIds = input.evidence
          .filter(
            (draft): draft is Extract<AgentEvidenceDraft, { kind: "knowledge_chunk" }> =>
              draft.kind === "knowledge_chunk" && draft.documentId !== null,
          )
          .map((draft) => draft.documentId!);
        if (documentIds.length > 0) {
          const authorizedDocuments = await transaction
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(
                inArray(documents.id, documentIds),
                eq(documents.spaceId, run.spaceId),
              ),
            );
          if (new Set(authorizedDocuments.map((item) => item.id)).size !== new Set(documentIds).size) {
            return { status: "invalid_evidence" };
          }
        }
        for (const [index, draft] of input.evidence.entries()) {
          validateEvidenceDraft(draft, evidenceKey(existingEvidenceCount + index + 1), input.now);
        }

        const [completedStep] = await transaction
          .update(agentRunSteps)
          .set({
            status: "completed",
            observationJson: observationResult.data,
            completedAt: input.now,
            durationMs: durationMs(step.startedAt, input.now),
          })
          .where(
            and(
              eq(agentRunSteps.id, step.id),
              eq(agentRunSteps.runId, run.id),
              eq(agentRunSteps.status, "running"),
            ),
          )
          .returning();
        if (!completedStep) return { status: "stale" };

        const evidenceValues = input.evidence.map((draft, index) => ({
          id: draft.id ?? randomUUID(),
          runId: run.id,
          stepId: step.id,
          evidenceKey: evidenceKey(existingEvidenceCount + index + 1),
          kind: draft.kind,
          paperId: draft.kind === "arxiv_abstract" ? draft.paperId : null,
          documentId: draft.kind === "knowledge_chunk" ? draft.documentId : null,
          canonicalArxivId: draft.kind === "arxiv_abstract" ? draft.canonicalArxivId : null,
          versionedArxivId: draft.kind === "arxiv_abstract" ? draft.versionedArxivId : null,
          sourceVersion: draft.kind === "arxiv_abstract" ? draft.sourceVersion : null,
          sourceTitle: draft.kind === "arxiv_abstract" ? draft.title : null,
          sourceUrl: draft.kind === "arxiv_abstract" ? draft.url : null,
          originalFilename: draft.kind === "knowledge_chunk" ? draft.originalFilename : null,
          contentHash: draft.kind === "knowledge_chunk" ? draft.contentHash : null,
          chunkOrdinal: draft.kind === "knowledge_chunk" ? draft.ordinal : null,
          pageNumber: draft.kind === "knowledge_chunk" ? draft.pageNumber : null,
          startOffset: draft.kind === "knowledge_chunk" ? draft.startOffset : null,
          endOffset: draft.kind === "knowledge_chunk" ? draft.endOffset : null,
          excerpt: draft.excerpt,
          createdAt: input.now,
        }));
        const evidence =
          evidenceValues.length > 0
            ? await transaction.insert(agentRunEvidence).values(evidenceValues).returning()
            : [];
        const [updatedRun] = await transaction
          .update(agentRuns)
          .set({ contextBytes: input.contextBytes, updatedAt: input.now })
          .where(
            and(
              eq(agentRuns.id, run.id),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .returning();
        if (!updatedRun) throw new Error("Agent context update returned no record.");
        return { status: "completed", step: completedStep, evidence, run: updatedRun };
      });
    },

    async failStep(input) {
      const errorCode = agentErrorCodeSchema.parse(input.errorCode);
      return db.transaction(async (transaction): Promise<FailAgentStepResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .limit(1)
          .for("update");
        if (!run || !run.deadlineAt) return { status: "stale" };
        if (run.cancelRequestedAt) {
          await transaction
            .update(agentRunSteps)
            .set({
              status: "cancelled",
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "cancelled",
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: "cancel_requested" };
        }
        const [membership] = run.actorUserId
          ? await transaction
              .select({ userId: spaceMembers.userId })
              .from(spaceMembers)
              .where(
                and(eq(spaceMembers.spaceId, run.spaceId), eq(spaceMembers.userId, run.actorUserId)),
              )
              .limit(1)
              .for("share")
          : [];
        if (!membership || run.deadlineAt.getTime() <= input.now.getTime()) {
          const errorCode = membership
            ? "agent_wall_time_exceeded"
            : "agent_space_access_revoked";
          await transaction
            .update(agentRunSteps)
            .set({
              status: "failed",
              errorCode,
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          const [failed] = await transaction
            .update(agentRuns)
            .set({
              status: "failed",
              errorCode,
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id))
            .returning();
          if (!failed) throw new Error("Agent terminal guard update returned no record.");
          return { status: membership ? "deadline_exceeded" : "access_revoked" };
        }
        const [step] = await transaction
          .select()
          .from(agentRunSteps)
          .where(
            and(
              eq(agentRunSteps.id, input.stepId),
              eq(agentRunSteps.runId, run.id),
              eq(agentRunSteps.kind, "tool_call"),
              eq(agentRunSteps.status, "running"),
            ),
          )
          .limit(1)
          .for("update");
        if (!step) return { status: "stale" };
        const [failed] = await transaction
          .update(agentRunSteps)
          .set({
            status: "failed",
            errorCode,
            completedAt: input.now,
            durationMs: durationMs(step.startedAt, input.now),
          })
          .where(
            and(
              eq(agentRunSteps.id, step.id),
              eq(agentRunSteps.runId, run.id),
              eq(agentRunSteps.status, "running"),
            ),
          )
          .returning();
        return failed ? { status: "failed", step: failed } : { status: "stale" };
      });
    },

    async completeRun(input) {
      const finalResult = agentFinalResultSchema.parse(input.finalResult);
      return db.transaction(async (transaction): Promise<CompleteAgentRunResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .limit(1)
          .for("update");
        if (!run || !run.deadlineAt) return { status: "stale" };
        if (run.cancelRequestedAt) {
          await transaction
            .update(agentRunSteps)
            .set({
              status: "cancelled",
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "cancelled",
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: "cancel_requested" };
        }
        const [membership] = run.actorUserId
          ? await transaction
              .select({ userId: spaceMembers.userId })
              .from(spaceMembers)
              .where(
                and(eq(spaceMembers.spaceId, run.spaceId), eq(spaceMembers.userId, run.actorUserId)),
              )
              .limit(1)
              .for("share")
          : [];
        if (!membership || run.deadlineAt.getTime() <= input.now.getTime()) {
          const errorCode = membership
            ? "agent_wall_time_exceeded"
            : "agent_space_access_revoked";
          await transaction
            .update(agentRunSteps)
            .set({
              status: "failed",
              errorCode,
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "failed",
              errorCode,
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: membership ? "deadline_exceeded" : "access_revoked" };
        }
        if (run.stepCount >= run.maxSteps) return { status: "step_limit_exceeded" };
        const [runningStep] = await transaction
          .select({ id: agentRunSteps.id })
          .from(agentRunSteps)
          .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")))
          .limit(1);
        if (runningStep) return { status: "stale" };
        const [existingFinalStep] = await transaction
          .select({ id: agentRunSteps.id })
          .from(agentRunSteps)
          .where(
            and(
              eq(agentRunSteps.runId, run.id),
              eq(agentRunSteps.kind, "final_answer"),
            ),
          )
          .limit(1);
        if (existingFinalStep) return { status: "stale" };

        const evidenceRows =
          finalResult.evidenceIds.length > 0
            ? await transaction
                .select({
                  id: agentRunEvidence.id,
                  evidenceKey: agentRunEvidence.evidenceKey,
                  stepStatus: agentRunSteps.status,
                  stepKind: agentRunSteps.kind,
                })
                .from(agentRunEvidence)
                .innerJoin(
                  agentRunSteps,
                  and(
                    eq(agentRunSteps.id, agentRunEvidence.stepId),
                    eq(agentRunSteps.runId, agentRunEvidence.runId),
                  ),
                )
                .where(
                  and(
                    eq(agentRunEvidence.runId, run.id),
                    inArray(agentRunEvidence.evidenceKey, finalResult.evidenceIds),
                  ),
                )
                .for("update", { of: agentRunEvidence })
            : [];
        const byKey = new Map(evidenceRows.map((row) => [row.evidenceKey, row]));
        if (
          finalResult.evidenceIds.some((key) => {
            const row = byKey.get(key);
            return !row || row.stepStatus !== "completed" || row.stepKind !== "tool_call";
          })
        ) {
          return { status: "invalid_evidence" };
        }

        await transaction
          .update(agentRunEvidence)
          .set({ finalOrdinal: null })
          .where(eq(agentRunEvidence.runId, run.id));
        for (const [index, key] of finalResult.evidenceIds.entries()) {
          await transaction
            .update(agentRunEvidence)
            .set({ finalOrdinal: index + 1 })
            .where(
              and(eq(agentRunEvidence.runId, run.id), eq(agentRunEvidence.evidenceKey, key)),
            );
        }

        const [step] = await transaction
          .insert(agentRunSteps)
          .values({
            id: input.finalStepId,
            runId: run.id,
            sequence: run.stepCount + 1,
            kind: "final_answer",
            status: "completed",
            startedAt: input.now,
            completedAt: input.now,
            durationMs: 0,
          })
          .returning();
        if (!step) throw new Error("Agent final step insert returned no record.");
        const [completed] = await transaction
          .update(agentRuns)
          .set({
            status: "completed",
            stepCount: run.stepCount + 1,
            finalStatus: finalResult.status,
            finalAnswer: finalResult.answer,
            finishedAt: input.now,
            leaseOwnerId: null,
            leaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(agentRuns.id, run.id),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .returning();
        if (!completed) throw new Error("Agent completion update returned no record.");
        return { status: "completed", run: completed, step };
      });
    },

    async failRun(input) {
      const requestedErrorCode = agentErrorCodeSchema.parse(input.errorCode);
      return db.transaction(async (transaction): Promise<FailAgentRunResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .limit(1)
          .for("update");
        if (!run || !run.deadlineAt) return { status: "stale" };
        if (run.cancelRequestedAt) {
          await transaction
            .update(agentRunSteps)
            .set({
              status: "cancelled",
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "cancelled",
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: "cancel_requested" };
        }
        const [membership] = run.actorUserId
          ? await transaction
              .select({ userId: spaceMembers.userId })
              .from(spaceMembers)
              .where(
                and(eq(spaceMembers.spaceId, run.spaceId), eq(spaceMembers.userId, run.actorUserId)),
              )
              .limit(1)
              .for("share")
          : [];
        if (!membership || run.deadlineAt.getTime() <= input.now.getTime()) {
          const errorCode = membership
            ? "agent_wall_time_exceeded"
            : "agent_space_access_revoked";
          await transaction
            .update(agentRunSteps)
            .set({
              status: "failed",
              errorCode,
              completedAt: input.now,
              durationMs: elapsedStepDurationMs(input.now),
            })
            .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
          await transaction
            .update(agentRuns)
            .set({
              status: "failed",
              errorCode,
              finishedAt: input.now,
              leaseOwnerId: null,
              leaseExpiresAt: null,
              updatedAt: input.now,
            })
            .where(eq(agentRuns.id, run.id));
          return { status: membership ? "deadline_exceeded" : "access_revoked" };
        }
        if (input.decisionErrorStepId && run.stepCount >= run.maxSteps) {
          return { status: "step_limit_exceeded" };
        }

        await transaction
          .update(agentRunSteps)
          .set({
            status: "failed",
            errorCode: requestedErrorCode,
            completedAt: input.now,
            durationMs: elapsedStepDurationMs(input.now),
          })
          .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));

        if (input.decisionErrorStepId) {
          await transaction.insert(agentRunSteps).values({
            id: input.decisionErrorStepId,
            runId: run.id,
            sequence: run.stepCount + 1,
            kind: "decision_error",
            status: "failed",
            errorCode: requestedErrorCode,
            startedAt: input.now,
            completedAt: input.now,
            durationMs: 0,
          });
        }
        const [failed] = await transaction
          .update(agentRuns)
          .set({
            status: "failed",
            stepCount: run.stepCount + (input.decisionErrorStepId ? 1 : 0),
            errorCode: requestedErrorCode,
            finishedAt: input.now,
            leaseOwnerId: null,
            leaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(agentRuns.id, run.id),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .returning();
        if (!failed) throw new Error("Agent failure update returned no record.");
        return { status: "failed", run: failed };
      });
    },

    async markCancelled(input) {
      return db.transaction(async (transaction): Promise<MarkAgentRunCancelledResult> => {
        const [run] = await transaction
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .limit(1)
          .for("update");
        if (!run) return { status: "stale" };
        if (!run.cancelRequestedAt) return { status: "not_requested" };
        await transaction
          .update(agentRunSteps)
          .set({
            status: "cancelled",
            completedAt: input.now,
            durationMs: elapsedStepDurationMs(input.now),
          })
          .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "running")));
        const [cancelled] = await transaction
          .update(agentRuns)
          .set({
            status: "cancelled",
            finishedAt: input.now,
            leaseOwnerId: null,
            leaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(agentRuns.id, run.id),
              eq(agentRuns.status, "running"),
              eq(agentRuns.leaseOwnerId, input.leaseOwnerId),
              eq(agentRuns.leaseGeneration, input.leaseGeneration),
            ),
          )
          .returning();
        if (!cancelled) return { status: "stale" };
        return { status: "cancelled", run: cancelled };
      });
    },
  };
}
