import { describe, expect, it } from "vitest";

import {
  AGENT_EXECUTION_LIMITS,
  AgentStateError,
  assertAgentRunTransition,
  assertValidAgentRunTerminalState,
  canTransitionAgentRunStatus,
  initializeAgentRunTiming,
  isTerminalAgentRunStatus,
  nextAgentRunAttempt,
  reserveAgentStep,
} from "../../server/modules/agents/state";

describe("Agent run state transitions", () => {
  it.each([
    ["queued", "running"],
    ["queued", "cancelled"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "cancelled"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionAgentRunStatus(from, to)).toBe(true);
    expect(() => assertAgentRunTransition(from, to)).not.toThrow();
  });

  it.each(["completed", "failed", "cancelled"] as const)("keeps %s terminal and immutable", (status) => {
    expect(isTerminalAgentRunStatus(status)).toBe(true);
    for (const target of ["queued", "running", "completed", "failed", "cancelled"] as const) {
      expect(canTransitionAgentRunStatus(status, target)).toBe(false);
    }
  });

  it("rejects illegal and same-state transitions", () => {
    expect(() => assertAgentRunTransition("queued", "completed")).toThrowError(AgentStateError);
    expect(() => assertAgentRunTransition("running", "running")).toThrowError(AgentStateError);
  });
});

describe("Agent retry and accounting rules", () => {
  it("creates a new attempt only after a terminal run", () => {
    expect(nextAgentRunAttempt(1, "completed")).toBe(2);
    expect(nextAgentRunAttempt(4, "failed")).toBe(5);
    expect(nextAgentRunAttempt(2, "cancelled")).toBe(3);
    expect(() => nextAgentRunAttempt(1, "running")).toThrowError(AgentStateError);
  });

  it("increments step and tool-call counters without mutating the input", () => {
    const initial = { stepCount: 0, toolCallCount: 0 };
    expect(reserveAgentStep(initial, "tool_call")).toEqual({ stepCount: 1, toolCallCount: 1 });
    expect(reserveAgentStep(initial, "final_answer")).toEqual({ stepCount: 1, toolCallCount: 0 });
    expect(reserveAgentStep(initial, "decision_error")).toEqual({ stepCount: 1, toolCallCount: 0 });
    expect(initial).toEqual({ stepCount: 0, toolCallCount: 0 });
  });

  it("enforces the fixed step and tool limits before reservation", () => {
    expect(() => reserveAgentStep({ stepCount: AGENT_EXECUTION_LIMITS.maxSteps, toolCallCount: 0 }, "final_answer")).toThrowError("step limit exceeded");
    expect(() => reserveAgentStep({ stepCount: 6, toolCallCount: AGENT_EXECUTION_LIMITS.maxToolCalls }, "tool_call")).toThrowError("tool-call limit exceeded");
  });
});

describe("Agent timing and terminal invariants", () => {
  it("sets the deadline once and preserves it during recovery", () => {
    const firstClaim = initializeAgentRunTiming(
      { startedAt: null, deadlineAt: null },
      new Date("2026-09-03T00:00:00.000Z"),
    );
    expect(firstClaim.deadlineAt.toISOString()).toBe("2026-09-03T00:03:00.000Z");

    const reclaimed = initializeAgentRunTiming(
      firstClaim,
      new Date("2026-09-03T00:02:30.000Z"),
    );
    expect(reclaimed.startedAt).toBe(firstClaim.startedAt);
    expect(reclaimed.deadlineAt).toBe(firstClaim.deadlineAt);
  });

  it("requires completed runs to have exactly one last final-answer step", () => {
    const valid = {
      finalAnswer: "Grounded answer [E1].",
      errorCode: null,
      finishedAt: new Date(),
      leaseOwnerId: null,
      leaseExpiresAt: null,
      completedFinalAnswerSteps: 1,
      hasStepsAfterFinalAnswer: false,
    };
    expect(() => assertValidAgentRunTerminalState("completed", valid)).not.toThrow();
    expect(() => assertValidAgentRunTerminalState("completed", { ...valid, completedFinalAnswerSteps: 0 })).toThrowError(AgentStateError);
    expect(() => assertValidAgentRunTerminalState("completed", { ...valid, hasStepsAfterFinalAnswer: true })).toThrowError(AgentStateError);
  });

  it("requires failed runs to have a code and all terminal runs to release leases", () => {
    const failed = {
      finalAnswer: null,
      errorCode: "agent_provider_timeout",
      finishedAt: new Date(),
      leaseOwnerId: null,
      leaseExpiresAt: null,
      completedFinalAnswerSteps: 0,
      hasStepsAfterFinalAnswer: false,
    };
    expect(() => assertValidAgentRunTerminalState("failed", failed)).not.toThrow();
    expect(() => assertValidAgentRunTerminalState("failed", { ...failed, errorCode: null })).toThrowError(AgentStateError);
    expect(() => assertValidAgentRunTerminalState("cancelled", { ...failed, errorCode: null })).not.toThrow();
    expect(() => assertValidAgentRunTerminalState("cancelled", { ...failed, errorCode: null, leaseOwnerId: "worker-1" })).toThrowError(AgentStateError);
  });
});
