import { describe, expect, it } from "vitest";

import type {
  AgentRunEvidenceRecord,
  AgentRunRecord,
  AgentRunStepRecord,
  AgentTaskRecord,
} from "../../server/db/schema";
import {
  AgentExecutionContextError,
  appendCompletedToolCall,
  buildAgentDecisionContext,
} from "../../server/modules/agents/execution-context";
import type { AgentExecutionState } from "../../server/modules/agents/repository";

const NOW = new Date("2026-09-04T00:00:00.000Z");
const TASK_ID = "40000000-0000-4000-8000-000000000001";
const RUN_ID = "50000000-0000-4000-8000-000000000001";
const SPACE_ID = "20000000-0000-4000-8000-000000000001";

function task(prompt = "研究 Unicode 证据"): AgentTaskRecord {
  return {
    id: TASK_ID,
    spaceId: SPACE_ID,
    agentId: "30000000-0000-4000-8000-000000000001",
    createdByUserId: "10000000-0000-4000-8000-000000000001",
    prompt,
    clientRequestId: "90000000-0000-4000-8000-000000000001",
    requestFingerprint: "a".repeat(64),
    createdAt: NOW,
  };
}

function run(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: RUN_ID,
    taskId: TASK_ID,
    spaceId: SPACE_ID,
    actorUserId: "10000000-0000-4000-8000-000000000001",
    attemptNumber: 1,
    status: "running",
    definitionRevision: 1,
    toolNames: ["search_arxiv"],
    maxSteps: 8,
    maxToolCalls: 6,
    wallTimeSeconds: 180,
    providerDecisionTimeoutSeconds: 30,
    toolTimeoutSeconds: 45,
    providerAttempts: 2,
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
    leaseOwnerId: "90000000-0000-4000-8000-000000000002",
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

function toolStep(
  sequence: number,
  status: AgentRunStepRecord["status"],
  overrides: Partial<AgentRunStepRecord> = {},
): AgentRunStepRecord {
  const terminal = status !== "running";
  return {
    id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    runId: RUN_ID,
    sequence,
    kind: "tool_call",
    status,
    toolName: "search_arxiv",
    safeArgumentsJson: { query: `query-${sequence}`, secret: "safe-value" },
    observationJson: status === "completed" ? { summary: `结果-${sequence}` } : null,
    executionCount: 1,
    errorCode: status === "failed" ? "research_upstream_timeout" : null,
    startedAt: NOW,
    completedAt: terminal ? NOW : null,
    durationMs: terminal ? 10 : null,
    ...overrides,
  };
}

function evidence(
  evidenceKey: string,
  stepId: string,
  overrides: Partial<AgentRunEvidenceRecord> = {},
): AgentRunEvidenceRecord {
  return {
    id: `70000000-0000-4000-8000-${evidenceKey.slice(1).padStart(12, "0")}`,
    runId: RUN_ID,
    stepId,
    evidenceKey,
    kind: "arxiv_abstract",
    paperId: null,
    documentId: null,
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v1",
    sourceVersion: 1,
    sourceTitle: "Agent systems",
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
    ...overrides,
  };
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function state(input: {
  prompt?: string;
  steps?: AgentRunStepRecord[];
  evidence?: AgentRunEvidenceRecord[];
  run?: Partial<AgentRunRecord>;
} = {}): AgentExecutionState {
  const steps = input.steps ?? [];
  const persistedEvidence = input.evidence ?? [];
  const expectedContext = {
    taskPrompt: input.prompt ?? "研究 Unicode 证据",
    completedToolCalls: steps
      .filter((step) => step.kind === "tool_call" && step.status === "completed")
      .map((step) => ({
        sequence: step.sequence,
        toolName: step.toolName,
        safeArguments: step.safeArgumentsJson,
        observation: step.observationJson,
        evidenceIds: persistedEvidence
          .filter((item) => item.stepId === step.id)
          .map((item) => item.evidenceKey),
      })),
  };
  const hasTerminalToolStep = steps.some(
    (step) => step.kind === "tool_call" && step.status !== "running",
  );
  return {
    task: task(input.prompt),
    run: run({
      stepCount: steps.length,
      toolCallCount: steps.filter((step) => step.kind === "tool_call").length,
      contextBytes: hasTerminalToolStep ? bytes(expectedContext) : 0,
      ...input.run,
    }),
    steps,
    evidence: persistedEvidence,
  };
}

function expectContextError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected context projection to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentExecutionContextError);
    expect(error).toMatchObject({ code });
    expect((error as AgentExecutionContextError).stack).toBeUndefined();
  }
}

