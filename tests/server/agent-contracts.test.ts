import { describe, expect, it } from "vitest";

import {
  AGENT_OBSERVATION_MAX_BYTES,
  agentDefinitionSchema,
  agentErrorCodeSchema,
  agentEvidenceSchema,
  agentFinalResultSchema,
  agentObservationSchema,
  agentRunSchema,
  agentRunTraceResponseSchema,
  agentStepSchema,
  agentTaskCursorPayloadSchema,
  agentTaskListQuerySchema,
  createAgentTaskInputSchema,
  retryAgentTaskInputSchema,
} from "../../shared/contracts/agents";
import { AGENT_EXECUTION_LIMITS } from "../../server/modules/agents/state";

const ids = {
  agent: "10000000-0000-4000-8000-000000000001",
  task: "10000000-0000-4000-8000-000000000002",
  run: "10000000-0000-4000-8000-000000000003",
  step: "10000000-0000-4000-8000-000000000004",
  evidence: "10000000-0000-4000-8000-000000000005",
  space: "10000000-0000-4000-8000-000000000006",
  user: "10000000-0000-4000-8000-000000000007",
  request: "10000000-0000-4000-8000-000000000008",
};
const now = "2026-09-03T00:00:00.000Z";

const configuration = {
  agentRevision: 1,
  tools: ["search_arxiv", "search_knowledge_base", "ask_knowledge"],
  limits: AGENT_EXECUTION_LIMITS,
  promptVersion: "research-agent-v1",
  providerModel: "configured-model",
} as const;

const runningRun = {
  id: ids.run,
  taskId: ids.task,
  spaceId: ids.space,
  attemptNumber: 1,
  status: "running",
  configuration,
  stepCount: 0,
  toolCallCount: 0,
  contextBytes: 0,
  cancelRequestedAt: null,
  cancelRequestedByUserId: null,
  startedAt: now,
  deadlineAt: "2026-09-03T00:03:00.000Z",
  finishedAt: null,
  errorCode: null,
  finalResult: null,
  createdAt: now,
  updatedAt: now,
} as const;

