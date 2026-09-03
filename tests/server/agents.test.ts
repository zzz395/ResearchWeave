import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import {
  agentDefinitionListResponseSchema,
  agentDefinitionResponseSchema,
  agentRunCreateResponseSchema,
  agentRunResponseSchema,
  agentRunTraceResponseSchema,
  agentTaskCreateResponseSchema,
  agentTaskListResponseSchema,
  agentTaskResponseSchema,
} from "../../shared/contracts/agents";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import { TEST_AGENT_ID } from "../helpers/in-memory-agent-repository";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;

async function register(agent: ReturnType<typeof request.agent>, email: string) {
  return authResponseSchema.parse(
    (
      await agent
        .post("/api/v1/auth/register")
        .set("Origin", origin)
        .send({ displayName: "Agent User", email, password: "secure-password" })
        .expect(201)
    ).body,
  ).user;
}

async function createSpace(agent: ReturnType<typeof request.agent>) {
  return researchSpaceResponseSchema.parse(
    (
      await agent
        .post("/api/v1/spaces")
        .set("Origin", origin)
        .send({ name: "Agent API Space" })
        .expect(201)
    ).body,
  ).space;
}

function taskInput(index: number) {
  return {
    agentId: TEST_AGENT_ID,
    prompt: `Research request ${index}`,
    clientRequestId: `30000000-0000-4000-8000-00000000000${index}`,
  };
}

