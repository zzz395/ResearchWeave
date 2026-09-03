import type {
  AgentDefinitionRecord,
  AgentRunEvidenceRecord,
  AgentRunRecord,
  AgentRunStepRecord,
  AgentTaskRecord,
} from "../../server/db/schema";
import type {
  AgentDefinitionWithTools,
  AgentRepository,
  AgentRunPersistenceView,
} from "../../server/modules/agents/repository";
import { AGENT_EXECUTION_LIMITS } from "../../server/modules/agents/state";
import type { InMemorySpaceRepository } from "./in-memory-repositories";

export const TEST_AGENT_ID = "90000000-0000-4000-8000-000000000001";

export class InMemoryAgentRepository implements AgentRepository {
  readonly definitions = new Map<string, AgentDefinitionWithTools>();
  readonly tasks = new Map<string, AgentTaskRecord>();
  readonly runs = new Map<string, AgentRunRecord>();
  readonly steps = new Map<string, AgentRunStepRecord[]>();
  readonly evidence = new Map<string, AgentRunEvidenceRecord[]>();
  readonly finalEvidenceIds = new Map<string, string[]>();

  constructor(private readonly spaces: InMemorySpaceRepository) {
    const now = new Date("2026-09-03T00:00:00.000Z");
    const definition: AgentDefinitionRecord = {
      id: TEST_AGENT_ID,
      spaceId: null,
      stableKey: "research-agent",
      name: "Research Agent",
      purpose: "Research across academic sources and the authorized knowledge base.",
      enabled: true,
      systemManaged: true,
      revision: 1,
      limitsJson: AGENT_EXECUTION_LIMITS,
      promptVersion: "research-agent-v1",
      createdAt: now,
      updatedAt: now,
    };
    this.definitions.set(definition.id, {
      definition,
      tools: ["ask_knowledge", "search_arxiv", "search_knowledge_base"],
      limits: AGENT_EXECUTION_LIMITS,
    });
  }

  findDefinition(agentId: string, spaceId: string | null) {
    const bundle = this.definitions.get(agentId);
    if (!bundle) return Promise.resolve(null);
    const definitionSpace = bundle.definition.spaceId;
    return Promise.resolve(
      definitionSpace === null || (spaceId !== null && definitionSpace === spaceId) ? bundle : null,
    );
  }

  listDefinitions(spaceId: string | null) {
    return Promise.resolve(
      [...this.definitions.values()]
        .filter(
          (bundle) =>
            bundle.definition.spaceId === null || bundle.definition.spaceId === spaceId,
        )
        .sort((left, right) =>
          left.definition.name.localeCompare(right.definition.name) ||
          left.definition.id.localeCompare(right.definition.id),
        ),
    );
  }

  createTaskWithInitialRun: AgentRepository["createTaskWithInitialRun"] = async (input) => {
    if (!this.spaces.hasMembership(input.spaceId, input.actorUserId)) {
      return { status: "space_not_found" };
    }
    const existingTask = [...this.tasks.values()].find(
      (task) =>
        task.spaceId === input.spaceId &&
        task.createdByUserId === input.actorUserId &&
        task.clientRequestId === input.clientRequestId,
    );
    if (existingTask) {
      if (existingTask.requestFingerprint !== input.requestFingerprint) {
        return { status: "idempotency_conflict" };
      }
      const existingRun = [...this.runs.values()].find(
        (run) => run.taskId === existingTask.id && run.attemptNumber === 1,
      );
      if (!existingRun) throw new Error("In-memory Agent task has no initial run.");
      return { status: "existing", task: existingTask, run: this.runView(existingRun) };
    }
    const bundle = await this.findDefinition(input.agentId, input.spaceId);
    if (!bundle) return { status: "agent_not_found" };
    if (!bundle.definition.enabled) return { status: "agent_disabled" };
    if (input.providerModel === null) return { status: "runtime_unavailable" };
    const task: AgentTaskRecord = {
      id: input.taskId,
      spaceId: input.spaceId,
      agentId: input.agentId,
      createdByUserId: input.actorUserId,
      prompt: input.prompt,
      clientRequestId: input.clientRequestId,
      requestFingerprint: input.requestFingerprint,
      createdAt: input.now,
    };
    const run = this.newRun({
      id: input.runId,
      task,
      actorUserId: input.actorUserId,
      attemptNumber: 1,
      providerModel: input.providerModel,
      now: input.now,
      bundle,
    });
    this.tasks.set(task.id, task);
    this.runs.set(run.id, run);
    return { status: "created", task, run: this.runView(run) };
  };

