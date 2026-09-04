import { randomUUID } from "node:crypto";

import {
  agentFinalResultSchema,
  type AgentErrorCode,
  type AgentToolName,
} from "../../../shared/contracts/agents";
import {
  createAgentDecisionActions,
  isAgentDecisionProviderError,
  type AgentDecision,
  type AgentDecisionProvider,
} from "./decision-provider";
import {
  AgentExecutionContextError,
  appendCompletedToolCall,
  buildAgentDecisionContext,
  type AgentDecisionContextProjection,
} from "./execution-context";
import type {
  AgentExecutionState,
  AgentRepository,
  AgentWorkerFence,
  CompleteAgentRunResult,
  CompleteAgentToolStepResult,
  FailAgentRunResult,
  FailAgentStepResult,
  ReadAgentExecutionStateResult,
  ReserveAgentStepResult,
} from "./repository";
import { isAgentToolError, type AgentToolExecutionResult } from "./tools/contracts";
import type { AgentToolRegistry, PreparedAgentToolCall } from "./tools/registry";

type ExecutorRepository = Pick<
  AgentRepository,
  | "readExecutionState"
  | "reserveStep"
  | "completeToolStepWithEvidence"
  | "failStep"
  | "completeRun"
  | "failRun"
  | "markCancelled"
>;

export interface AgentRunExecutionInput extends AgentWorkerFence {
  readonly signal: AbortSignal;
}

export type AgentRunExecutionOutcome =
  | { readonly status: "completed" | "cancelled" | "stale"; readonly runId: string }
  | {
      readonly status: "interrupted";
      readonly runId: string;
      readonly errorCode?: Extract<AgentErrorCode, "agent_persistence_failed">;
    }
  | { readonly status: "failed"; readonly runId: string; readonly errorCode: AgentErrorCode };

