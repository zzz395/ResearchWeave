import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import {
  researchSpaceListResponseSchema,
  researchSpaceResponseSchema,
} from "../../shared/contracts/spaces";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;

async function register(agent: ReturnType<typeof request.agent>, email: string, name: string) {
  const response = await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ displayName: name, email, password: "secure-password" })
    .expect(201);
  return authResponseSchema.parse(response.body).user;
}

describe("research spaces API", () => {
  it("requires authentication and validates request origin and shape", async () => {
    const { app } = createTestApp();
    await request(app).get("/api/v1/spaces").expect(401);

    const agent = request.agent(app);
    await register(agent, "owner@example.com", "Owner");
    await agent.post("/api/v1/spaces").send({ name: "Evidence Lab" }).expect(403);
    await agent
      .post("/api/v1/spaces")
      .set("Origin", origin)
      .send({ name: "x", description: "a".repeat(1001) })
      .expect(400);
  });

  it("creates the owner membership atomically and lists only memberships", async () => {
    const { app, spaceRepository } = createTestApp();
    const ownerAgent = request.agent(app);
    const owner = await register(ownerAgent, "owner@example.com", "Owner");

    const created = await ownerAgent
      .post("/api/v1/spaces")
      .set("Origin", origin)
      .send({ name: "  Evidence Lab  ", description: "  Shared synthesis work.  " })
      .expect(201);
    const createdSpace = researchSpaceResponseSchema.parse(created.body).space;
    expect(createdSpace).toMatchObject({
      name: "Evidence Lab",
      description: "Shared synthesis work.",
      ownerId: owner.id,
      role: "owner",
    });
    expect(spaceRepository.hasMembership(createdSpace.id, owner.id)).toBe(true);

    const list = await ownerAgent.get("/api/v1/spaces").expect(200);
    const listedSpaces = researchSpaceListResponseSchema.parse(list.body).spaces;
    expect(listedSpaces).toHaveLength(1);
    expect(listedSpaces[0]?.id).toBe(createdSpace.id);

    const outsiderAgent = request.agent(app);
    await register(outsiderAgent, "outsider@example.com", "Outsider");
    const outsiderList = await outsiderAgent.get("/api/v1/spaces").expect(200);
    expect(researchSpaceListResponseSchema.parse(outsiderList.body).spaces).toEqual([]);
  });

  it("hides spaces from non-members and permits member reads", async () => {
    const { app, spaceRepository } = createTestApp();
    const ownerAgent = request.agent(app);
    const memberAgent = request.agent(app);
    await register(ownerAgent, "owner@example.com", "Owner");
    const member = await register(memberAgent, "member@example.com", "Member");

    const created = await ownerAgent
      .post("/api/v1/spaces")
      .set("Origin", origin)
      .send({ name: "Policy Review" })
      .expect(201);
    const spaceId = researchSpaceResponseSchema.parse(created.body).space.id;

    await memberAgent.get(`/api/v1/spaces/${spaceId}`).expect(404);
    spaceRepository.addMember(spaceId, member.id);
    const readable = await memberAgent.get(`/api/v1/spaces/${spaceId}`).expect(200);
    expect(researchSpaceResponseSchema.parse(readable.body).space.role).toBe("member");
  });

  it("allows only owners to update or delete and cascades memberships", async () => {
    const { app, spaceRepository } = createTestApp();
    const ownerAgent = request.agent(app);
    const memberAgent = request.agent(app);
    const owner = await register(ownerAgent, "owner@example.com", "Owner");
    const member = await register(memberAgent, "member@example.com", "Member");
    const created = await ownerAgent
      .post("/api/v1/spaces")
      .set("Origin", origin)
      .send({ name: "Original Name", description: "Draft" })
      .expect(201);
    const spaceId = researchSpaceResponseSchema.parse(created.body).space.id;
    spaceRepository.addMember(spaceId, member.id);

    const forbiddenUpdate = await memberAgent
      .patch(`/api/v1/spaces/${spaceId}`)
      .set("Origin", origin)
      .send({ name: "Hijacked" })
      .expect(403);
    expect(errorEnvelopeSchema.parse(forbiddenUpdate.body).error.code).toBe("space_forbidden");
    await memberAgent
      .delete(`/api/v1/spaces/${spaceId}`)
      .set("Origin", origin)
      .expect(403);

    const updated = await ownerAgent
      .patch(`/api/v1/spaces/${spaceId}`)
      .set("Origin", origin)
      .send({ name: "Verified Name", description: "" })
      .expect(200);
    expect(researchSpaceResponseSchema.parse(updated.body).space).toMatchObject({
      name: "Verified Name",
      description: null,
    });

    await ownerAgent
      .delete(`/api/v1/spaces/${spaceId}`)
      .set("Origin", origin)
      .expect(204);
    expect(spaceRepository.spaces.has(spaceId)).toBe(false);
    expect(spaceRepository.hasMembership(spaceId, owner.id)).toBe(false);
    expect(spaceRepository.hasMembership(spaceId, member.id)).toBe(false);
    await ownerAgent.get(`/api/v1/spaces/${spaceId}`).expect(404);
  });
});