  createRetryRun: AgentRepository["createRetryRun"] = async (input) => {
    const task = this.tasks.get(input.taskId);
    if (!task || !this.spaces.hasMembership(task.spaceId, input.actorUserId)) {
      return { status: "task_not_found" };
    }
    const idempotent = [...this.runs.values()].find(
      (run) => run.taskId === task.id && run.retryClientRequestId === input.clientRequestId,
    );
    if (idempotent) {
      return idempotent.retryRequestFingerprint === input.requestFingerprint
        ? { status: "existing", run: this.runView(idempotent) }
        : { status: "idempotency_conflict" };
    }
    const taskRuns = this.taskRuns(task.id);
    const latest = taskRuns.at(-1);
    if (!latest || !["completed", "failed", "cancelled"].includes(latest.status)) {
      return { status: "retry_not_allowed" };
    }
    const bundle = await this.findDefinition(task.agentId, task.spaceId);
    if (!bundle) return { status: "retry_not_allowed" };
    if (!bundle.definition.enabled) return { status: "agent_disabled" };
    if (input.providerModel === null) return { status: "runtime_unavailable" };
    const run = this.newRun({
      id: input.runId,
      task,
      actorUserId: input.actorUserId,
      attemptNumber: latest.attemptNumber + 1,
      providerModel: input.providerModel,
      now: input.now,
      bundle,
      retryClientRequestId: input.clientRequestId,
      retryRequestFingerprint: input.requestFingerprint,
    });
    this.runs.set(run.id, run);
    return { status: "created", run: this.runView(run) };
  };

  readTaskForMember: AgentRepository["readTaskForMember"] = (taskId, actorUserId) => {
    const task = this.tasks.get(taskId);
    if (!task || !this.spaces.hasMembership(task.spaceId, actorUserId)) {
      return Promise.resolve({ status: "task_not_found" });
    }
    const runs = this.taskRuns(taskId).map((run) => this.runView(run));
    const latestRun = runs.at(-1);
    if (!latestRun) throw new Error("In-memory Agent task has no run.");
    return Promise.resolve({ status: "ok", record: { task, latestRun, runs } });
  };

  listTasksForMember: AgentRepository["listTasksForMember"] = (input) => {
    if (!this.spaces.hasMembership(input.spaceId, input.actorUserId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    const records = [...this.tasks.values()]
      .filter((task) => task.spaceId === input.spaceId)
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      )
      .filter((task) => {
        if (!input.cursor) return true;
        return (
          task.createdAt < input.cursor.createdAt ||
          (task.createdAt.getTime() === input.cursor.createdAt.getTime() &&
            task.id < input.cursor.id)
        );
      })
      .flatMap((task) => {
        const latest = this.taskRuns(task.id).at(-1);
        if (!latest || (input.status && latest.status !== input.status)) return [];
        if (input.agentId && task.agentId !== input.agentId) return [];
        return [{ task, latestRun: this.runView(latest) }];
      })
      .slice(0, input.limit);
    return Promise.resolve({ status: "ok", records });
  };

  readRunForMember: AgentRepository["readRunForMember"] = (runId, actorUserId) => {
    const run = this.runs.get(runId);
    return Promise.resolve(
      run && this.spaces.hasMembership(run.spaceId, actorUserId)
        ? { status: "ok", record: this.runView(run) }
        : { status: "run_not_found" },
    );
  };

  readRunTraceForMember: AgentRepository["readRunTraceForMember"] = (
    runId,
    actorUserId,
  ) => {
    const run = this.runs.get(runId);
    return Promise.resolve(
      run && this.spaces.hasMembership(run.spaceId, actorUserId)
        ? {
            status: "ok",
            record: {
              run,
              steps: this.steps.get(runId) ?? [],
              evidence: this.evidence.get(runId) ?? [],
            },
          }
        : { status: "run_not_found" },
    );
  };

  readExecutionState: AgentRepository["readExecutionState"] = () =>
    this.unsupportedWorkerOperation();

  cancelRun: AgentRepository["cancelRun"] = (runId, actorUserId, now) => {
    const run = this.runs.get(runId);
    if (!run || !this.spaces.hasMembership(run.spaceId, actorUserId)) {
      return Promise.resolve({ status: "run_not_found" });
    }
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      return Promise.resolve({
        status: "terminal",
        run: this.runView(run),
        terminalStatus: run.status as "completed" | "failed" | "cancelled",
      });
    }
    const updated: AgentRunRecord =
      run.status === "queued"
        ? {
            ...run,
            status: "cancelled",
            cancelRequestedAt: now,
            cancelRequestedByUserId: actorUserId,
            finishedAt: now,
            updatedAt: now,
          }
        : {
            ...run,
            cancelRequestedAt: run.cancelRequestedAt ?? now,
            cancelRequestedByUserId: run.cancelRequestedByUserId ?? actorUserId,
            updatedAt: now,
          };
    this.runs.set(runId, updated);
    return Promise.resolve({
      status: updated.status === "cancelled" ? "cancelled" : "cancellation_requested",
      run: this.runView(updated),
    });
  };