export interface AgentRunExecutor {
  execute(input: AgentRunExecutionInput): Promise<AgentRunExecutionOutcome>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AgentRunExecutorDependencies {
  readonly repository: ExecutorRepository;
  readonly decisionProvider: AgentDecisionProvider;
  readonly toolRegistry: AgentToolRegistry;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
}

class BoundaryError extends Error {
  constructor(readonly kind: "caller_interrupted" | "run_deadline" | "tool_timeout") {
    super("The Agent execution boundary stopped the external operation.");
    this.name = "BoundaryError";
    this.stack = undefined;
  }
}

const CALLER_INTERRUPTED = new BoundaryError("caller_interrupted");
const RUN_DEADLINE = new BoundaryError("run_deadline");
const TOOL_TIMEOUT = new BoundaryError("tool_timeout");

type BoundaryReason = BoundaryError;

function isBoundaryReason(error: unknown, reason: BoundaryReason): boolean {
  return error === reason;
}

function snapshotKey(state: AgentExecutionState): string {
  return JSON.stringify({
    run: {
      stepCount: state.run.stepCount,
      toolCallCount: state.run.toolCallCount,
      contextBytes: state.run.contextBytes,
      leaseGeneration: state.run.leaseGeneration,
      cancelRequestedAt: state.run.cancelRequestedAt,
    },
    steps: state.steps.map((step) => ({
      id: step.id,
      sequence: step.sequence,
      status: step.status,
      executionCount: step.executionCount,
    })),
    evidence: state.evidence.map((item) => ({
      id: item.id,
      stepId: item.stepId,
      evidenceKey: item.evidenceKey,
    })),
  });
}

export function createAgentRunExecutor(
  dependencies: AgentRunExecutorDependencies,
): AgentRunExecutor {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  const setTimer: (callback: () => void, delayMs: number) => TimerHandle =
    dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer: (handle: TimerHandle) => void =
    dependencies.clearTimer ?? ((handle) => clearTimeout(handle));

  async function runExternal<T>(input: {
    callerSignal: AbortSignal;
    deadlineAt: Date;
    operationTimeoutMs?: number;
    operation(signal: AbortSignal): Promise<T>;
  }): Promise<T> {
    if (input.callerSignal.aborted) throw CALLER_INTERRUPTED;
    const startedAt = now().getTime();
    const deadlineDelay = input.deadlineAt.getTime() - startedAt;
    if (deadlineDelay <= 0) throw RUN_DEADLINE;
    if (input.operationTimeoutMs !== undefined && input.operationTimeoutMs <= 0) {
      throw TOOL_TIMEOUT;
    }

    const controller = new AbortController();
    let rejectBoundary: (reason: BoundaryReason) => void = () => undefined;
    const boundary = new Promise<never>((_resolve, reject) => {
      rejectBoundary = reject;
    });
    const abort = (reason: BoundaryReason) => {
      if (controller.signal.aborted) return;
      controller.abort(reason);
      rejectBoundary(reason);
    };
    const onCallerAbort = () => abort(CALLER_INTERRUPTED);
    input.callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    const deadlineTimer = setTimer(() => abort(RUN_DEADLINE), deadlineDelay);
    const operationTimer =
      input.operationTimeoutMs !== undefined && input.operationTimeoutMs < deadlineDelay
        ? setTimer(() => abort(TOOL_TIMEOUT), input.operationTimeoutMs)
        : null;
    const operation = Promise.resolve().then(() => input.operation(controller.signal));
    void operation.catch(() => undefined);

    try {
      return await Promise.race([operation, boundary]);
    } finally {
      clearTimer(deadlineTimer);
      if (operationTimer !== null) clearTimer(operationTimer);
      input.callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }

  function outcome(
    runId: string,
    status: AgentRunExecutionOutcome["status"],
    errorCode?: AgentErrorCode,
  ): AgentRunExecutionOutcome {
    if (status === "failed") {
      return { status, runId, errorCode: errorCode ?? "agent_persistence_failed" };
    }
    if (status === "interrupted" && errorCode === "agent_persistence_failed") {
      return { status, runId, errorCode };
    }
    return { status, runId };
  }

  async function settleCancellation(
    fence: AgentWorkerFence,
  ): Promise<AgentRunExecutionOutcome> {
    const result = await dependencies.repository.markCancelled({ ...fence, now: now() });
    if (result.status === "not_requested") return outcome(fence.runId, "stale");
    return outcome(fence.runId, result.status === "cancelled" ? "cancelled" : "stale");
  }

  function mapTerminalWrite(
    fence: AgentWorkerFence,
    result: FailAgentRunResult,
    errorCode: AgentErrorCode,
  ): AgentRunExecutionOutcome {
    switch (result.status) {
      case "failed":
        return outcome(fence.runId, "failed", errorCode);
      case "cancel_requested":
        return outcome(fence.runId, "cancelled");
      case "deadline_exceeded":
        return outcome(fence.runId, "failed", "agent_wall_time_exceeded");
      case "access_revoked":
        return outcome(fence.runId, "failed", "agent_space_access_revoked");
      case "stale":
        return outcome(fence.runId, "stale");
      case "step_limit_exceeded":
        return outcome(fence.runId, "failed", "agent_step_limit_exceeded");
    }
  }

  async function failRun(
    fence: AgentWorkerFence,
    errorCode: AgentErrorCode,
    includeDecisionError: boolean,
  ): Promise<AgentRunExecutionOutcome> {
    let result = await dependencies.repository.failRun({
      ...fence,
      errorCode,
      now: now(),
      ...(includeDecisionError ? { decisionErrorStepId: createId() } : {}),
    });
    if (result.status === "step_limit_exceeded" && includeDecisionError) {
      result = await dependencies.repository.failRun({ ...fence, errorCode, now: now() });
    }
    return mapTerminalWrite(fence, result, errorCode);
  }

  async function readState(
    fence: AgentWorkerFence,
  ): Promise<ReadAgentExecutionStateResult> {
    return dependencies.repository.readExecutionState({ ...fence, now: now() });
  }

  async function settleReadGuard(
    fence: AgentWorkerFence,
    result: Exclude<ReadAgentExecutionStateResult, { status: "ok" }>,
  ): Promise<AgentRunExecutionOutcome> {
    switch (result.status) {
      case "stale":
        return outcome(fence.runId, "stale");
      case "cancel_requested":
        return settleCancellation(fence);
      case "deadline_exceeded":
        return failRun(fence, "agent_wall_time_exceeded", false);
      case "access_revoked":
        return failRun(fence, "agent_space_access_revoked", false);
    }
  }

  async function recheck(
    fence: AgentWorkerFence,
    callerSignal: AbortSignal,
  ): Promise<AgentExecutionState | AgentRunExecutionOutcome> {
    const current = await readState(fence);
    if (current.status !== "ok") return settleReadGuard(fence, current);
    if (callerSignal.aborted) return outcome(fence.runId, "interrupted");
    return current.state;
  }

  function isOutcome(
    value: AgentExecutionState | AgentRunExecutionOutcome,
  ): value is AgentRunExecutionOutcome {
    return "status" in value;
  }

  async function failToolStep(input: {
    fence: AgentWorkerFence;
    stepId: string;
    errorCode: AgentErrorCode;
    projection: AgentDecisionContextProjection;
  }): Promise<AgentRunExecutionOutcome | null> {
    const result: FailAgentStepResult = await dependencies.repository.failStep({
      ...input.fence,
      stepId: input.stepId,
      errorCode: input.errorCode,
      contextBytes: input.projection.contextBytes,
      now: now(),
    });
    switch (result.status) {
      case "failed":
        return null;
      case "stale":
        return outcome(input.fence.runId, "stale");
      case "cancel_requested":
        return outcome(input.fence.runId, "cancelled");
      case "deadline_exceeded":
        return outcome(input.fence.runId, "failed", "agent_wall_time_exceeded");
      case "access_revoked":
        return outcome(input.fence.runId, "failed", "agent_space_access_revoked");
      case "context_limit_exceeded":
        return failRun(input.fence, "agent_context_limit_exceeded", false);
    }
  }

  async function handleReserveResult(
    fence: AgentWorkerFence,
    result: Exclude<ReserveAgentStepResult, { status: "reserved" | "resumed" }>,
  ): Promise<AgentRunExecutionOutcome> {
    switch (result.status) {
      case "stale":
      case "incomplete_step":
        return outcome(fence.runId, "stale");
      case "cancel_requested":
        return settleCancellation(fence);
      case "deadline_exceeded":
        return outcome(fence.runId, "failed", "agent_wall_time_exceeded");
      case "access_revoked":
        return outcome(fence.runId, "failed", "agent_space_access_revoked");
      case "step_limit_exceeded":
        return failRun(fence, "agent_step_limit_exceeded", false);
      case "tool_call_limit_exceeded":
        return failRun(fence, "agent_tool_call_limit_exceeded", false);
    }
  }

  async function persistToolSuccess(input: {
    fence: AgentWorkerFence;
    stepId: string;
    result: AgentToolExecutionResult;
    projectedContextBytes: number;
    predictedEvidenceIds: readonly string[];
  }): Promise<AgentRunExecutionOutcome | null> {
    const result: CompleteAgentToolStepResult =
      await dependencies.repository.completeToolStepWithEvidence({
        ...input.fence,
        stepId: input.stepId,
        observation: input.result.observation,
        evidence: input.result.evidence,
        contextBytes: input.projectedContextBytes,
        now: now(),
      });
    switch (result.status) {
      case "completed": {
        const actualIds = result.evidence.map((item) => item.evidenceKey);
        const consistent =
          result.step.id === input.stepId &&
          result.step.status === "completed" &&
          actualIds.length === input.predictedEvidenceIds.length &&
          actualIds.every((id, index) => id === input.predictedEvidenceIds[index]);
        return consistent ? null : failRun(input.fence, "agent_persistence_failed", false);
      }
      case "stale":
        return outcome(input.fence.runId, "stale");
      case "cancel_requested":
        return settleCancellation(input.fence);
      case "deadline_exceeded":
        return failRun(input.fence, "agent_wall_time_exceeded", false);
      case "access_revoked":
        return failRun(input.fence, "agent_space_access_revoked", false);
      case "observation_too_large":
        return failRun(input.fence, "agent_observation_too_large", false);
      case "evidence_limit_exceeded":
        return failRun(input.fence, "agent_evidence_limit_exceeded", false);
      case "invalid_evidence":
        return failRun(input.fence, "agent_tool_invalid_response", false);
      case "context_limit_exceeded":
        return failRun(input.fence, "agent_context_limit_exceeded", false);
    }
  }

  async function executePreparedTool(input: {
    fence: AgentWorkerFence;
    callerSignal: AbortSignal;
    state: AgentExecutionState;
    prepared: PreparedAgentToolCall;
    resumeStepId?: string;
  }): Promise<AgentRunExecutionOutcome | null> {
    if (input.callerSignal.aborted) {
      const checked = await recheck(input.fence, input.callerSignal);
      return isOutcome(checked) ? checked : outcome(input.fence.runId, "interrupted");
    }
    const reserved = await dependencies.repository.reserveStep({
      ...input.fence,
      stepId: input.resumeStepId ?? createId(),
      toolName: input.prepared.toolName,
      safeArguments: input.prepared.safeArguments,
      now: now(),
      ...(input.resumeStepId ? { resumeStepId: input.resumeStepId } : {}),
    });
    if (!("step" in reserved)) {
      return handleReserveResult(input.fence, reserved);
    }

    let toolResult: AgentToolExecutionResult;
    try {
      if (!input.state.run.deadlineAt || !input.state.run.actorUserId) {
        return failRun(input.fence, "agent_space_access_revoked", false);
      }
      toolResult = await runExternal({
        callerSignal: input.callerSignal,
        deadlineAt: input.state.run.deadlineAt,
        operationTimeoutMs: input.state.run.toolTimeoutSeconds * 1_000,
        operation: (signal) =>
          input.prepared.execute({
            spaceId: input.state.run.spaceId,
            actorUserId: input.state.run.actorUserId!,
            signal,
          }),
      });
    } catch (error: unknown) {
      const checked = await recheck(input.fence, input.callerSignal);
      if (isOutcome(checked)) return checked;
      let code: AgentErrorCode;
      if (isBoundaryReason(error, CALLER_INTERRUPTED)) {
        return outcome(input.fence.runId, "interrupted");
      }
      if (isBoundaryReason(error, RUN_DEADLINE)) {
        return failRun(input.fence, "agent_wall_time_exceeded", false);
      }
      if (isBoundaryReason(error, TOOL_TIMEOUT)) {
        code = "agent_tool_timeout";
      } else if (isAgentToolError(error)) {
        code = error.code;
      } else {
        code = "agent_tool_invalid_response";
      }
      if (code === "agent_space_access_revoked") {
        return failRun(input.fence, code, false);
      }
      const projection = buildAgentDecisionContext(checked);
      return failToolStep({
        fence: input.fence,
        stepId: reserved.step.id,
        errorCode: code,
        projection,
      });
    }

    const checked = await recheck(input.fence, input.callerSignal);
    if (isOutcome(checked)) return checked;
    const projection = buildAgentDecisionContext(checked);
    const appended = appendCompletedToolCall(projection, reserved.step, toolResult);
    const predictedEvidenceIds = appended.context.completedToolCalls.at(-1)?.evidenceIds ?? [];
    return persistToolSuccess({
      fence: input.fence,
      stepId: reserved.step.id,
      result: toolResult,
      projectedContextBytes: appended.contextBytes,
      predictedEvidenceIds,
    });
  }

  async function completeFinal(input: {
    fence: AgentWorkerFence;
    callerSignal: AbortSignal;
    state: AgentExecutionState;
    decision: Extract<AgentDecision, { kind: "final_answer" }>;
  }): Promise<AgentRunExecutionOutcome> {
    if (input.callerSignal.aborted) {
      const checked = await recheck(input.fence, input.callerSignal);
      if (isOutcome(checked)) return checked;
      return outcome(input.fence.runId, "interrupted");
    }
    const finalResult = agentFinalResultSchema.safeParse(input.decision.result);
    if (
      !finalResult.success ||
      finalResult.data.answer.length > input.state.run.finalAnswerMaxCharacters
    ) {
      return failRun(input.fence, "agent_invalid_final_answer", true);
    }
    const result: CompleteAgentRunResult = await dependencies.repository.completeRun({
      ...input.fence,
      finalStepId: createId(),
      finalResult: finalResult.data,
      now: now(),
    });
    switch (result.status) {
      case "completed":
        return outcome(input.fence.runId, "completed");
      case "stale":
        return outcome(input.fence.runId, "stale");
      case "cancel_requested":
        return outcome(input.fence.runId, "cancelled");
      case "deadline_exceeded":
        return outcome(input.fence.runId, "failed", "agent_wall_time_exceeded");
      case "access_revoked":
        return outcome(input.fence.runId, "failed", "agent_space_access_revoked");
      case "step_limit_exceeded":
        return failRun(input.fence, "agent_step_limit_exceeded", false);
      case "invalid_evidence":
        return failRun(input.fence, "agent_invalid_final_answer", true);
    }
  }

  return Object.freeze({
    async execute(input: AgentRunExecutionInput): Promise<AgentRunExecutionOutcome> {
      const fence: AgentWorkerFence = {
        runId: input.runId,
        leaseOwnerId: input.leaseOwnerId,
        leaseGeneration: input.leaseGeneration,
      };
      try {
        for (;;) {
          const read = await readState(fence);
          if (read.status !== "ok") return await settleReadGuard(fence, read);
          const state = read.state;
          let projection: AgentDecisionContextProjection;
          try {
            projection = buildAgentDecisionContext(state);
          } catch (error: unknown) {
            const code =
              error instanceof AgentExecutionContextError
                ? error.code
                : "agent_persistence_failed";
            return await failRun(fence, code, true);
          }
          if (input.signal.aborted) return outcome(input.runId, "interrupted");
          if (!state.run.deadlineAt) {
            return await failRun(fence, "agent_persistence_failed", true);
          }
          if (dependencies.decisionProvider.model !== state.run.providerModel) {
            return await failRun(fence, "agent_provider_unavailable", true);
          }

          const incomplete = state.steps.find((step) => step.status === "running");
          if (incomplete) {
            let prepared: PreparedAgentToolCall;
            try {
              prepared = dependencies.toolRegistry.prepareCall(
                state.run.toolNames as AgentToolName[],
                incomplete.toolName,
                incomplete.safeArgumentsJson,
              );
            } catch (error: unknown) {
              const code = isAgentToolError(error)
                ? error.code
                : "agent_persistence_failed";
              return await failRun(fence, code, true);
            }
            const result = await executePreparedTool({
              fence,
              callerSignal: input.signal,
              state,
              prepared,
              resumeStepId: incomplete.id,
            });
            if (result) return result;
            continue;
          }

          if (state.run.stepCount >= state.run.maxSteps) {
            return await failRun(fence, "agent_step_limit_exceeded", false);
          }
          const finalOnly =
            state.run.stepCount + 1 >= state.run.maxSteps ||
            state.run.toolCallCount >= state.run.maxToolCalls;
          let offeredToolNames: readonly AgentToolName[];
          let actions;
          try {
            const descriptors = finalOnly
              ? []
              : dependencies.toolRegistry.descriptorsFor(
                  state.run.toolNames as AgentToolName[],
                );
            offeredToolNames = descriptors.map((descriptor) => descriptor.name);
            actions = createAgentDecisionActions(descriptors);
          } catch {
            return await failRun(fence, "agent_persistence_failed", true);
          }
          const maxAttempts = state.run.providerAttempts;
          if (maxAttempts !== 1 && maxAttempts !== 2) {
            return await failRun(fence, "agent_persistence_failed", true);
          }

          let decision: AgentDecision;
          try {
            decision = await runExternal({
              callerSignal: input.signal,
              deadlineAt: state.run.deadlineAt,
              operation: (signal) =>
                dependencies.decisionProvider.decide({
                  promptVersion: state.run.promptVersion,
                  context: projection.context,
                  offeredActions: actions,
                  limits: {
                    timeoutMs: state.run.providerDecisionTimeoutSeconds * 1_000,
                    maxAttempts,
                    responseMaxBytes: state.run.providerResponseMaxBytes,
                  },
                  signal,
                }),
            });
          } catch (error: unknown) {
            const checked = await recheck(fence, input.signal);
            if (isOutcome(checked)) return checked;
            if (isBoundaryReason(error, CALLER_INTERRUPTED)) {
              return outcome(input.runId, "interrupted");
            }
            if (isBoundaryReason(error, RUN_DEADLINE)) {
              return await failRun(fence, "agent_wall_time_exceeded", false);
            }
            const code = isAgentDecisionProviderError(error)
              ? error.code
              : "agent_provider_unavailable";
            return await failRun(fence, code, true);
          }

          const checked = await recheck(fence, input.signal);
          if (isOutcome(checked)) return checked;
          if (snapshotKey(checked) !== snapshotKey(state)) {
            return outcome(input.runId, "stale");
          }
          if (decision.kind === "final_answer") {
            return await completeFinal({
              fence,
              callerSignal: input.signal,
              state: checked,
              decision,
            });
          }

          let prepared: PreparedAgentToolCall;
          try {
            prepared = dependencies.toolRegistry.prepareCall(
              offeredToolNames,
              decision.toolName,
              decision.arguments,
            );
          } catch (error: unknown) {
            const code = isAgentToolError(error)
              ? error.code
              : "agent_tool_invalid_response";
            return await failRun(fence, code, true);
          }
          const result = await executePreparedTool({
            fence,
            callerSignal: input.signal,
            state: checked,
            prepared,
          });
          if (result) return result;
        }
      } catch {
        return outcome(input.runId, "interrupted", "agent_persistence_failed");
      }
    },
  });
}