describe("Agent request contracts", () => {
  it("normalizes bounded task prompts and validates UUID idempotency keys", () => {
    expect(
      createAgentTaskInputSchema.parse({
        agentId: ids.agent,
        prompt: "  Find grounded evidence.  ",
        clientRequestId: ids.request,
      }),
    ).toEqual({ agentId: ids.agent, prompt: "Find grounded evidence.", clientRequestId: ids.request });
    expect(createAgentTaskInputSchema.safeParse({ agentId: ids.agent, prompt: "x", clientRequestId: "request" }).success).toBe(false);
    expect(createAgentTaskInputSchema.safeParse({ agentId: ids.agent, prompt: "x".repeat(4_001), clientRequestId: ids.request }).success).toBe(false);
    expect(retryAgentTaskInputSchema.safeParse({ clientRequestId: ids.request, prompt: "changed" }).success).toBe(false);
  });

  it("strictly bounds list filters and cursors", () => {
    expect(agentTaskListQuerySchema.parse({ limit: "10", status: "running", agentId: ids.agent })).toEqual({ limit: 10, status: "running", agentId: ids.agent });
    expect(agentTaskListQuerySchema.safeParse({ status: "processing" }).success).toBe(false);
    expect(agentTaskListQuerySchema.safeParse({ cursor: "x".repeat(257) }).success).toBe(false);
    expect(agentTaskListQuerySchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(agentTaskCursorPayloadSchema.safeParse({ createdAt: now, id: ids.task }).success).toBe(true);
    expect(agentTaskCursorPayloadSchema.safeParse({ createdAt: "not-a-date", id: ids.task }).success).toBe(false);
  });
});

describe("Agent response contracts", () => {
  it("distinguishes runtime readiness reasons without weakening definition invariants", () => {
    const definition = {
      id: ids.agent,
      stableKey: "research-agent",
      name: "Research Agent",
      purpose: "Research with grounded evidence.",
      enabled: true,
      systemManaged: true,
      revision: 1,
      tools: configuration.tools,
      limits: configuration.limits,
      promptVersion: configuration.promptVersion,
      availability: { available: false, reason: "runtime_unavailable" },
      createdAt: now,
      updatedAt: now,
    } as const;

    expect(agentDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(
      agentDefinitionSchema.safeParse({
        ...definition,
        availability: { available: true, reason: null },
      }).success,
    ).toBe(true);
    expect(
      agentDefinitionSchema.safeParse({
        ...definition,
        availability: { available: true, reason: "runtime_unavailable" },
      }).success,
    ).toBe(false);
    expect(
      agentDefinitionSchema.safeParse({
        ...definition,
        enabled: false,
        availability: { available: false, reason: "agent_disabled" },
      }).success,
    ).toBe(true);
    expect(
      agentDefinitionSchema.safeParse({
        ...definition,
        enabled: false,
        availability: { available: false, reason: "runtime_unavailable" },
      }).success,
    ).toBe(false);
    expect(
      agentDefinitionSchema.safeParse({
        ...definition,
        availability: { available: false, reason: "unknown_runtime_state" },
      }).success,
    ).toBe(false);
  });

  it("accepts only the allowlisted Retrieval errors in failed Runs and Steps", () => {
    const retrievalErrors = [
      "retrieval_embedding_unconfigured",
      "retrieval_embedding_unavailable",
      "retrieval_embedding_rejected",
      "retrieval_embedding_invalid_response",
    ] as const;

    for (const errorCode of retrievalErrors) {
      expect(agentErrorCodeSchema.parse(errorCode)).toBe(errorCode);
      expect(
        agentRunSchema.safeParse({
          ...runningRun,
          status: "failed",
          finishedAt: now,
          errorCode,
        }).success,
      ).toBe(true);
      expect(
        agentStepSchema.safeParse({
          id: ids.step,
          runId: ids.run,
          sequence: 1,
          kind: "tool_call",
          status: "failed",
          toolName: "search_knowledge_base",
          safeArguments: { query: "bounded query" },
          observation: null,
          executionCount: 1,
          errorCode,
          startedAt: now,
          completedAt: now,
          durationMs: 0,
        }).success,
      ).toBe(true);
    }
    expect(agentErrorCodeSchema.safeParse("retrieval_private_provider_body").success).toBe(false);
  });

  it("uses status-discriminated run invariants", () => {
    expect(agentRunSchema.parse(runningRun).status).toBe("running");
    expect(
      agentRunSchema.parse({
        ...runningRun,
        cancelRequestedAt: now,
        cancelRequestedByUserId: null,
      }).cancelRequestedAt,
    ).toBe(now);
    expect(
      agentRunSchema.safeParse({
        ...runningRun,
        cancelRequestedAt: null,
        cancelRequestedByUserId: ids.user,
      }).success,
    ).toBe(false);
    expect(agentRunSchema.safeParse({ ...runningRun, status: "completed" }).success).toBe(false);
    expect(
      agentRunSchema.safeParse({
        ...runningRun,
        status: "failed",
        finishedAt: now,
        errorCode: "private_provider_body",
      }).success,
    ).toBe(false);
  });

  it("enforces final evidence semantics", () => {
    expect(
      agentFinalResultSchema.parse({ status: "answered", answer: "Supported [E1].", evidenceIds: ["E1"] }),
    ).toEqual({ status: "answered", answer: "Supported [E1].", evidenceIds: ["E1"] });
    expect(agentFinalResultSchema.safeParse({ status: "answered", answer: "Duplicate", evidenceIds: ["E1", "E1"] }).success).toBe(false);
    expect(agentFinalResultSchema.safeParse({ status: "answered", answer: "Cites [E2] first, then [E1].", evidenceIds: ["E1", "E2"] }).success).toBe(false);
    expect(agentFinalResultSchema.safeParse({ status: "insufficient_context", answer: "Not enough evidence.", evidenceIds: ["E1"] }).success).toBe(false);
    expect(agentFinalResultSchema.safeParse({ status: "insufficient_context", answer: "Not enough [E1].", evidenceIds: [] }).success).toBe(false);
    expect(agentFinalResultSchema.safeParse({ status: "answered", answer: "Bad", evidenceIds: ["E33"] }).success).toBe(false);
  });

  it("enforces tool-step field consistency", () => {
    const step = {
      id: ids.step,
      runId: ids.run,
      sequence: 1,
      kind: "tool_call",
      status: "completed",
      toolName: "search_knowledge_base",
      safeArguments: { query: "grounded evidence", limit: 3 },
      observation: { resultCount: 1 },
      executionCount: 1,
      errorCode: null,
      startedAt: now,
      completedAt: now,
      durationMs: 42,
    } as const;
    expect(agentStepSchema.parse(step)).toEqual(step);
    expect(agentStepSchema.safeParse({ ...step, observation: null }).success).toBe(false);
    expect(agentStepSchema.safeParse({ ...step, status: "running", completedAt: now }).success).toBe(false);
  });

  it("measures observation bounds as serialized UTF-8 bytes", () => {
    const prefixBytes = new TextEncoder().encode(JSON.stringify({ value: "" })).byteLength;
    expect(agentObservationSchema.safeParse({ value: "a".repeat(AGENT_OBSERVATION_MAX_BYTES - prefixBytes) }).success).toBe(true);
    expect(agentObservationSchema.safeParse({ value: "é".repeat(AGENT_OBSERVATION_MAX_BYTES) }).success).toBe(false);
  });

  it("keeps evidence bounded and source-specific", () => {
    const evidence = {
      id: ids.evidence,
      runId: ids.run,
      stepId: ids.step,
      evidenceId: "E1",
      kind: "knowledge_chunk",
      documentId: null,
      originalFilename: "deleted-source.md",
      contentHash: "a".repeat(64),
      ordinal: 0,
      pageNumber: null,
      startOffset: 0,
      endOffset: 20,
      excerpt: "A bounded snapshot.",
      available: false,
      finalOrdinal: 1,
      createdAt: now,
    } as const;
    expect(agentEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(agentEvidenceSchema.safeParse({ ...evidence, excerpt: "x".repeat(1_001) }).success).toBe(false);
    expect(agentEvidenceSchema.safeParse({ ...evidence, endOffset: 0 }).success).toBe(false);
  });

  it("rejects cross-run trace records, invalid evidence origins, and unordered steps", () => {
    const step = {
      id: ids.step,
      runId: ids.run,
      sequence: 1,
      kind: "tool_call",
      status: "completed",
      toolName: "search_arxiv",
      safeArguments: { query: "agent systems" },
      observation: { resultCount: 1 },
      executionCount: 1,
      errorCode: null,
      startedAt: now,
      completedAt: now,
      durationMs: 10,
    } as const;
    const evidence = {
      id: ids.evidence,
      runId: ids.run,
      stepId: ids.step,
      evidenceId: "E1",
      kind: "arxiv_abstract",
      paperId: null,
      canonicalArxivId: "2609.00001",
      versionedArxivId: "2609.00001v1",
      sourceVersion: 1,
      title: "Agent systems",
      url: "https://arxiv.org/abs/2609.00001v1",
      excerpt: "Bounded evidence.",
      available: true,
      finalOrdinal: 1,
      createdAt: now,
    } as const;
    const trace = {
      runId: ids.run,
      steps: [step],
      evidence: [evidence],
    };
    expect(agentRunTraceResponseSchema.parse(trace)).toEqual(trace);
    expect(agentRunTraceResponseSchema.safeParse({ ...trace, evidence: [{ ...evidence, runId: ids.task }] }).success).toBe(false);
    expect(agentRunTraceResponseSchema.safeParse({ ...trace, evidence: [{ ...evidence, stepId: ids.task }] }).success).toBe(false);
    expect(agentRunTraceResponseSchema.safeParse({ ...trace, steps: [{ ...step, sequence: 2 }, step] }).success).toBe(false);
  });
});