describe("Agent REST API", () => {
  it("requires authentication and exposes validated system definition views", async () => {
    const { app } = createTestApp();
    const anonymous = await request(app).get("/api/v1/agents").expect(401);
    expect(errorEnvelopeSchema.parse(anonymous.body).error.code).toBe("auth_required");

    const actor = request.agent(app);
    await register(actor, "definitions@example.com");
    const list = agentDefinitionListResponseSchema.parse(
      (await actor.get("/api/v1/agents").expect(200)).body,
    );
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0]).toMatchObject({
      id: TEST_AGENT_ID,
      systemManaged: true,
      availability: { available: true, reason: null },
    });
    const detail = agentDefinitionResponseSchema.parse(
      (await actor.get(`/api/v1/agents/${TEST_AGENT_ID}`).expect(200)).body,
    );
    expect(detail.agent).toEqual(list.agents[0]);
    expect(JSON.stringify(detail)).not.toContain("apiKey");
  });

  it("creates with server identity, replays idempotently, and denies outsiders and former members", async () => {
    const { app, spaceRepository, agentRepository } = createTestApp();
    const owner = request.agent(app);
    const outsider = request.agent(app);
    const ownerUser = await register(owner, "agent-owner@example.com");
    const outsiderUser = await register(outsider, "agent-outsider@example.com");
    const space = await createSpace(owner);
    const endpoint = `/api/v1/spaces/${space.id}/agent-tasks`;

    const denied = await outsider
      .post(endpoint)
      .set("Origin", origin)
      .send(taskInput(1))
      .expect(404);
    expect(errorEnvelopeSchema.parse(denied.body).error.code).toBe("space_not_found");

    const created = agentTaskCreateResponseSchema.parse(
      (await owner.post(endpoint).set("Origin", origin).send(taskInput(1)).expect(202)).body,
    );
    expect(agentRepository.runs.get(created.run.id)?.actorUserId).toBe(ownerUser.id);
    expect(agentRepository.runs.get(created.run.id)?.actorUserId).not.toBe(outsiderUser.id);

    const replay = agentTaskCreateResponseSchema.parse(
      (await owner.post(endpoint).set("Origin", origin).send(taskInput(1)).expect(200)).body,
    );
    expect(replay).toMatchObject({
      created: false,
      task: { id: created.task.id },
      run: { id: created.run.id },
    });
    const conflict = await owner
      .post(endpoint)
      .set("Origin", origin)
      .send({ ...taskInput(1), prompt: "Different request" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(conflict.body).error.code).toBe(
      "agent_idempotency_conflict",
    );

    spaceRepository.addMember(space.id, outsiderUser.id);
    await outsider.get(`/api/v1/agent-tasks/${created.task.id}`).expect(200);
    spaceRepository.memberships.delete(`${space.id}:${outsiderUser.id}`);
    const former = await outsider.get(`/api/v1/agent-tasks/${created.task.id}`).expect(404);
    expect(errorEnvelopeSchema.parse(former.body).error.code).toBe("agent_task_not_found");
  });

  it("paginates tasks and serves authorized detail, run, and trace reads", async () => {
    const { app } = createTestApp();
    const actor = request.agent(app);
    await register(actor, "agent-reader@example.com");
    const space = await createSpace(actor);
    const endpoint = `/api/v1/spaces/${space.id}/agent-tasks`;
    const created = [];
    for (let index = 1; index <= 3; index += 1) {
      created.push(
        agentTaskCreateResponseSchema.parse(
          (await actor.post(endpoint).set("Origin", origin).send(taskInput(index)).expect(202)).body,
        ),
      );
    }

    const first = agentTaskListResponseSchema.parse(
      (await actor.get(endpoint).query({ limit: 2 }).expect(200)).body,
    );
    expect(first.tasks).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = agentTaskListResponseSchema.parse(
      (
        await actor
          .get(endpoint)
          .query({ limit: 2, cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(second.tasks).toHaveLength(1);
    expect(new Set([...first.tasks, ...second.tasks].map((task) => task.id)).size).toBe(3);

    const target = created[0];
    if (!target) throw new Error("Expected a created Agent task.");
    const detail = agentTaskResponseSchema.parse(
      (await actor.get(`/api/v1/agent-tasks/${target.task.id}`).expect(200)).body,
    );
    expect(detail.runs).toHaveLength(1);
    const run = agentRunResponseSchema.parse(
      (await actor.get(`/api/v1/agent-runs/${target.run.id}`).expect(200)).body,
    );
    expect(run.run.id).toBe(target.run.id);
    const trace = agentRunTraceResponseSchema.parse(
      (await actor.get(`/api/v1/agent-runs/${target.run.id}/steps`).expect(200)).body,
    );
    expect(trace).toEqual({ runId: target.run.id, steps: [], evidence: [] });

    const malformed = await actor.get(endpoint).query({ cursor: "not+a+cursor" }).expect(400);
    expect(errorEnvelopeSchema.parse(malformed.body).error.code).toBe(
      "invalid_agent_task_cursor",
    );
  });

  it("cancels queued and running work, creates retry attempts, and maps terminal cancellation", async () => {
    const { app, agentRepository } = createTestApp();
    const actor = request.agent(app);
    await register(actor, "agent-commands@example.com");
    const space = await createSpace(actor);
    const endpoint = `/api/v1/spaces/${space.id}/agent-tasks`;
    const first = agentTaskCreateResponseSchema.parse(
      (await actor.post(endpoint).set("Origin", origin).send(taskInput(1)).expect(202)).body,
    );

    const cancelled = agentRunResponseSchema.parse(
      (
        await actor
          .post(`/api/v1/agent-runs/${first.run.id}/cancel`)
          .set("Origin", origin)
          .expect(200)
      ).body,
    );
    expect(cancelled.run.status).toBe("cancelled");

    const retryInput = { clientRequestId: "40000000-0000-4000-8000-000000000001" };
    const retry = agentRunCreateResponseSchema.parse(
      (
        await actor
          .post(`/api/v1/agent-tasks/${first.task.id}/runs`)
          .set("Origin", origin)
          .send(retryInput)
          .expect(202)
      ).body,
    );
    expect(retry).toMatchObject({ created: true, run: { attemptNumber: 2, status: "queued" } });
    const replay = agentRunCreateResponseSchema.parse(
      (
        await actor
          .post(`/api/v1/agent-tasks/${first.task.id}/runs`)
          .set("Origin", origin)
          .send(retryInput)
          .expect(200)
      ).body,
    );
    expect(replay).toMatchObject({ created: false, run: { id: retry.run.id } });

    const persisted = agentRepository.runs.get(retry.run.id);
    if (!persisted) throw new Error("Expected retry run.");
    agentRepository.runs.set(retry.run.id, {
      ...persisted,
      status: "running",
      leaseOwnerId: "50000000-0000-4000-8000-000000000001",
      leaseGeneration: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + 180_000),
    });
    const requested = agentRunResponseSchema.parse(
      (
        await actor
          .post(`/api/v1/agent-runs/${retry.run.id}/cancel`)
          .set("Origin", origin)
          .send({})
          .expect(200)
      ).body,
    );
    expect(requested.run).toMatchObject({ status: "running" });
    expect(requested.run.cancelRequestedAt).not.toBeNull();

    const terminal = await actor
      .post(`/api/v1/agent-runs/${first.run.id}/cancel`)
      .set("Origin", origin)
      .send({})
      .expect(409);
    const terminalError = errorEnvelopeSchema.parse(terminal.body).error;
    expect(terminalError.code).toBe("agent_run_terminal");
    expect(terminalError.details).toMatchObject({ run: { status: "cancelled" } });
    expect(JSON.stringify(terminalError.details)).not.toContain("leaseGeneration");
  });

  it("strictly validates requests and validates responses before sending them", async () => {
    const { app, agentRepository } = createTestApp();
    const actor = request.agent(app);
    await register(actor, "agent-validation@example.com");
    const space = await createSpace(actor);
    const invalid = await actor
      .post(`/api/v1/spaces/${space.id}/agent-tasks`)
      .set("Origin", origin)
      .send({ ...taskInput(1), unexpected: true })
      .expect(400);
    expect(errorEnvelopeSchema.parse(invalid.body).error.code).toBe("validation_error");

    const bundle = agentRepository.definitions.get(TEST_AGENT_ID);
    if (!bundle) throw new Error("Expected test Agent definition.");
    agentRepository.definitions.set(TEST_AGENT_ID, {
      ...bundle,
      definition: { ...bundle.definition, systemManaged: false },
    });
    const invalidResponse = await actor.get(`/api/v1/agents/${TEST_AGENT_ID}`).expect(500);
    const responseError = errorEnvelopeSchema.parse(invalidResponse.body).error;
    expect(responseError.code).toBe("internal_server_error");
    expect(responseError).not.toHaveProperty("details");
  });
});
