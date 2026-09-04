import {
  agentDecisionContextSchema,
  type AgentDecisionCompletedToolCall,
  type AgentDecisionContext,
} from "./decision-provider";
import type { AgentRunStepRecord } from "../../db/schema";
import {
  agentErrorCodeSchema,
  type AgentErrorCode,
  type AgentObservation,
  type AgentToolName,
} from "../../../shared/contracts/agents";
import type { AgentExecutionState } from "./repository";
import {
  agentToolExecutionResultSchema,
  type AgentToolExecutionResult,
} from "./tools/contracts";

type ContextProjectionErrorCode = Extract<
  AgentErrorCode,
  "agent_context_limit_exceeded" | "agent_evidence_limit_exceeded" | "agent_persistence_failed"
>;

export class AgentExecutionContextError extends Error {
  readonly code: ContextProjectionErrorCode;

  constructor(code: ContextProjectionErrorCode) {
    agentErrorCodeSchema.parse(code);
    super("The persisted Agent execution context is invalid.");
    this.name = "AgentExecutionContextError";
    this.code = code;
    this.stack = undefined;
  }

  toJSON(): { code: ContextProjectionErrorCode } {
    return { code: this.code };
  }
}

export interface AgentDecisionContextProjection {
  readonly context: AgentDecisionContext;
  readonly contextBytes: number;
  readonly evidenceCount: number;
  readonly runId: string;
  readonly persistedStepCount: number;
  readonly maxEvidence: number;
  readonly contextMaxBytes: number;
}

const textEncoder = new TextEncoder();