  claimRun: AgentRepository["claimRun"] = () => this.unsupportedWorkerOperation();
  heartbeatLease: AgentRepository["heartbeatLease"] = () => this.unsupportedWorkerOperation();
  reserveStep: AgentRepository["reserveStep"] = () => this.unsupportedWorkerOperation();
  completeToolStepWithEvidence: AgentRepository["completeToolStepWithEvidence"] = () =>
    this.unsupportedWorkerOperation();
  failStep: AgentRepository["failStep"] = () => this.unsupportedWorkerOperation();
  completeRun: AgentRepository["completeRun"] = () => this.unsupportedWorkerOperation();
  failRun: AgentRepository["failRun"] = () => this.unsupportedWorkerOperation();
  markCancelled: AgentRepository["markCancelled"] = () => this.unsupportedWorkerOperation();

  private taskRuns(taskId: string) {
    return [...this.runs.values()]
      .filter((run) => run.taskId === taskId)
      .sort((left, right) => left.attemptNumber - right.attemptNumber);
  }

  private runView(record: AgentRunRecord): AgentRunPersistenceView {
    return { record, finalEvidenceIds: this.finalEvidenceIds.get(record.id) ?? [] };
  }

  private unsupportedWorkerOperation(): Promise<never> {
    return Promise.reject(
      new Error("Worker operations are outside the in-memory REST test repository."),
    );
  }

  private newRun(input: {
    id: string;
    task: AgentTaskRecord;
    actorUserId: string;
    attemptNumber: number;
    providerModel: string;
    now: Date;
    bundle: AgentDefinitionWithTools;
    retryClientRequestId?: string;
    retryRequestFingerprint?: string;
  }): AgentRunRecord {
    return {
      id: input.id,
      taskId: input.task.id,
      spaceId: input.task.spaceId,
      actorUserId: input.actorUserId,
      attemptNumber: input.attemptNumber,
      status: "queued",
      definitionRevision: input.bundle.definition.revision,
      toolNames: input.bundle.tools,
      maxSteps: input.bundle.limits.maxSteps,
      maxToolCalls: input.bundle.limits.maxToolCalls,
      wallTimeSeconds: input.bundle.limits.wallTimeSeconds,
      providerDecisionTimeoutSeconds: input.bundle.limits.providerDecisionTimeoutSeconds,
      toolTimeoutSeconds: input.bundle.limits.toolTimeoutSeconds,
      providerAttempts: input.bundle.limits.providerAttempts,
      providerResponseMaxBytes: input.bundle.limits.providerResponseMaxBytes,
      observationMaxBytes: input.bundle.limits.observationMaxBytes,
      contextMaxBytes: input.bundle.limits.contextMaxBytes,
      finalAnswerMaxCharacters: input.bundle.limits.finalAnswerMaxCharacters,
      maxEvidence: input.bundle.limits.maxEvidence,
      promptVersion: input.bundle.definition.promptVersion,
      providerModel: input.providerModel,
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
      retryClientRequestId: input.retryClientRequestId ?? null,
      retryRequestFingerprint: input.retryRequestFingerprint ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    };
  }
}
