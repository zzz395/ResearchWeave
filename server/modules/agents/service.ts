import { createHash, randomUUID } from "node:crypto";

import {
  agentDefinitionSchema,
  agentEvidenceSchema,
  agentRunCreateResponseSchema,
  agentRunResponseSchema,
  agentRunSchema,
  agentRunTraceResponseSchema,
  agentStepSchema,
  agentTaskCreateResponseSchema,
  agentTaskCursorPayloadSchema,
  agentTaskListQuerySchema,
  agentTaskListResponseSchema,
  agentTaskResponseSchema,
  createAgentTaskInputSchema,
  retryAgentTaskInputSchema,
  type AgentDefinition,
  type AgentRun,
  type AgentRunCreateResponse,
  type AgentRunResponse,
  type AgentRunTraceResponse,
  type AgentTask,
  type AgentTaskCreateResponse,
  type AgentTaskListResponse,
  type AgentTaskListQuery,
  type AgentTaskResponse,
  type CreateAgentTaskInput,
  type RetryAgentTaskInput,
} from "../../../shared/contracts/agents";
import type {
  AgentDefinitionRecord,
  AgentRunEvidenceRecord,
  AgentRunStepRecord,
  AgentTaskRecord,
} from "../../db/schema";
import { AppError } from "../../middleware/app-error";
import { parseResponse } from "../../middleware/response-validation";
import type {
  AgentDefinitionWithTools,
  AgentRepository,
  AgentRunPersistenceView,
  AgentTaskCursorRecord,
  AgentTaskWithLatestRun,
} from "./repository";

const canonicalBase64UrlSchema = /^[A-Za-z0-9_-]+$/u;

export type AgentRuntimeState =
  | { ready: false; reason: "provider_unconfigured" | "runtime_unavailable" }
  | { ready: true; providerModel: string };

export interface AgentRuntimeReadiness {
  getSnapshot(): AgentRuntimeState;
}

export interface AgentService {
  listDefinitions(): Promise<AgentDefinition[]>;
  getDefinition(agentId: string): Promise<AgentDefinition>;
  createTask(
    spaceId: string,
    actorUserId: string,
    input: CreateAgentTaskInput,
  ): Promise<AgentTaskCreateResponse>;
  listTasks(
    spaceId: string,
    actorUserId: string,
    query: AgentTaskListQuery,
  ): Promise<AgentTaskListResponse>;
  getTask(taskId: string, actorUserId: string): Promise<AgentTaskResponse>;
  retryTask(
    taskId: string,
    actorUserId: string,
    input: RetryAgentTaskInput,
  ): Promise<AgentRunCreateResponse>;
  getRun(runId: string, actorUserId: string): Promise<AgentRunResponse>;
  getRunTrace(runId: string, actorUserId: string): Promise<AgentRunTraceResponse>;
  cancelRun(runId: string, actorUserId: string): Promise<AgentRunResponse>;
}