function failPersistence(): never {
  throw new AgentExecutionContextError("agent_persistence_failed");
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function contextBytes(context: AgentDecisionContext): number {
  return textEncoder.encode(JSON.stringify(context)).byteLength;
}

function evidenceNumber(key: string): number | null {
  const match = /^E([1-9]|[12][0-9]|3[0-2])$/u.exec(key);
  return match ? Number(match[1]) : null;
}

function validateStepOrder(state: AgentExecutionState): void {
  if (
    state.run.status !== "running" ||
    state.task.id !== state.run.taskId ||
    state.task.spaceId !== state.run.spaceId ||
    state.steps.length !== state.run.stepCount
  ) {
    failPersistence();
  }

  let toolCallCount = 0;
  let runningCount = 0;
  for (const [index, step] of state.steps.entries()) {
    if (step.runId !== state.run.id || step.sequence !== index + 1) failPersistence();
    if (step.kind === "tool_call") toolCallCount += 1;
    if (step.status === "running") {
      runningCount += 1;
      if (step.kind !== "tool_call" || index !== state.steps.length - 1) failPersistence();
    }
  }
  if (toolCallCount !== state.run.toolCallCount || runningCount > 1) failPersistence();
}

function validateEvidence(
  state: AgentExecutionState,
  completedToolSteps: ReadonlyMap<string, AgentRunStepRecord>,
): ReadonlyMap<string, readonly string[]> {
  if (state.evidence.length > state.run.maxEvidence) {
    throw new AgentExecutionContextError("agent_evidence_limit_exceeded");
  }
  const byStep = new Map<string, string[]>();
  const evidenceIds = new Set<string>();
  for (const [index, item] of state.evidence.entries()) {
    if (
      item.runId !== state.run.id ||
      item.evidenceKey !== `E${index + 1}` ||
      evidenceNumber(item.evidenceKey) !== index + 1 ||
      evidenceIds.has(item.evidenceKey) ||
      !completedToolSteps.has(item.stepId)
    ) {
      failPersistence();
    }
    evidenceIds.add(item.evidenceKey);
    const ids = byStep.get(item.stepId) ?? [];
    ids.push(item.evidenceKey);
    byStep.set(item.stepId, ids);
  }
  return byStep;
}

function completedCall(
  step: AgentRunStepRecord,
  evidenceIds: readonly string[],
): AgentDecisionCompletedToolCall {
  if (
    step.kind !== "tool_call" ||
    step.status !== "completed" ||
    step.toolName === null ||
    !isJsonObject(step.safeArgumentsJson) ||
    !isJsonObject(step.observationJson)
  ) {
    failPersistence();
  }
  return {
    sequence: step.sequence,
    toolName: step.toolName as AgentToolName,
    safeArguments: step.safeArgumentsJson,
    observation: step.observationJson as AgentObservation,
    evidenceIds: [...evidenceIds],
  };
}

function finalizeProjection(input: {
  context: AgentDecisionContext;
  evidenceCount: number;
  runId: string;
  persistedStepCount: number;
  maxEvidence: number;
  contextMaxBytes: number;
}): AgentDecisionContextProjection {
  const parsed = agentDecisionContextSchema.safeParse(input.context);
  if (!parsed.success) failPersistence();
  const frozenContext = deepFreeze(parsed.data);
  const bytes = contextBytes(frozenContext);
  if (bytes > input.contextMaxBytes) {
    throw new AgentExecutionContextError("agent_context_limit_exceeded");
  }
  return Object.freeze({
    context: frozenContext,
    contextBytes: bytes,
    evidenceCount: input.evidenceCount,
    runId: input.runId,
    persistedStepCount: input.persistedStepCount,
    maxEvidence: input.maxEvidence,
    contextMaxBytes: input.contextMaxBytes,
  });
}

export function buildAgentDecisionContext(
  state: AgentExecutionState,
): AgentDecisionContextProjection {
  validateStepOrder(state);
  const completedToolSteps = new Map(
    state.steps
      .filter((step) => step.kind === "tool_call" && step.status === "completed")
      .map((step) => [step.id, step]),
  );
  const evidenceByStep = validateEvidence(state, completedToolSteps);
  const completedToolCalls = state.steps
    .filter((step) => step.kind === "tool_call" && step.status === "completed")
    .map((step) => completedCall(step, evidenceByStep.get(step.id) ?? []));

  const projection = finalizeProjection({
    context: { taskPrompt: state.task.prompt, completedToolCalls },
    evidenceCount: state.evidence.length,
    runId: state.run.id,
    persistedStepCount: state.run.stepCount,
    maxEvidence: state.run.maxEvidence,
    contextMaxBytes: state.run.contextMaxBytes,
  });
  const hasTerminalToolStep = state.steps.some(
    (step) => step.kind === "tool_call" && step.status !== "running",
  );
  if (
    (hasTerminalToolStep && state.run.contextBytes !== projection.contextBytes) ||
    (!hasTerminalToolStep && state.run.contextBytes !== 0)
  ) {
    failPersistence();
  }
  return projection;
}

export function appendCompletedToolCall(
  projection: AgentDecisionContextProjection,
  step: AgentRunStepRecord,
  result: AgentToolExecutionResult,
): AgentDecisionContextProjection {
  const parsedResult = agentToolExecutionResultSchema.safeParse(result);
  if (
    !parsedResult.success ||
    step.runId !== projection.runId ||
    step.kind !== "tool_call" ||
    (step.status !== "running" && step.status !== "completed") ||
    step.sequence !== projection.persistedStepCount ||
    step.toolName === null ||
    !isJsonObject(step.safeArgumentsJson)
  ) {
    failPersistence();
  }
  const nextEvidenceCount = projection.evidenceCount + parsedResult.data.evidence.length;
  if (nextEvidenceCount > projection.maxEvidence) {
    throw new AgentExecutionContextError("agent_evidence_limit_exceeded");
  }
  const evidenceIds = parsedResult.data.evidence.map(
    (_, index) => `E${projection.evidenceCount + index + 1}`,
  );
  const nextCall: AgentDecisionCompletedToolCall = {
    sequence: step.sequence,
    toolName: step.toolName as AgentToolName,
    safeArguments: step.safeArgumentsJson,
    observation: parsedResult.data.observation,
    evidenceIds,
  };
  return finalizeProjection({
    context: {
      taskPrompt: projection.context.taskPrompt,
      completedToolCalls: [...projection.context.completedToolCalls, nextCall],
    },
    evidenceCount: nextEvidenceCount,
    runId: projection.runId,
    persistedStepCount: projection.persistedStepCount,
    maxEvidence: projection.maxEvidence,
    contextMaxBytes: projection.contextMaxBytes,
  });
}
