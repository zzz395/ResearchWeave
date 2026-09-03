import {
  AGENT_CONTEXT_MAX_BYTES,
  AGENT_FINAL_ANSWER_MAX_CHARACTERS,
  AGENT_MAX_EVIDENCE,
  AGENT_MAX_STEPS,
  AGENT_MAX_TOOL_CALLS,
  AGENT_OBSERVATION_MAX_BYTES,
  AGENT_PROVIDER_RESPONSE_MAX_BYTES,
  type AgentExecutionLimits,
  type AgentRunStatus,
  type AgentStepKind,
} from "../../../shared/contracts/agents";

export const AGENT_EXECUTION_LIMITS = Object.freeze({
  maxSteps: AGENT_MAX_STEPS,
  maxToolCalls: AGENT_MAX_TOOL_CALLS,
  wallTimeSeconds: 180,
  providerDecisionTimeoutSeconds: 30,
  toolTimeoutSeconds: 45,
  providerAttempts: 2,
  providerResponseMaxBytes: AGENT_PROVIDER_RESPONSE_MAX_BYTES,
  observationMaxBytes: AGENT_OBSERVATION_MAX_BYTES,
  contextMaxBytes: AGENT_CONTEXT_MAX_BYTES,
  finalAnswerMaxCharacters: AGENT_FINAL_ANSWER_MAX_CHARACTERS,
  maxEvidence: AGENT_MAX_EVIDENCE,
} as const satisfies AgentExecutionLimits);

const terminalStatuses = new Set<AgentRunStatus>(["completed", "failed", "cancelled"]);
const allowedTransitions: Readonly<Record<AgentRunStatus, ReadonlySet<AgentRunStatus>>> = {
  queued: new Set(["running", "cancelled"]),
  running: new Set(["completed", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export class AgentStateError extends Error {
  constructor(readonly code: "invalid_transition" | "retry_not_allowed" | "limit_exceeded" | "invalid_terminal_state", message: string) {
    super(message);
    this.name = "AgentStateError";
  }
}

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return terminalStatuses.has(status);
}

export function canTransitionAgentRunStatus(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return allowedTransitions[from].has(to);
}

export function assertAgentRunTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!canTransitionAgentRunStatus(from, to)) {
    throw new AgentStateError("invalid_transition", `Agent run cannot transition from ${from} to ${to}.`);
  }
}

export function nextAgentRunAttempt(latestAttemptNumber: number, latestStatus: AgentRunStatus): number {
  if (!Number.isInteger(latestAttemptNumber) || latestAttemptNumber < 1) {
    throw new TypeError("Latest Agent run attempt number must be a positive integer.");
  }
  if (!isTerminalAgentRunStatus(latestStatus)) {
    throw new AgentStateError("retry_not_allowed", "Only a terminal Agent run can be retried.");
  }
  return latestAttemptNumber + 1;
}

export interface AgentRunCounters {
  stepCount: number;
  toolCallCount: number;
}

export function reserveAgentStep(
  counters: Readonly<AgentRunCounters>,
  kind: AgentStepKind,
  limits: Readonly<Pick<AgentExecutionLimits, "maxSteps" | "maxToolCalls">> = AGENT_EXECUTION_LIMITS,
): AgentRunCounters {
  if (!Number.isInteger(counters.stepCount) || counters.stepCount < 0 || !Number.isInteger(counters.toolCallCount) || counters.toolCallCount < 0) {
    throw new TypeError("Agent run counters must be nonnegative integers.");
  }
  if (counters.stepCount >= limits.maxSteps) {
    throw new AgentStateError("limit_exceeded", "Agent run step limit exceeded.");
  }
  if (kind === "tool_call" && counters.toolCallCount >= limits.maxToolCalls) {
    throw new AgentStateError("limit_exceeded", "Agent run tool-call limit exceeded.");
  }
  return {
    stepCount: counters.stepCount + 1,
    toolCallCount: counters.toolCallCount + (kind === "tool_call" ? 1 : 0),
  };
}

export interface AgentRunTiming {
  startedAt: Date | null;
  deadlineAt: Date | null;
}

export interface InitializedAgentRunTiming {
  startedAt: Date;
  deadlineAt: Date;
}

export function initializeAgentRunTiming(
  timing: Readonly<AgentRunTiming>,
  now: Date,
  wallTimeSeconds = AGENT_EXECUTION_LIMITS.wallTimeSeconds,
): InitializedAgentRunTiming {
  if (!Number.isInteger(wallTimeSeconds) || wallTimeSeconds <= 0) {
    throw new TypeError("Agent wall time must be a positive number of seconds.");
  }
  if ((timing.startedAt === null) !== (timing.deadlineAt === null)) {
    throw new TypeError("Agent run start and deadline must either both exist or both be absent.");
  }
  if (timing.startedAt && timing.deadlineAt) {
    if (timing.deadlineAt.getTime() <= timing.startedAt.getTime()) {
      throw new TypeError("Agent run deadline must be later than its start time.");
    }
    return { startedAt: timing.startedAt, deadlineAt: timing.deadlineAt };
  }
  if (Number.isNaN(now.getTime())) throw new TypeError("Agent run start time must be valid.");
  const startedAt = new Date(now.getTime());
  return {
    startedAt,
    deadlineAt: new Date(startedAt.getTime() + wallTimeSeconds * 1_000),
  };
}

export interface AgentRunCompletionState {
  finalAnswer: string | null;
  errorCode: string | null;
  finishedAt: Date | null;
  leaseOwnerId: string | null;
  leaseExpiresAt: Date | null;
  completedFinalAnswerSteps: number;
  hasStepsAfterFinalAnswer: boolean;
}

export function assertValidAgentRunTerminalState(
  status: Extract<AgentRunStatus, "completed" | "failed" | "cancelled">,
  state: Readonly<AgentRunCompletionState>,
): void {
  const hasLease = state.leaseOwnerId !== null || state.leaseExpiresAt !== null;
  if (hasLease || state.finishedAt === null) {
    throw new AgentStateError("invalid_terminal_state", "A terminal Agent run requires a finish time and cannot retain a lease.");
  }
  if (status === "completed") {
    if (
      state.finalAnswer === null ||
      state.finalAnswer.trim().length === 0 ||
      state.errorCode !== null ||
      state.completedFinalAnswerSteps !== 1 ||
      state.hasStepsAfterFinalAnswer
    ) {
      throw new AgentStateError("invalid_terminal_state", "A completed Agent run requires exactly one final answer as its last step.");
    }
    return;
  }
  if (state.finalAnswer !== null || state.completedFinalAnswerSteps !== 0) {
    throw new AgentStateError("invalid_terminal_state", "A non-completed Agent run cannot contain a final answer.");
  }
  if (status === "failed" && (state.errorCode === null || state.errorCode.length === 0)) {
    throw new AgentStateError("invalid_terminal_state", "A failed Agent run requires a safe error code.");
  }
  if (status === "cancelled" && state.errorCode !== null) {
    throw new AgentStateError("invalid_terminal_state", "A cancelled Agent run cannot contain a failure code.");
  }
}
