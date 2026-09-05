/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelAgentRun,
  createAgentTask,
  getAgentRun,
  getAgentRunTrace,
  getAgentTask,
  listAgentDefinitions,
  listAgentTasks,
  retryAgentTask,
} from "../../src/features/agents/api/agents";
import { agentQueryKeys } from "../../src/features/agents/api/query-keys";

const agentId = "10000000-0000-4000-8000-000000000001";
const spaceId = "20000000-0000-4000-8000-000000000002";
const taskId = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const clientRequestId = "50000000-0000-4000-8000-000000000005";
const now = "2026-09-05T00:00:00.000Z";
const limits = {
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
};
const definition = {
  id: agentId,
  stableKey: "research-agent",
  name: "Research Agent",
  purpose: "Research across approved sources.",
  enabled: true,
  systemManaged: true,
  revision: 1,
  tools: ["search_arxiv", "search_knowledge_base", "ask_knowledge"],
  limits,
  promptVersion: "research-agent-v1",
  availability: { available: true, reason: null },
  createdAt: now,
  updatedAt: now,
};
const run = {
  id: runId,
  taskId,
  spaceId,
  attemptNumber: 1,
  status: "queued",
  configuration: {
    agentRevision: 1,
    tools: definition.tools,
    limits,
    promptVersion: definition.promptVersion,
    providerModel: "test-model",
  },
  stepCount: 0,
  toolCallCount: 0,
  contextBytes: 0,
  cancelRequestedAt: null,
  cancelRequestedByUserId: null,
  startedAt: null,
  deadlineAt: null,
  finishedAt: null,
  errorCode: null,
  finalResult: null,
  createdAt: now,
  updatedAt: now,
};
const task = {
  id: taskId,
  spaceId,
  agentId,
  createdByUserId: "60000000-0000-4000-8000-000000000006",
  prompt: "Compare durable orchestration approaches.",
  createdAt: now,
  latestRun: run,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Agent client API", () => {
  it("loads validated system definitions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ agents: [definition] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAgentDefinitions()).resolves.toEqual([definition]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/agents");
  });

  it.each([200, 202])("creates a task with an idempotency identity from a %i response", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ task, run, created: status === 202 }, status),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAgentTask(spaceId, {
      agentId,
      prompt: task.prompt,
      clientRequestId,
    })).resolves.toMatchObject({ task, run });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/spaces/" + spaceId + "/agent-tasks",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ agentId, prompt: task.prompt, clientRequestId }),
    });
  });

  it("serializes Space-scoped task filters and cursor pagination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ tasks: [task], nextCursor: "next-page" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAgentTasks(spaceId, {
      cursor: "cursor-value",
      limit: 20,
      status: "queued",
      agentId,
    })).resolves.toEqual({ tasks: [task], nextCursor: "next-page" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/spaces/" + spaceId
      + "/agent-tasks?cursor=cursor-value&limit=20&status=queued&agentId=" + agentId,
    );
  });

  it("uses the existing task, run, trace, retry and cancel contracts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ task, runs: [run] }))
      .mockResolvedValueOnce(jsonResponse({ run }))
      .mockResolvedValueOnce(jsonResponse({ runId, steps: [], evidence: [] }))
      .mockResolvedValueOnce(jsonResponse({ run, created: true }, 202))
      .mockResolvedValueOnce(jsonResponse({ run }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAgentTask(taskId)).resolves.toEqual({ task, runs: [run] });
    await expect(getAgentRun(runId)).resolves.toEqual({ run });
    await expect(getAgentRunTrace(runId)).resolves.toEqual({ runId, steps: [], evidence: [] });
    await expect(retryAgentTask(taskId, { clientRequestId })).resolves.toEqual({
      run,
      created: true,
    });
    await expect(cancelAgentRun(runId)).resolves.toEqual({ run });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/agent-tasks/" + taskId,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/agent-runs/" + runId,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/agent-runs/" + runId + "/steps",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/agent-tasks/" + taskId + "/runs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/agent-runs/" + runId + "/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves safe API error details for unavailable runtime races", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: "agent_runtime_unavailable",
        message: "The Agent runtime is unavailable.",
        requestId: "request-1",
      },
    }, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAgentTask(spaceId, {
      agentId,
      prompt: task.prompt,
      clientRequestId,
    })).rejects.toEqual(expect.objectContaining({
      code: "agent_runtime_unavailable",
      requestId: "request-1",
      status: 503,
    }));
  });

  it("keeps query keys separated by durable resource and list scope", () => {
    expect(agentQueryKeys.taskList({ spaceId, status: "running", agentId })).toEqual([
      "agents", "tasks", "list", spaceId, "running", agentId,
    ]);
    expect(agentQueryKeys.task(taskId)).toEqual(["agents", "tasks", "detail", taskId]);
    expect(agentQueryKeys.run(runId)).toEqual(["agents", "runs", "detail", runId]);
    expect(agentQueryKeys.trace(runId)).toEqual(["agents", "runs", "trace", runId]);
  });
});
