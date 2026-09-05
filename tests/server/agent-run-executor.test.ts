import { randomUUID } from "node:crypto";

import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentRunEvidenceRecord,
  AgentRunRecord,
  AgentRunStepRecord,
  AgentTaskRecord,
} from "../../server/db/schema";
import {
  AgentDecisionProviderError,
  type AgentDecision,
  type AgentDecisionProviderInput,
} from "../../server/modules/agents/decision-provider";
import type {
  AgentExecutionState,
  AgentRepository,
  AgentWorkerFence,
} from "../../server/modules/agents/repository";
import {
  createAgentRunExecutor,
  type AgentExecutionLeaseCheckpoint,
} from "../../server/modules/agents/run-executor";
import {
  agentToolExecutionResultSchema,
  AgentToolError,
  type AgentTool,
} from "../../server/modules/agents/tools/contracts";
import { createAgentToolRegistry } from "../../server/modules/agents/tools/registry";

const NOW = new Date("2026-09-04T00:00:00.000Z");
const RUN_ID = "50000000-0000-4000-8000-000000000001";
const TASK_ID = "40000000-0000-4000-8000-000000000001";
const SPACE_ID = "20000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const LEASE_ID = "90000000-0000-4000-8000-000000000001";

function task(): AgentTaskRecord {
  return {
    id: TASK_ID,
    spaceId: SPACE_ID,
    agentId: "30000000-0000-4000-8000-000000000001",
    createdByUserId: ACTOR_ID,
    prompt: "Find grounded research.",
    clientRequestId: "91000000-0000-4000-8000-000000000001",
    requestFingerprint: "a".repeat(64),
    createdAt: NOW,
  };
}

