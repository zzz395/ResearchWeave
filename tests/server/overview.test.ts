import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import { overviewResponseSchema } from "../../shared/contracts/overview";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import type { DocumentRecord } from "../../server/db/schema";
import { TEST_AGENT_ID } from "../helpers/in-memory-agent-repository";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;

async function register(agent: ReturnType<typeof request.agent>, email: string) {
  const response = await agent.post("/api/v1/auth/register").set("Origin", origin).send({
    email,
    displayName: "Overview User",
    password: "secure-password",
  }).expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function createSpace(agent: ReturnType<typeof request.agent>, name: string) {
  const response = await agent.post("/api/v1/spaces").set("Origin", origin).send({ name }).expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

function documentFixture(
  id: string,
  spaceId: string,
  userId: string,
  status: DocumentRecord["status"],
  updatedAt: Date,
): DocumentRecord {
  return {
    id,
    spaceId,
    uploadedByUserId: userId,
    originalFilename: `${status}.txt`,
    mediaType: "text",
    sizeBytes: 10,
    sourceSha256: id.replaceAll("-", "").padEnd(64, "b").slice(0, 64),
    storageKey: `private/${id}`,
    status,
    stage: status === "processing" ? "embedding" : null,
    attemptCount: 0,
    lastAttemptAt: null,
    errorCode: null,
    failedAt: null,
    pageCount: null,
    characterCount: null,
    chunkCount: 0,
    extractorVersion: null,
    chunkerVersion: null,
    embeddingModel: null,
    embeddingDimensions: null,
    indexFingerprint: null,
    indexedAt: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("Overview API", () => {
  it("requires authentication", async () => {
    const { app } = createTestApp();
    await request(app).get("/api/v1/overview").expect(401);
  });

  it("returns an empty durable projection for a new user", async () => {
    const harness = createTestApp();
    const agent = request.agent(harness.app);
    await register(agent, "overview-empty@example.com");
    const response = await agent.get("/api/v1/overview").expect(200);
    expect(overviewResponseSchema.parse(response.body)).toEqual({
      recentSpaces: [],
      activeWork: [],
      recentActivity: [],
    });
  });

  it("applies fixed caps and includes only current queued or running work", async () => {
    const harness = createTestApp();
    const agent = request.agent(harness.app);
    const user = await register(agent, "overview-caps@example.com");
    const spaces = [];
    for (let index = 0; index < 5; index += 1) {
      spaces.push(await createSpace(agent, `Overview Space ${index}`));
    }
    const spaceId = spaces[0].id;
    const statuses: DocumentRecord["status"][] = [
      "queued", "processing", "ready", "failed", "queued", "processing", "queued", "processing",
    ];
    statuses.forEach((status, index) => {
      const id = `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      harness.documentRepository.documents.set(
        id,
        documentFixture(id, spaceId, user.id, status, new Date(Date.UTC(2026, 8, 5, 7, index))),
      );
    });
    await agent.post(`/api/v1/spaces/${spaceId}/agent-tasks`).set("Origin", origin).send({
      agentId: TEST_AGENT_ID,
      prompt: "Overview active Agent work",
      clientRequestId: "70000000-0000-4000-8000-000000000001",
    }).expect(202);

    const response = await agent.get("/api/v1/overview").expect(200);
    const body = overviewResponseSchema.parse(response.body);
    expect(body.recentSpaces).toHaveLength(4);
    expect(body.activeWork).toHaveLength(6);
    expect(body.recentActivity.length).toBeLessThanOrEqual(8);
    expect(body.activeWork.every((item) => item.kind === "document"
      ? ["queued", "processing"].includes(item.document.status)
      : ["queued", "running"].includes(item.run.status))).toBe(true);
    expect(JSON.stringify(body)).not.toContain("ready.txt");
    expect(JSON.stringify(body)).not.toContain("failed.txt");
  });

  it("rechecks membership and removes revoked Space work from the projection", async () => {
    const harness = createTestApp();
    const ownerAgent = request.agent(harness.app);
    const memberAgent = request.agent(harness.app);
    const owner = await register(ownerAgent, "overview-owner@example.com");
    const member = await register(memberAgent, "overview-member@example.com");
    const space = await createSpace(ownerAgent, "Revocation Space");
    await harness.memberRepository.add(space.id, member.id, new Date());
    const document = documentFixture(
      "80000000-0000-4000-8000-000000000001",
      space.id,
      owner.id,
      "queued",
      new Date(),
    );
    harness.documentRepository.documents.set(document.id, document);
    let body = overviewResponseSchema.parse((await memberAgent.get("/api/v1/overview").expect(200)).body);
    expect(body.activeWork).toHaveLength(1);

    await harness.memberRepository.removeOrdinaryMember(space.id, member.id);
    body = overviewResponseSchema.parse((await memberAgent.get("/api/v1/overview").expect(200)).body);
    expect(body).toEqual({ recentSpaces: [], activeWork: [], recentActivity: [] });
  });
});