describe("Agent execution context projection", () => {
  it("projects ordered completed Tool Steps and excludes failed/running data", () => {
    const completed = toolStep(1, "completed", {
      safeArgumentsJson: { query: "public query" },
      observationJson: { summary: "公开结果" },
    });
    const failed = toolStep(2, "failed", {
      safeArgumentsJson: { query: "failed" },
      errorCode: "research_upstream_failure",
    });
    const running = toolStep(3, "running", {
      safeArgumentsJson: { query: "not-yet-published", unsafeProviderBody: "never expose" },
    });
    const executionState = state({
      steps: [completed, failed, running],
      evidence: [evidence("E1", completed.id)],
    });

    const projection = buildAgentDecisionContext(executionState);

    expect(projection.context).toEqual({
      taskPrompt: "研究 Unicode 证据",
      completedToolCalls: [
        {
          sequence: 1,
          toolName: "search_arxiv",
          safeArguments: { query: "public query" },
          observation: { summary: "公开结果" },
          evidenceIds: ["E1"],
        },
      ],
    });
    expect(JSON.stringify(projection.context)).not.toContain("never expose");
    expect(JSON.stringify(projection.context)).not.toContain("research_upstream_failure");
    expect(projection.contextBytes).toBe(bytes(projection.context));
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.context.completedToolCalls[0]?.observation)).toBe(true);
  });

  it("uses exact UTF-8 JSON bytes rather than JavaScript character count", () => {
    const projection = buildAgentDecisionContext(state({ prompt: "证据🧵" }));
    const serialized = JSON.stringify(projection.context);
    expect(projection.contextBytes).toBe(Buffer.byteLength(serialized, "utf8"));
    expect(projection.contextBytes).toBeGreaterThan(serialized.length);
  });

  it("rejects malformed ordering, counters, ownership, and non-contiguous Evidence", () => {
    const first = toolStep(1, "completed");
    const second = toolStep(2, "completed");
    const validEvidence = evidence("E1", first.id);

    expectContextError(
      () => buildAgentDecisionContext(state({ steps: [second, first] })),
      "agent_persistence_failed",
    );
    expectContextError(
      () => buildAgentDecisionContext(state({ steps: [first], run: { stepCount: 2 } })),
      "agent_persistence_failed",
    );
    expectContextError(
      () =>
        buildAgentDecisionContext(
          state({ evidence: [validEvidence], steps: [toolStep(1, "failed")] }),
        ),
      "agent_persistence_failed",
    );
    expectContextError(
      () =>
        buildAgentDecisionContext(
          state({ steps: [first, second], evidence: [evidence("E2", second.id)] }),
        ),
      "agent_persistence_failed",
    );
    expectContextError(
      () =>
        buildAgentDecisionContext(
          state({
            steps: [first],
            evidence: [validEvidence],
            run: { id: "50000000-0000-4000-8000-000000000099" },
          }),
        ),
      "agent_persistence_failed",
    );
  });

  it("enforces the snapshotted context bound and persisted byte counter", () => {
    const completed = toolStep(1, "completed");
    const valid = state({ steps: [completed] });
    expectContextError(
      () =>
        buildAgentDecisionContext({
          ...valid,
          run: { ...valid.run, contextBytes: valid.run.contextBytes + 1 },
        }),
      "agent_persistence_failed",
    );
    expectContextError(
      () => buildAgentDecisionContext(state({ run: { contextMaxBytes: 1 } })),
      "agent_context_limit_exceeded",
    );
  });

  it("requires zero persisted context bytes before the first terminal Tool Step", () => {
    expectContextError(
      () => buildAgentDecisionContext(state({ run: { contextBytes: 1 } })),
      "agent_persistence_failed",
    );

    const running = toolStep(1, "running");
    expectContextError(
      () =>
        buildAgentDecisionContext(
          state({ steps: [running], run: { contextBytes: 1 } }),
        ),
      "agent_persistence_failed",
    );

    expect(buildAgentDecisionContext(state()).context.completedToolCalls).toEqual([]);
    expect(
      buildAgentDecisionContext(state({ steps: [running] })).context.completedToolCalls,
    ).toEqual([]);
  });

  it("predicts the next contiguous Evidence IDs only for context sizing", () => {
    const completed = toolStep(1, "completed");
    const running = toolStep(2, "running", {
      toolName: "search_knowledge_base",
      safeArgumentsJson: { query: "next" },
    });
    const projection = buildAgentDecisionContext(
      state({ steps: [completed, running], evidence: [evidence("E1", completed.id)] }),
    );
    const appended = appendCompletedToolCall(projection, running, {
      observation: { matches: ["二", "三"] },
      evidence: [
        {
          kind: "arxiv_abstract",
          paperId: null,
          canonicalArxivId: "2609.00002",
          versionedArxivId: "2609.00002v1",
          sourceVersion: 1,
          title: "Second",
          url: "https://arxiv.org/abs/2609.00002",
          excerpt: "Second excerpt",
        },
        {
          kind: "arxiv_abstract",
          paperId: null,
          canonicalArxivId: "2609.00003",
          versionedArxivId: "2609.00003v1",
          sourceVersion: 1,
          title: "Third",
          url: "https://arxiv.org/abs/2609.00003",
          excerpt: "Third excerpt",
        },
      ],
    });

    expect(appended.context.completedToolCalls.at(-1)?.evidenceIds).toEqual(["E2", "E3"]);
    expect(appended.evidenceCount).toBe(3);
    expect(appended.contextBytes).toBe(bytes(appended.context));
    expect(projection.evidenceCount).toBe(1);
  });

  it("rejects malformed appended results, cross-Run Steps, and Evidence overflow", () => {
    const running = toolStep(1, "running");
    const projection = buildAgentDecisionContext(state({ steps: [running] }));
    expectContextError(
      () =>
        appendCompletedToolCall(projection, { ...running, runId: "wrong-run" }, {
          observation: {},
          evidence: [],
        }),
      "agent_persistence_failed",
    );
    expectContextError(
      () =>
        appendCompletedToolCall(
          { ...projection, maxEvidence: 1, evidenceCount: 1 },
          running,
          {
            observation: {},
            evidence: [
              {
                kind: "arxiv_abstract",
                paperId: null,
                canonicalArxivId: "2609.00004",
                versionedArxivId: "2609.00004v1",
                sourceVersion: 1,
                title: "Overflow",
                url: "https://arxiv.org/abs/2609.00004",
                excerpt: "Overflow excerpt",
              },
            ],
          },
        ),
      "agent_evidence_limit_exceeded",
    );
  });
});