function requestFingerprint(operation: string, fields: Record<string, string>): string {
  const canonical = JSON.stringify({ version: 1, operation, ...fields });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createAgentTaskRequestFingerprint(input: {
  spaceId: string;
  agentId: string;
  prompt: string;
}): string {
  return requestFingerprint("create_agent_task", input);
}

export function createAgentRetryRequestFingerprint(taskId: string): string {
  return requestFingerprint("retry_agent_task", { taskId });
}

function encodeCursor(record: Pick<AgentTaskRecord, "createdAt" | "id">): string {
  return Buffer.from(
    JSON.stringify({ createdAt: record.createdAt.toISOString(), id: record.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeAgentTaskCursor(cursor: string | undefined): AgentTaskCursorRecord | null {
  if (!cursor) return null;
  try {
    if (!canonicalBase64UrlSchema.test(cursor) || cursor.length % 4 === 1) throw new Error();
    const decodedBytes = Buffer.from(cursor, "base64url");
    if (decodedBytes.toString("base64url") !== cursor) throw new Error();
    const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(decodedBytes);
    const payload = agentTaskCursorPayloadSchema.parse(JSON.parse(decodedText) as unknown);
    return { createdAt: new Date(payload.createdAt), id: payload.id };
  } catch {
    throw new AppError(400, "invalid_agent_task_cursor", "The Agent task cursor is invalid.");
  }
}

function availability(
  record: AgentDefinitionRecord,
  runtime: AgentRuntimeState,
): AgentDefinition["availability"] {
  if (!record.enabled) return { available: false, reason: "agent_disabled" };
  return runtime.ready
    ? { available: true, reason: null }
    : { available: false, reason: runtime.reason };
}

function toDefinition(
  bundle: AgentDefinitionWithTools,
  runtime: AgentRuntimeState,
): AgentDefinition {
  const record = bundle.definition;
  return parseResponse(agentDefinitionSchema, {
    id: record.id,
    stableKey: record.stableKey,
    name: record.name,
    purpose: record.purpose,
    enabled: record.enabled,
    systemManaged: record.systemManaged,
    revision: record.revision,
    tools: bundle.tools,
    limits: bundle.limits,
    promptVersion: record.promptVersion,
    availability: availability(record, runtime),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function toRun(view: AgentRunPersistenceView): AgentRun {
  const record = view.record;
  return parseResponse(agentRunSchema, {
    id: record.id,
    taskId: record.taskId,
    spaceId: record.spaceId,
    attemptNumber: record.attemptNumber,
    status: record.status,
    configuration: {
      agentRevision: record.definitionRevision,
      tools: record.toolNames,
      limits: {
        maxSteps: record.maxSteps,
        maxToolCalls: record.maxToolCalls,
        wallTimeSeconds: record.wallTimeSeconds,
        providerDecisionTimeoutSeconds: record.providerDecisionTimeoutSeconds,
        toolTimeoutSeconds: record.toolTimeoutSeconds,
        providerAttempts: record.providerAttempts,
        providerResponseMaxBytes: record.providerResponseMaxBytes,
        observationMaxBytes: record.observationMaxBytes,
        contextMaxBytes: record.contextMaxBytes,
        finalAnswerMaxCharacters: record.finalAnswerMaxCharacters,
        maxEvidence: record.maxEvidence,
      },
      promptVersion: record.promptVersion,
      providerModel: record.providerModel,
    },
    stepCount: record.stepCount,
    toolCallCount: record.toolCallCount,
    contextBytes: record.contextBytes,
    cancelRequestedAt: record.cancelRequestedAt?.toISOString() ?? null,
    cancelRequestedByUserId: record.cancelRequestedByUserId,
    startedAt: record.startedAt?.toISOString() ?? null,
    deadlineAt: record.deadlineAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    errorCode: record.errorCode,
    finalResult:
      record.status === "completed"
        ? {
            status: record.finalStatus,
            answer: record.finalAnswer,
            evidenceIds: view.finalEvidenceIds,
          }
        : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function toTask(record: AgentTaskWithLatestRun): AgentTask {
  return {
    id: record.task.id,
    spaceId: record.task.spaceId,
    agentId: record.task.agentId,
    createdByUserId: record.task.createdByUserId,
    prompt: record.task.prompt,
    createdAt: record.task.createdAt.toISOString(),
    latestRun: toRun(record.latestRun),
  };
}

function toStep(record: AgentRunStepRecord) {
  return parseResponse(agentStepSchema, {
    id: record.id,
    runId: record.runId,
    sequence: record.sequence,
    kind: record.kind,
    status: record.status,
    toolName: record.toolName,
    safeArguments: record.safeArgumentsJson,
    observation: record.observationJson,
    executionCount: record.executionCount,
    errorCode: record.errorCode,
    startedAt: record.startedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    durationMs: record.durationMs,
  });
}

function toEvidence(record: AgentRunEvidenceRecord) {
  const common = {
    id: record.id,
    runId: record.runId,
    stepId: record.stepId,
    evidenceId: record.evidenceKey,
    excerpt: record.excerpt,
    finalOrdinal: record.finalOrdinal,
    createdAt: record.createdAt.toISOString(),
  };
  return parseResponse(
    agentEvidenceSchema,
    record.kind === "arxiv_abstract"
      ? {
          ...common,
          kind: record.kind,
          paperId: record.paperId,
          canonicalArxivId: record.canonicalArxivId,
          versionedArxivId: record.versionedArxivId,
          sourceVersion: record.sourceVersion,
          title: record.sourceTitle,
          url: record.sourceUrl,
          available: record.paperId !== null,
        }
      : {
          ...common,
          kind: record.kind,
          documentId: record.documentId,
          originalFilename: record.originalFilename,
          contentHash: record.contentHash,
          ordinal: record.chunkOrdinal,
          pageNumber: record.pageNumber,
          startOffset: record.startOffset,
          endOffset: record.endOffset,
          available: record.documentId !== null,
        },
  );
}

function mapCreateError(
  status:
    | "idempotency_conflict"
    | "space_not_found"
    | "agent_not_found"
    | "agent_disabled"
    | "runtime_unavailable",
): never {
  if (status === "idempotency_conflict") {
    throw new AppError(409, "agent_idempotency_conflict", "The idempotency key was already used for a different Agent request.");
  }
  if (status === "space_not_found") {
    throw new AppError(404, "space_not_found", "Research space was not found.");
  }
  if (status === "agent_disabled") {
    throw new AppError(409, "agent_disabled", "This Agent is disabled.");
  }
  if (status === "runtime_unavailable") {
    throw new AppError(503, "agent_runtime_unavailable", "The Agent runtime is unavailable.");
  }
  throw new AppError(404, "agent_not_found", "Agent was not found.");
}

export function createAgentService(
  repository: AgentRepository,
  readiness: AgentRuntimeReadiness,
): AgentService {
  return {
    async listDefinitions() {
      const runtime = readiness.getSnapshot();
      return (await repository.listDefinitions(null)).map((item) => toDefinition(item, runtime));
    },

    async getDefinition(agentId) {
      const runtime = readiness.getSnapshot();
      const bundle = await repository.findDefinition(agentId, null);
      if (!bundle) throw new AppError(404, "agent_not_found", "Agent was not found.");
      return toDefinition(bundle, runtime);
    },

    async createTask(spaceId, actorUserId, rawInput) {
      const input = createAgentTaskInputSchema.parse(rawInput);
      const runtime = readiness.getSnapshot();
      const result = await repository.createTaskWithInitialRun({
        taskId: randomUUID(),
        runId: randomUUID(),
        spaceId,
        agentId: input.agentId,
        actorUserId,
        prompt: input.prompt,
        clientRequestId: input.clientRequestId,
        requestFingerprint: createAgentTaskRequestFingerprint({
          spaceId,
          agentId: input.agentId,
          prompt: input.prompt,
        }),
        providerModel: runtime.ready ? runtime.providerModel : null,
        now: new Date(),
      });
      if (result.status !== "created" && result.status !== "existing") {
        return mapCreateError(result.status);
      }
      const run = toRun(result.run);
      return parseResponse(agentTaskCreateResponseSchema, {
        task: toTask({ task: result.task, latestRun: result.run }),
        run,
        created: result.status === "created",
      });
    },

    async listTasks(spaceId, actorUserId, rawQuery) {
      const query = agentTaskListQuerySchema.parse(rawQuery);
      const result = await repository.listTasksForMember({
        spaceId,
        actorUserId,
        cursor: decodeAgentTaskCursor(query.cursor),
        limit: query.limit + 1,
        ...(query.status ? { status: query.status } : {}),
        ...(query.agentId ? { agentId: query.agentId } : {}),
      });
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      const hasMore = result.records.length > query.limit;
      const page = result.records.slice(0, query.limit);
      const last = page.at(-1);
      return parseResponse(agentTaskListResponseSchema, {
        tasks: page.map(toTask),
        nextCursor: hasMore && last ? encodeCursor(last.task) : null,
      });
    },

    async getTask(taskId, actorUserId) {
      const result = await repository.readTaskForMember(taskId, actorUserId);
      if (result.status === "task_not_found") {
        throw new AppError(404, "agent_task_not_found", "Agent task was not found.");
      }
      return parseResponse(agentTaskResponseSchema, {
        task: toTask(result.record),
        runs: result.record.runs.map(toRun),
      });
    },

    async retryTask(taskId, actorUserId, rawInput) {
      const input = retryAgentTaskInputSchema.parse(rawInput);
      const taskResult = await repository.readTaskForMember(taskId, actorUserId);
      if (taskResult.status === "task_not_found") {
        throw new AppError(404, "agent_task_not_found", "Agent task was not found.");
      }
      const runtime = readiness.getSnapshot();
      const result = await repository.createRetryRun({
        runId: randomUUID(),
        taskId,
        actorUserId,
        clientRequestId: input.clientRequestId,
        requestFingerprint: createAgentRetryRequestFingerprint(taskId),
        providerModel: runtime.ready ? runtime.providerModel : null,
        now: new Date(),
      });
      if (result.status === "task_not_found") {
        throw new AppError(404, "agent_task_not_found", "Agent task was not found.");
      }
      if (result.status === "idempotency_conflict") {
        throw new AppError(409, "agent_idempotency_conflict", "The idempotency key was already used for a different Agent request.");
      }
      if (result.status === "retry_not_allowed") {
        throw new AppError(409, "agent_retry_not_allowed", "The Agent task cannot be retried.");
      }
      if (result.status === "agent_disabled") {
        throw new AppError(409, "agent_disabled", "This Agent is disabled.");
      }
      if (result.status === "runtime_unavailable") {
        throw new AppError(503, "agent_runtime_unavailable", "The Agent runtime is unavailable.");
      }
      if (result.status !== "created" && result.status !== "existing") {
        throw new Error("Unhandled Agent retry repository result.");
      }
      return parseResponse(agentRunCreateResponseSchema, {
        run: toRun(result.run),
        created: result.status === "created",
      });
    },

    async getRun(runId, actorUserId) {
      const result = await repository.readRunForMember(runId, actorUserId);
      if (result.status === "run_not_found") {
        throw new AppError(404, "agent_run_not_found", "Agent run was not found.");
      }
      return parseResponse(agentRunResponseSchema, { run: toRun(result.record) });
    },

    async getRunTrace(runId, actorUserId) {
      const result = await repository.readRunTraceForMember(runId, actorUserId);
      if (result.status === "run_not_found") {
        throw new AppError(404, "agent_run_not_found", "Agent run was not found.");
      }
      return parseResponse(agentRunTraceResponseSchema, {
        runId: result.record.run.id,
        steps: result.record.steps.map(toStep),
        evidence: result.record.evidence.map(toEvidence),
      });
    },

    async cancelRun(runId, actorUserId) {
      const result = await repository.cancelRun(runId, actorUserId, new Date());
      if (result.status === "run_not_found") {
        throw new AppError(404, "agent_run_not_found", "Agent run was not found.");
      }
      if (result.status === "terminal") {
        throw new AppError(409, "agent_run_terminal", "The Agent run is already terminal.", {
          run: toRun(result.run),
        });
      }
      return parseResponse(agentRunResponseSchema, { run: toRun(result.run) });
    },
  };
}
