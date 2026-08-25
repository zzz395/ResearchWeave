import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import {
  connectionListResponseSchema,
  connectionResponseSchema,
} from "../../shared/contracts/connections";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { spaceMemberListResponseSchema } from "../../shared/contracts/members";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
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

async function createSpace(owner: ReturnType<typeof request.agent>) {
  const response = await owner
    .post("/api/v1/spaces")
    .set("Origin", origin)
    .send({ name: "Collaboration Lab" })
    .expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

async function connect(
  requester: ReturnType<typeof request.agent>,
  recipient: ReturnType<typeof request.agent>,
  recipientEmail: string,
) {
  const created = await requester
    .post("/api/v1/connections/requests")
    .set("Origin", origin)
    .send({ email: recipientEmail })
    .expect(201);
  const id = connectionResponseSchema.parse(created.body).connection.id;
  await recipient
    .patch(`/api/v1/connections/${id}`)
    .set("Origin", origin)
    .send({ action: "accept" })
    .expect(200);
}

describe("space members API", () => {
  it("requires an accepted connection and enforces owner/member admission rules", async () => {
    const { app } = createTestApp();
    const owner = request.agent(app);
    const member = request.agent(app);
    const stranger = request.agent(app);
    await register(owner, "owner@example.com", "Owner");
    const memberUser = await register(member, "member@example.com", "Member");
    const strangerUser = await register(stranger, "stranger@example.com", "Stranger");
    const space = await createSpace(owner);

    const denied = await owner
      .post(`/api/v1/spaces/${space.id}/members`)
      .set("Origin", origin)
      .send({ userId: strangerUser.id })
      .expect(403);
    expect(errorEnvelopeSchema.parse(denied.body).error.code).toBe("accepted_connection_required");

    await connect(owner, member, memberUser.email);
    await owner
      .post(`/api/v1/spaces/${space.id}/members`)
      .set("Origin", origin)
      .send({ userId: memberUser.id })
      .expect(201);

    const members = spaceMemberListResponseSchema.parse(
      (await member.get(`/api/v1/spaces/${space.id}/members`).expect(200)).body,
    ).members;
    expect(members.map((item) => item.role)).toEqual(["owner", "member"]);
    await member
      .post(`/api/v1/spaces/${space.id}/members`)
      .set("Origin", origin)
      .send({ userId: strangerUser.id })
      .expect(403);
  });

  it("allows member leave and owner removal without coupling connection deletion", async () => {
    const { app } = createTestApp();
    const owner = request.agent(app);
    const member = request.agent(app);
    const ownerUser = await register(owner, "owner@example.com", "Owner");
    const memberUser = await register(member, "member@example.com", "Member");
    const space = await createSpace(owner);
    await connect(owner, member, memberUser.email);

    async function addMember() {
      await owner
        .post(`/api/v1/spaces/${space.id}/members`)
        .set("Origin", origin)
        .send({ userId: memberUser.id })
        .expect(201);
    }

    await addMember();
    await member
      .delete(`/api/v1/spaces/${space.id}/members/${ownerUser.id}`)
      .set("Origin", origin)
      .expect(403);
    await owner
      .delete(`/api/v1/spaces/${space.id}/members/${ownerUser.id}`)
      .set("Origin", origin)
      .expect(403);

    await member
      .delete(`/api/v1/spaces/${space.id}/members/${memberUser.id}`)
      .set("Origin", origin)
      .expect(204);
    await member.get(`/api/v1/spaces/${space.id}`).expect(404);

    await addMember();
    await owner
      .delete(`/api/v1/spaces/${space.id}/members/${memberUser.id}`)
      .set("Origin", origin)
      .expect(204);
    await member.get(`/api/v1/spaces/${space.id}`).expect(404);
    expect(
      connectionListResponseSchema.parse((await owner.get("/api/v1/connections").expect(200)).body)
        .connections,
    ).toHaveLength(1);
  });
});