function run(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: RUN_ID,
    taskId: TASK_ID,
    spaceId: SPACE_ID,
    actorUserId: ACTOR_ID,
    attemptNumber: 1,
    status: "running",
    definitionRevision: 1,
    toolNames: ["search_arxiv"],
    maxSteps: 8,
    maxToolCalls: 6,
    wallTimeSeconds: 180,
    providerDecisionTimeoutSeconds: 30,
    toolTimeoutSeconds: 1,
    providerAttempts: 1,
    providerResponseMaxBytes: 65_536,
    observationMaxBytes: 32_768,
    contextMaxBytes: 131_072,
    finalAnswerMaxCharacters: 8_000,
    maxEvidence: 32,
    promptVersion: "research-agent-v1",
    providerModel: "test-model",
    stepCount: 0,
    toolCallCount: 0,
    contextBytes: 0,
    leaseOwnerId: LEASE_ID,
    leaseGeneration: 1,
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    cancelRequestedAt: null,
    cancelRequestedByUserId: null,
    startedAt: NOW,
    deadlineAt: new Date(NOW.getTime() + 180_000),
    finishedAt: null,
    errorCode: null,
    finalStatus: null,
    finalAnswer: null,
    retryClientRequestId: null,
    retryRequestFingerprint: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function evidenceRecord(
  evidenceKey: string,
  stepId: string,
  id = randomUUID(),
): AgentRunEvidenceRecord {
  return {
    id,
    runId: RUN_ID,
    stepId,
    evidenceKey,
    kind: "arxiv_abstract",
    paperId: null,
    documentId: null,
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v1",
    sourceVersion: 1,
    sourceTitle: "Research",
    sourceUrl: "https://arxiv.org/abs/2609.00001",
    originalFilename: null,
    contentHash: null,
    chunkOrdinal: null,
    pageNumber: null,
    startOffset: null,
    endOffset: null,
    excerpt: "Grounded excerpt",
    finalOrdinal: null,
    createdAt: NOW,
  };
}

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

class RepositoryDouble {
  readonly state: AgentExecutionState;
  readonly events: string[] = [];
  accessRevoked = false;
  throwOnRead = false;
  beforeCompleteTool?: () => void;
  beforeCompleteRun?: () => void;

  constructor(runOverrides: Partial<AgentRunRecord> = {}) {
    this.state = { task: task(), run: run(runOverrides), steps: [], evidence: [] };
  }

  private fenced(input: AgentWorkerFence): boolean {
    return (
      this.state.run.status === "running" &&
      input.runId === this.state.run.id &&
      input.leaseOwnerId === this.state.run.leaseOwnerId &&
      input.leaseGeneration === this.state.run.leaseGeneration
    );
  }

  private guard(input: AgentWorkerFence, at: Date) {
    if (!this.fenced(input)) return "stale" as const;
    if (this.state.run.cancelRequestedAt) return "cancel_requested" as const;
    if (this.accessRevoked) return "access_revoked" as const;
    if (!this.state.run.deadlineAt || this.state.run.deadlineAt <= at) {
      return "deadline_exceeded" as const;
    }
    return "allowed" as const;
  }

  readonly repository: ExecutorRepository = {
    readExecutionState: async (input) => {
      await Promise.resolve();
      this.events.push("read");
      if (this.throwOnRead) throw new Error("database password leaked");
      const guard = this.guard(input, input.now);
      return guard === "allowed"
        ? { status: "ok" as const, state: this.state }
        : { status: guard };
    },
    reserveStep: async (input) => {
      await Promise.resolve();
      this.events.push(input.resumeStepId ? "resume" : "reserve");
      const guard = this.guard(input, input.now);
      if (guard !== "allowed") return { status: guard };
      const incomplete = this.state.steps.find((step) => step.status === "running");
      if (incomplete) {
        if (
          input.resumeStepId !== incomplete.id ||
          input.toolName !== incomplete.toolName ||
          JSON.stringify(input.safeArguments) !== JSON.stringify(incomplete.safeArgumentsJson)
        ) {
          return { status: "incomplete_step" as const };
        }
        incomplete.executionCount += 1;
        incomplete.startedAt = input.now;
        return { status: "resumed" as const, step: incomplete, run: this.state.run };
      }
      if (this.state.run.stepCount >= this.state.run.maxSteps) {
        return { status: "step_limit_exceeded" as const };
      }
      if (this.state.run.toolCallCount >= this.state.run.maxToolCalls) {
        return { status: "tool_call_limit_exceeded" as const };
      }
      const step: AgentRunStepRecord = {
        id: input.stepId,
        runId: RUN_ID,
        sequence: this.state.run.stepCount + 1,
        kind: "tool_call",
        status: "running",
        toolName: input.toolName,
        safeArgumentsJson: input.safeArguments,
        observationJson: null,
        executionCount: 1,
        errorCode: null,
        startedAt: input.now,
        completedAt: null,
        durationMs: null,
      };
      this.state.steps.push(step);
      this.state.run.stepCount += 1;
      this.state.run.toolCallCount += 1;
      return { status: "reserved" as const, step, run: this.state.run };
    },
    completeToolStepWithEvidence: async (input) => {
      await Promise.resolve();
      this.events.push("complete-tool");
      this.beforeCompleteTool?.();
      const guard = this.guard(input, input.now);
      if (guard !== "allowed") return { status: guard };
      const step = this.state.steps.find(
        (item) => item.id === input.stepId && item.status === "running",
      );
      if (!step) return { status: "stale" as const };
      step.status = "completed";
      step.observationJson = input.observation;
      step.completedAt = input.now;
      step.durationMs = 1;
      const evidence = input.evidence.map((_, index) =>
        evidenceRecord(`E${this.state.evidence.length + index + 1}`, step.id),
      );
      this.state.evidence.push(...evidence);
      this.state.run.contextBytes = input.contextBytes;
      return { status: "completed" as const, step, evidence, run: this.state.run };
    },
    failStep: async (input) => {
      await Promise.resolve();
      this.events.push(`fail-step:${input.errorCode}`);
      const guard = this.guard(input, input.now);
      if (guard !== "allowed") {
        if (guard === "cancel_requested") this.cancel();
        return { status: guard };
      }
      const step = this.state.steps.find(
        (item) => item.id === input.stepId && item.status === "running",
      );
      if (!step) return { status: "stale" as const };
      step.status = "failed";
      step.errorCode = input.errorCode;
      step.completedAt = input.now;
      step.durationMs = 1;
      this.state.run.contextBytes = input.contextBytes;
      return { status: "failed" as const, step, run: this.state.run };
    },
    completeRun: async (input) => {
      await Promise.resolve();
      this.events.push("complete-run");
      this.beforeCompleteRun?.();
      const guard = this.guard(input, input.now);
      if (guard !== "allowed") {
        if (guard === "cancel_requested") this.cancel();
        return { status: guard };
      }
      if (this.state.run.stepCount >= this.state.run.maxSteps) {
        return { status: "step_limit_exceeded" as const };
      }
      if (
        input.finalResult.evidenceIds.some(
          (id) =>
            !this.state.evidence.some(
              (item) =>
                item.evidenceKey === id &&
                this.state.steps.some(
                  (step) => step.id === item.stepId && step.status === "completed",
                ),
            ),
        )
      ) {
        return { status: "invalid_evidence" as const };
      }
      const step: AgentRunStepRecord = {
        id: input.finalStepId,
        runId: RUN_ID,
        sequence: this.state.run.stepCount + 1,
        kind: "final_answer",
        status: "completed",
        toolName: null,
        safeArgumentsJson: null,
        observationJson: null,
        executionCount: 1,
        errorCode: null,
        startedAt: input.now,
        completedAt: input.now,
        durationMs: 0,
      };
      this.state.steps.push(step);
      this.state.run.stepCount += 1;
      this.state.run.status = "completed";
      this.state.run.finalStatus = input.finalResult.status;
      this.state.run.finalAnswer = input.finalResult.answer;
      this.state.run.finishedAt = input.now;
      this.state.run.leaseOwnerId = null;
      this.state.run.leaseExpiresAt = null;
      input.finalResult.evidenceIds.forEach((id, index) => {
        const evidence = this.state.evidence.find((item) => item.evidenceKey === id);
        if (evidence) evidence.finalOrdinal = index + 1;
      });
      return { status: "completed" as const, run: this.state.run, step };
    },
    failRun: async (input) => {
      await Promise.resolve();
      this.events.push(`fail-run:${input.errorCode}`);
      const guard = this.guard(input, input.now);
      if (guard === "cancel_requested") {
        this.cancel();
        return { status: "cancel_requested" as const };
      }
      if (guard !== "allowed") {
        if (guard === "deadline_exceeded" || guard === "access_revoked") {
          this.fail(input.errorCode, input.now);
        }
        return { status: guard };
      }
      if (input.decisionErrorStepId && this.state.run.stepCount >= this.state.run.maxSteps) {
        return { status: "step_limit_exceeded" as const };
      }
      for (const step of this.state.steps.filter((item) => item.status === "running")) {
        step.status = "failed";
        step.errorCode = input.errorCode;
        step.completedAt = input.now;
        step.durationMs = 1;
      }
      if (input.decisionErrorStepId) {
        this.state.steps.push({
          id: input.decisionErrorStepId,
          runId: RUN_ID,
          sequence: this.state.run.stepCount + 1,
          kind: "decision_error",
          status: "failed",
          toolName: null,
          safeArgumentsJson: null,
          observationJson: null,
          executionCount: 1,
          errorCode: input.errorCode,
          startedAt: input.now,
          completedAt: input.now,
          durationMs: 0,
        });
        this.state.run.stepCount += 1;
      }
      this.fail(input.errorCode, input.now);
      return { status: "failed" as const, run: this.state.run };
    },
    markCancelled: async (input) => {
      await Promise.resolve();
      this.events.push("mark-cancelled");
      if (!this.fenced(input)) return { status: "stale" as const };
      if (!this.state.run.cancelRequestedAt) return { status: "not_requested" as const };
      this.cancel();
      return { status: "cancelled" as const, run: this.state.run };
    },
  };

  private fail(errorCode: string, at: Date): void {
    for (const step of this.state.steps.filter((item) => item.status === "running")) {
      step.status = "failed";
      step.errorCode = errorCode;
      step.completedAt = at;
      step.durationMs = 1;
    }
    this.state.run.status = "failed";
    this.state.run.errorCode = errorCode;
    this.state.run.finishedAt = at;
    this.state.run.leaseOwnerId = null;
    this.state.run.leaseExpiresAt = null;
  }

  private cancel(): void {
    for (const step of this.state.steps.filter((item) => item.status === "running")) {
      step.status = "cancelled";
      step.completedAt = NOW;
      step.durationMs = 1;
    }
    this.state.run.status = "cancelled";
    this.state.run.finishedAt = NOW;
    this.state.run.leaseOwnerId = null;
    this.state.run.leaseExpiresAt = null;
  }
}

type TestTool = AgentTool<{ query: string }>;

function tool(execute?: TestTool["execute"]): TestTool {
  return {
    name: "search_arxiv",
    description: "Search test research.",
    argumentsSchema: z.object({ query: z.string().trim().min(1) }).strict(),
    resultSchema: agentToolExecutionResultSchema,
    isAvailable: () => true,
    execute:
      execute ??
      (() =>
        Promise.resolve({
          observation: { summary: "Safe observation" },
          evidence: [
            {
              kind: "arxiv_abstract",
              paperId: null,
              canonicalArxivId: "2609.00001",
              versionedArxivId: "2609.00001v1",
              sourceVersion: 1,
              title: "Research",
              url: "https://arxiv.org/abs/2609.00001",
              excerpt: "Grounded excerpt",
            },
          ],
        })),
  };
}

function harness(input: {
  decisions?: AgentDecision[];
  decide?: (input: AgentDecisionProviderInput) => Promise<AgentDecision>;
  tool?: TestTool;
  run?: Partial<AgentRunRecord>;
  providerModel?: string;
  leaseCheckpoint?: AgentExecutionLeaseCheckpoint;
} = {}) {
  const repository = new RepositoryDouble(input.run);
  const decisions = [...(input.decisions ?? [])];
  const decide = vi.fn(
    input.decide ??
      (() => {
        const decision = decisions.shift();
        if (!decision) throw new Error("No scripted decision.");
        return Promise.resolve(decision);
      }),
  );
  const registry = createAgentToolRegistry([input.tool ?? tool()]);
  const executor = createAgentRunExecutor({
    repository: repository.repository,
    decisionProvider: { model: input.providerModel ?? "test-model", decide },
    toolRegistry: registry,
    now: () => NOW,
  });
  return {
    repository,
    decide,
    execute: (signal = new AbortController().signal, leaseGeneration = 1) =>
      executor.execute({
        runId: RUN_ID,
        leaseOwnerId: LEASE_ID,
        leaseGeneration,
        signal,
        ...(input.leaseCheckpoint ? { leaseCheckpoint: input.leaseCheckpoint } : {}),
      }),
  };
}

const toolDecision: AgentDecision = {
  kind: "tool_call",
  toolName: "search_arxiv",
  arguments: { query: "agents" },
};
const groundedFinal: AgentDecision = {
  kind: "final_answer",
  result: { status: "answered", answer: "Grounded result [E1]", evidenceIds: ["E1"] },
};
const insufficientFinal: AgentDecision = {
  kind: "final_answer",
  result: { status: "insufficient_context", answer: "Not enough context.", evidenceIds: [] },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentRunExecutor", () => {
  it("executes Tool -> Evidence -> final answer through the fixed Registry path", async () => {
    const test = harness({ decisions: [toolDecision, groundedFinal] });
    const result = await test.execute();

    expect(result).toEqual({ status: "completed", runId: RUN_ID });
    expect(test.repository.events).toContain("reserve");
    expect(test.repository.events).toContain("complete-tool");
    expect(test.repository.events.at(-1)).toBe("complete-run");
    expect(test.repository.state.evidence.map((item) => item.evidenceKey)).toEqual(["E1"]);
    expect(test.repository.state.run.contextBytes).toBeGreaterThan(0);
    expect(test.decide.mock.calls[1]?.[0].context.completedToolCalls[0]).toMatchObject({
      evidenceIds: ["E1"],
      safeArguments: { query: "agents" },
      observation: { summary: "Safe observation" },
    });
  });

  it("checkpoints the worker-owned lease after each persisted Tool boundary", async () => {
    const observedBoundaries: string[] = [];
    const testRef: { current?: ReturnType<typeof harness> } = {};
    const leaseCheckpoint = vi.fn(() => {
      observedBoundaries.push(testRef.current?.repository.events.at(-1) ?? "missing");
      return Promise.resolve("continue" as const);
    });
    const test = harness({ decisions: [toolDecision, groundedFinal], leaseCheckpoint });
    testRef.current = test;

    expect(await test.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(observedBoundaries).toEqual(["reserve", "complete-tool"]);

    const failedBoundaries: string[] = [];
    const failedRef: { current?: ReturnType<typeof harness> } = {};
    const failedCheckpoint = vi.fn(() => {
      failedBoundaries.push(failedRef.current?.repository.events.at(-1) ?? "missing");
      return Promise.resolve("continue" as const);
    });
    const failed = harness({
      decisions: [toolDecision, insufficientFinal],
      tool: tool(() => {
        throw new AgentToolError("research_upstream_timeout");
      }),
      leaseCheckpoint: failedCheckpoint,
    });
    failedRef.current = failed;

    expect(await failed.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(failedBoundaries).toEqual(["reserve", "fail-step:research_upstream_timeout"]);
  });

  it("stops locally when the worker lease checkpoint declines or throws", async () => {
    const executeTool = vi.fn(() =>
      Promise.resolve({ observation: { mustNotRun: true }, evidence: [] }),
    );
    const stopped = harness({
      decisions: [toolDecision],
      tool: tool(executeTool),
      leaseCheckpoint: () => Promise.resolve("stop"),
    });

    expect(await stopped.execute()).toEqual({ status: "interrupted", runId: RUN_ID });
    expect(stopped.repository.events).toContain("reserve");
    expect(executeTool).not.toHaveBeenCalled();
    expect(stopped.repository.state.run.status).toBe("running");

    const rejected = harness({
      decisions: [toolDecision],
      tool: tool(executeTool),
      leaseCheckpoint: () => Promise.reject(new Error("database secret")),
    });
    expect(await rejected.execute()).toEqual({
      status: "interrupted",
      runId: RUN_ID,
      errorCode: "agent_persistence_failed",
    });
    expect(JSON.stringify(rejected.repository.state)).not.toContain("database secret");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("supports direct insufficient_context without executing a Tool", async () => {
    const test = harness({ decisions: [insufficientFinal] });
    expect(await test.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(test.repository.events).not.toContain("reserve");
    expect(test.repository.state.run.finalStatus).toBe("insufficient_context");
  });

  it("enforces the snapshotted final-answer character limit including its boundary", async () => {
    const overLimit = harness({
      decisions: [{
        kind: "final_answer",
        result: { status: "insufficient_context", answer: "12345", evidenceIds: [] },
      }],
      run: { finalAnswerMaxCharacters: 4 },
    });
    expect(await overLimit.execute()).toEqual({
      status: "failed",
      runId: RUN_ID,
      errorCode: "agent_invalid_final_answer",
    });
    expect(overLimit.repository.events).not.toContain("complete-run");
    expect(overLimit.repository.state.run.finalAnswer).toBeNull();

    const atLimit = harness({
      decisions: [{
        kind: "final_answer",
        result: { status: "insufficient_context", answer: "1234", evidenceIds: [] },
      }],
      run: { finalAnswerMaxCharacters: 4 },
    });
    expect(await atLimit.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(atLimit.repository.state.run.finalAnswer).toBe("1234");
  });

  it("refuses a mismatched Provider model before Provider or Tool execution", async () => {
    const executeTool = vi.fn(() =>
      Promise.resolve({ observation: { shouldNotRun: true }, evidence: [] }),
    );
    const mismatch = harness({
      decisions: [toolDecision],
      providerModel: "model-B",
      run: { providerModel: "model-A" },
      tool: tool(executeTool),
    });
    expect(await mismatch.execute()).toEqual({
      status: "failed",
      runId: RUN_ID,
      errorCode: "agent_provider_unavailable",
    });
    expect(mismatch.decide).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();

    const recoveryExecute = vi.fn(() =>
      Promise.resolve({ observation: { shouldNotRecover: true }, evidence: [] }),
    );
    const recoveryMismatch = harness({
      decisions: [insufficientFinal],
      providerModel: "model-B",
      run: { providerModel: "model-A" },
      tool: tool(recoveryExecute),
    });
    recoveryMismatch.repository.state.steps.push({
      id: "60000000-0000-4000-8000-000000000099",
      runId: RUN_ID,
      sequence: 1,
      kind: "tool_call",
      status: "running",
      toolName: "search_arxiv",
      safeArgumentsJson: { query: "must not recover with another model" },
      observationJson: null,
      executionCount: 1,
      errorCode: null,
      startedAt: NOW,
      completedAt: null,
      durationMs: null,
    });
    recoveryMismatch.repository.state.run.stepCount = 1;
    recoveryMismatch.repository.state.run.toolCallCount = 1;
    expect(await recoveryMismatch.execute()).toMatchObject({
      status: "failed",
      errorCode: "agent_provider_unavailable",
    });
    expect(recoveryMismatch.decide).not.toHaveBeenCalled();
    expect(recoveryExecute).not.toHaveBeenCalled();

    const interruptedMismatch = harness({
      decisions: [insufficientFinal],
      providerModel: "model-B",
      run: { providerModel: "model-A" },
    });
    const controller = new AbortController();
    controller.abort();
    expect(await interruptedMismatch.execute(controller.signal)).toEqual({
      status: "interrupted",
      runId: RUN_ID,
    });
    expect(interruptedMismatch.repository.state.run.status).toBe("running");
    expect(interruptedMismatch.decide).not.toHaveBeenCalled();

    const match = harness({
      decisions: [insufficientFinal],
      providerModel: "model-A",
      run: { providerModel: "model-A" },
    });
    expect(await match.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(match.decide).toHaveBeenCalledOnce();
  });

  it("uses prepareCall as execution authority and rejects unoffered Tools", async () => {
    const test = harness({ decisions: [toolDecision], run: { maxSteps: 1 } });
    const result = await test.execute();
    expect(test.decide.mock.calls[0]?.[0].offeredActions.map((item) => item.name)).toEqual([
      "submit_final_answer",
    ]);
    expect(result).toEqual({
      status: "failed",
      runId: RUN_ID,
      errorCode: "agent_tool_not_allowed",
    });
    expect(test.repository.events).not.toContain("reserve");
  });

  it("maps Provider failures to allowlisted decision errors without raw persistence", async () => {
    const test = harness({
      decide: () =>
        Promise.reject(new AgentDecisionProviderError("agent_provider_rejected")),
    });
    expect(await test.execute()).toEqual({
      status: "failed",
      runId: RUN_ID,
      errorCode: "agent_provider_rejected",
    });
    expect(JSON.stringify(test.repository.state)).not.toContain("provider body secret");
    expect(test.repository.state.steps).toEqual([
      expect.objectContaining({ kind: "decision_error", errorCode: "agent_provider_rejected" }),
    ]);
  });

  it("persists a recoverable Tool failure, excludes it from context, and continues", async () => {
    let calls = 0;
    const failingTool = tool(() => {
      calls += 1;
      if (calls === 1) throw new AgentToolError("research_upstream_timeout");
      return Promise.resolve({ observation: {}, evidence: [] });
    });
    const test = harness({ decisions: [toolDecision, insufficientFinal], tool: failingTool });
    expect(await test.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(test.repository.state.steps[0]).toMatchObject({
      status: "failed",
      errorCode: "research_upstream_timeout",
    });
    expect(test.decide.mock.calls[1]?.[0].context.completedToolCalls).toEqual([]);
  });

  it("times out a Tool, persists the safe code, and keeps the Run bounded", async () => {
    vi.useFakeTimers();
    const never = tool(() => new Promise(() => undefined));
    const test = harness({ decisions: [toolDecision, insufficientFinal], tool: never });
    const pending = test.execute();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toEqual({ status: "completed", runId: RUN_ID });
    expect(test.repository.events).toContain("fail-step:agent_tool_timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects final Evidence that the live repository cannot validate", async () => {
    const test = harness({ decisions: [groundedFinal] });
    expect(await test.execute()).toEqual({
      status: "failed",
      runId: RUN_ID,
      errorCode: "agent_invalid_final_answer",
    });
    expect(test.repository.events).toContain("complete-run");
    expect(test.repository.events).toContain("fail-run:agent_invalid_final_answer");
  });

  it("honors durable cancellation before Provider, after Provider, and after Tool return", async () => {
    const before = harness({ decisions: [insufficientFinal] });
    before.repository.state.run.cancelRequestedAt = NOW;
    expect(await before.execute()).toEqual({ status: "cancelled", runId: RUN_ID });
    expect(before.decide).not.toHaveBeenCalled();

    const afterProvider = harness({
      decide: () => {
        afterProvider.repository.state.run.cancelRequestedAt = NOW;
        return Promise.resolve(insufficientFinal);
      },
    });
    expect(await afterProvider.execute()).toEqual({ status: "cancelled", runId: RUN_ID });
    expect(afterProvider.repository.events).not.toContain("complete-run");

    const afterTool = harness({
      decisions: [toolDecision],
      tool: tool(() => {
        afterTool.repository.state.run.cancelRequestedAt = NOW;
        return Promise.resolve({ observation: { secret: "discard" }, evidence: [] });
      }),
    });
    expect(await afterTool.execute()).toEqual({ status: "cancelled", runId: RUN_ID });
    expect(afterTool.repository.events).not.toContain("complete-tool");
    expect(JSON.stringify(afterTool.repository.state)).not.toContain("discard");
  });

  it.each([
    {
      name: "deadline",
      arrange: (test: ReturnType<typeof harness>) => {
        test.repository.state.run.deadlineAt = NOW;
      },
      errorCode: "agent_wall_time_exceeded" as const,
    },
    {
      name: "access revocation",
      arrange: (test: ReturnType<typeof harness>) => {
        test.repository.accessRevoked = true;
      },
      errorCode: "agent_space_access_revoked" as const,
    },
  ])("durably terminalizes a Tool completion $name race", async ({ arrange, errorCode }) => {
    const test = harness({ decisions: [toolDecision] });
    test.repository.beforeCompleteTool = () => arrange(test);

    expect(await test.execute()).toEqual({ status: "failed", runId: RUN_ID, errorCode });
    expect(test.repository.state.run).toMatchObject({ status: "failed", errorCode });
    expect(test.repository.state.steps).toEqual([
      expect.objectContaining({ status: "failed", errorCode }),
    ]);
    expect(test.repository.events).toContain(`fail-run:${errorCode}`);
  });

  it("treats caller abort as local interruption, not user cancellation", async () => {
    const controller = new AbortController();
    const test = harness({
      decide: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });
    const pending = test.execute(controller.signal);
    controller.abort("worker shutdown raw reason");
    expect(await pending).toEqual({ status: "interrupted", runId: RUN_ID });
    expect(test.repository.state.run.status).toBe("running");
    expect(JSON.stringify(test.repository.state)).not.toContain("worker shutdown raw reason");
  });

  it("rejects stale generations and final-persistence cancellation races", async () => {
    const stale = harness({ decisions: [insufficientFinal] });
    expect(await stale.execute(undefined, 2)).toEqual({ status: "stale", runId: RUN_ID });

    const race = harness({ decisions: [insufficientFinal] });
    race.repository.beforeCompleteRun = () => {
      race.repository.state.run.cancelRequestedAt = NOW;
    };
    expect(await race.execute()).toEqual({ status: "cancelled", runId: RUN_ID });
    expect(race.repository.state.run.status).toBe("cancelled");
  });

  it("recovers the same incomplete read-only Step and increments executionCount", async () => {
    const test = harness({ decisions: [insufficientFinal] });
    const incomplete: AgentRunStepRecord = {
      id: "60000000-0000-4000-8000-000000000001",
      runId: RUN_ID,
      sequence: 1,
      kind: "tool_call",
      status: "running",
      toolName: "search_arxiv",
      safeArgumentsJson: { query: "recover" },
      observationJson: null,
      executionCount: 1,
      errorCode: null,
      startedAt: NOW,
      completedAt: null,
      durationMs: null,
    };
    test.repository.state.steps.push(incomplete);
    test.repository.state.run.stepCount = 1;
    test.repository.state.run.toolCallCount = 1;

    expect(await test.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(test.repository.events).toContain("resume");
    expect(incomplete.executionCount).toBe(2);
    expect(test.repository.state.steps.filter((step) => step.kind === "tool_call")).toHaveLength(1);
  });

  it("does not publish after a lease-generation change and does not duplicate publication", async () => {
    const test = harness({
      decisions: [toolDecision],
      tool: tool(() => {
        test.repository.state.run.leaseGeneration += 1;
        return Promise.resolve({ observation: { mustNotPersist: true }, evidence: [] });
      }),
    });
    expect(await test.execute()).toEqual({ status: "stale", runId: RUN_ID });
    expect(test.repository.events).not.toContain("complete-tool");
    expect(test.repository.state.steps.filter((step) => step.status === "completed")).toEqual([]);
  });

  it("offers only final submission after Tool budget exhaustion", async () => {
    const test = harness({ decisions: [insufficientFinal], run: { maxToolCalls: 1 } });
    const failed: AgentRunStepRecord = {
      id: "60000000-0000-4000-8000-000000000001",
      runId: RUN_ID,
      sequence: 1,
      kind: "tool_call",
      status: "failed",
      toolName: "search_arxiv",
      safeArgumentsJson: { query: "used" },
      observationJson: null,
      executionCount: 1,
      errorCode: "research_upstream_timeout",
      startedAt: NOW,
      completedAt: NOW,
      durationMs: 1,
    };
    test.repository.state.steps.push(failed);
    test.repository.state.run.stepCount = 1;
    test.repository.state.run.toolCallCount = 1;
    test.repository.state.run.contextBytes = new TextEncoder().encode(
      JSON.stringify({ taskPrompt: task().prompt, completedToolCalls: [] }),
    ).byteLength;

    expect(await test.execute()).toEqual({ status: "completed", runId: RUN_ID });
    expect(test.decide.mock.calls[0]?.[0].offeredActions.map((item) => item.name)).toEqual([
      "submit_final_answer",
    ]);
  });

  it("returns a non-durable safe interruption on repository exceptions", async () => {
    const test = harness({ decisions: [insufficientFinal] });
    test.repository.throwOnRead = true;
    expect(await test.execute()).toEqual({
      status: "interrupted",
      runId: RUN_ID,
      errorCode: "agent_persistence_failed",
    });
    expect(test.repository.state.run.status).toBe("running");
    expect(JSON.stringify(test.repository.state)).not.toContain("database password leaked");
  });

  it("cleans caller listeners and timers after a successful Provider call", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const test = harness({ decisions: [insufficientFinal] });
    expect(await test.execute(controller.signal)).toEqual({ status: "completed", runId: RUN_ID });
    expect(add).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  });
});
