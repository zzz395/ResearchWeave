import { describe, expect, it } from "vitest";

import { createAgentService } from "../../server/modules/agents/service";
import type { ResearchSpaceRecord } from "../../server/db/schema";
import {
  InMemoryAgentRepository,
  TEST_AGENT_ID,
} from "../helpers/in-memory-agent-repository";
import { InMemorySpaceRepository } from "../helpers/in-memory-repositories";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000002";
const SPACE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

function harness(
  runtime: { ready: false } | { ready: true; providerModel: string } = {
    ready: true,
    providerModel: "test-model",
  },
) {
  const spaces = new InMemorySpaceRepository();
  const now = new Date("2026-09-03T01:00:00.000Z");
  const space: ResearchSpaceRecord = {
    id: SPACE_ID,
    name: "Agent Lab",
    description: null,
    ownerId: ACTOR_ID,
    createdAt: now,
    updatedAt: now,
  };
  spaces.spaces.set(space.id, space);
  spaces.addMember(space.id, ACTOR_ID, "owner");
  const repository = new InMemoryAgentRepository(spaces);
  return { spaces, repository, service: createAgentService(repository, runtime) };
}

describe("Agent service", () => {
  it("derives actor persistence fields on the server and creates a stable idempotent replay", async () => {
    const { repository, service } = harness();
    const input = {
      agentId: TEST_AGENT_ID,
      prompt: "  Find grounded evidence.  ",
      clientRequestId: REQUEST_ID,
    };

    const created = await service.createTask(SPACE_ID, ACTOR_ID, input);
    const replayed = await service.createTask(SPACE_ID, ACTOR_ID, input);

    expect(created.created).toBe(true);
    expect(replayed).toMatchObject({ created: false, task: { id: created.task.id } });
    const persistedTask = repository.tasks.get(created.task.id);
    const persistedRun = repository.runs.get(created.run.id);
    expect(persistedTask).toMatchObject({ createdByUserId: ACTOR_ID, prompt: "Find grounded evidence." });
    expect(persistedTask?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(persistedRun).toMatchObject({ actorUserId: ACTOR_ID, providerModel: "test-model" });
  });

  it("replays an existing task before applying current runtime or definition availability", async () => {
    const { repository, service } = harness();
    const input = {
      agentId: TEST_AGENT_ID,
      prompt: "Replay after configuration change",
      clientRequestId: REQUEST_ID,
    };
    const created = await service.createTask(SPACE_ID, ACTOR_ID, input);

    const unavailableReplay = await createAgentService(repository, { ready: false }).createTask(
      SPACE_ID,
      ACTOR_ID,
      input,
    );
    expect(unavailableReplay).toMatchObject({
      created: false,
      task: { id: created.task.id },
      run: { id: created.run.id },
    });

    const bundle = repository.definitions.get(TEST_AGENT_ID);
    if (!bundle) throw new Error("Expected the test Agent definition.");
    repository.definitions.set(TEST_AGENT_ID, {
      ...bundle,
      definition: { ...bundle.definition, enabled: false },
    });
    const disabledReplay = await service.createTask(SPACE_ID, ACTOR_ID, input);
    expect(disabledReplay).toMatchObject({ created: false, task: { id: created.task.id } });
  });

  it("keeps Space authorization safe and maps idempotency conflicts", async () => {
    const { service } = harness();
    const input = { agentId: TEST_AGENT_ID, prompt: "First", clientRequestId: REQUEST_ID };
    await expect(service.createTask(SPACE_ID, OUTSIDER_ID, input)).rejects.toMatchObject({
      statusCode: 404,
      code: "space_not_found",
    });
    await service.createTask(SPACE_ID, ACTOR_ID, input);
    await expect(
      service.createTask(SPACE_ID, ACTOR_ID, { ...input, prompt: "Changed" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "agent_idempotency_conflict" });
  });

  it("reports definition availability and blocks unavailable or disabled submissions", async () => {
    const unavailable = harness({ ready: false });
    expect((await unavailable.service.listDefinitions())[0]?.availability).toEqual({
      available: false,
      reason: "provider_unconfigured",
    });
    await expect(
      unavailable.service.createTask(SPACE_ID, ACTOR_ID, {
        agentId: TEST_AGENT_ID,
        prompt: "Research this",
        clientRequestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 503, code: "agent_runtime_unavailable" });
    expect(unavailable.repository.tasks.size).toBe(0);

    const disabled = harness();
    const bundle = disabled.repository.definitions.get(TEST_AGENT_ID);
    if (!bundle) throw new Error("Expected the test Agent definition.");
    disabled.repository.definitions.set(TEST_AGENT_ID, {
      ...bundle,
      definition: { ...bundle.definition, enabled: false },
    });
    expect((await disabled.service.getDefinition(TEST_AGENT_ID)).availability.reason).toBe(
      "agent_disabled",
    );
    await expect(
      disabled.service.createTask(SPACE_ID, ACTOR_ID, {
        agentId: TEST_AGENT_ID,
        prompt: "Research this",
        clientRequestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "agent_disabled" });
  });

  it("uses canonical cursor pagination and rejects malformed encodings", async () => {
    const { service } = harness();
    for (let index = 1; index <= 3; index += 1) {
      await service.createTask(SPACE_ID, ACTOR_ID, {
        agentId: TEST_AGENT_ID,
        prompt: `Task ${index}`,
        clientRequestId: `30000000-0000-4000-8000-00000000000${index}`,
      });
    }
    const first = await service.listTasks(SPACE_ID, ACTOR_ID, { limit: 2 });
    expect(first.tasks).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.listTasks(SPACE_ID, ACTOR_ID, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.tasks).toHaveLength(1);
    expect(new Set([...first.tasks, ...second.tasks].map((task) => task.id)).size).toBe(3);

    await expect(
      service.listTasks(SPACE_ID, ACTOR_ID, { limit: 20, cursor: "not+a+cursor" }),
    ).rejects.toEqual(
      expect.objectContaining({ statusCode: 400, code: "invalid_agent_task_cursor" }),
    );
  });

  it("maps completed runs from ordered final Evidence references without persistence leakage", async () => {
    const { repository, service } = harness();
    const created = await service.createTask(SPACE_ID, ACTOR_ID, {
      agentId: TEST_AGENT_ID,
      prompt: "Complete me",
      clientRequestId: REQUEST_ID,
    });
    const record = repository.runs.get(created.run.id);
    if (!record) throw new Error("Expected an Agent run.");
    const startedAt = new Date("2026-09-03T01:00:00.000Z");
    repository.runs.set(record.id, {
      ...record,
      status: "completed",
      stepCount: 1,
      startedAt,
      deadlineAt: new Date("2026-09-03T01:03:00.000Z"),
      finishedAt: new Date("2026-09-03T01:01:00.000Z"),
      finalStatus: "answered",
      finalAnswer: "Second [E2], then first [E1].",
    });
    repository.finalEvidenceIds.set(record.id, ["E2", "E1"]);

    const response = await service.getRun(record.id, ACTOR_ID);
    expect(response.run.finalResult).toEqual({
      status: "answered",
      answer: "Second [E2], then first [E1].",
      evidenceIds: ["E2", "E1"],
    });
    const serialized = JSON.stringify(response);
    for (const privateField of [
      "actorUserId",
      "leaseOwnerId",
      "leaseExpiresAt",
      "leaseGeneration",
      "requestFingerprint",
      "retryRequestFingerprint",
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it("maps ordered trace records to bounded public step and Evidence fields", async () => {
    const { repository, service } = harness();
    const created = await service.createTask(SPACE_ID, ACTOR_ID, {
      agentId: TEST_AGENT_ID,
      prompt: "Trace me",
      clientRequestId: REQUEST_ID,
    });
    const stepId = "60000000-0000-4000-8000-000000000001";
    const evidenceId = "70000000-0000-4000-8000-000000000001";
    const now = new Date("2026-09-03T01:00:00.000Z");
    repository.steps.set(created.run.id, [
      {
        id: stepId,
        runId: created.run.id,
        sequence: 1,
        kind: "tool_call",
        status: "completed",
        toolName: "search_arxiv",
        safeArgumentsJson: { query: "agent systems" },
        observationJson: { resultCount: 1 },
        executionCount: 1,
        errorCode: null,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
      },
    ]);
    repository.evidence.set(created.run.id, [
      {
        id: evidenceId,
        runId: created.run.id,
        stepId,
        evidenceKey: "E1",
        kind: "arxiv_abstract",
        paperId: null,
        documentId: null,
        canonicalArxivId: "2609.00001",
        versionedArxivId: "2609.00001v1",
        sourceVersion: 1,
        sourceTitle: "Agent systems",
        sourceUrl: "https://arxiv.org/abs/2609.00001v1",
        originalFilename: null,
        contentHash: null,
        chunkOrdinal: null,
        pageNumber: null,
        startOffset: null,
        endOffset: null,
        excerpt: "Bounded evidence.",
        finalOrdinal: null,
        createdAt: now,
      },
    ]);

    const trace = await service.getRunTrace(created.run.id, ACTOR_ID);
    expect(trace.steps[0]).toMatchObject({
      safeArguments: { query: "agent systems" },
      observation: { resultCount: 1 },
    });
    expect(trace.evidence[0]).toMatchObject({
      evidenceId: "E1",
      title: "Agent systems",
      available: false,
    });
    expect(JSON.stringify(trace)).not.toContain("safeArgumentsJson");
    expect(JSON.stringify(trace)).not.toContain("sourceTitle");
  });

  it("maps retry and terminal cancellation repository outcomes to stable AppErrors", async () => {
    const { service } = harness();
    const created = await service.createTask(SPACE_ID, ACTOR_ID, {
      agentId: TEST_AGENT_ID,
      prompt: "Retry me",
      clientRequestId: REQUEST_ID,
    });
    await expect(
      service.retryTask(created.task.id, ACTOR_ID, {
        clientRequestId: "30000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "agent_retry_not_allowed" });

    const cancelled = await service.cancelRun(created.run.id, ACTOR_ID);
    expect(cancelled.run.status).toBe("cancelled");
    await expect(service.cancelRun(created.run.id, ACTOR_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "agent_run_terminal",
      details: { run: { status: "cancelled" } },
    });
  });

  it("replays an existing retry before applying current runtime or definition availability", async () => {
    const { repository, service } = harness();
    const created = await service.createTask(SPACE_ID, ACTOR_ID, {
      agentId: TEST_AGENT_ID,
      prompt: "Retry replay",
      clientRequestId: REQUEST_ID,
    });
    await service.cancelRun(created.run.id, ACTOR_ID);
    const retryInput = { clientRequestId: "30000000-0000-4000-8000-000000000003" };
    const retry = await service.retryTask(created.task.id, ACTOR_ID, retryInput);

    const bundle = repository.definitions.get(TEST_AGENT_ID);
    if (!bundle) throw new Error("Expected the test Agent definition.");
    repository.definitions.set(TEST_AGENT_ID, {
      ...bundle,
      definition: { ...bundle.definition, enabled: false },
    });
    const replay = await createAgentService(repository, { ready: false }).retryTask(
      created.task.id,
      ACTOR_ID,
      retryInput,
    );
    expect(replay).toMatchObject({ created: false, run: { id: retry.run.id } });
  });
});
