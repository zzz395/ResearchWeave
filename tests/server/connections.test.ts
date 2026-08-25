import request from "supertest";
import { describe, expect, it } from "vitest";

import { connectionListResponseSchema, connectionResponseSchema } from "../../shared/contracts/connections";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { authResponseSchema } from "../../shared/contracts/auth";
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

describe("connections API", () => {
  it("prevents self, duplicate, and reverse-duplicate requests", async () => {
    const { app } = createTestApp();
    const ada = request.agent(app);
    const grace = request.agent(app);
    await register(ada, "ada@example.com", "Ada");
    await register(grace, "grace@example.com", "Grace");

    const self = await ada
      .post("/api/v1/connections/requests")
      .set("Origin", origin)
      .send({ email: "ADA@example.com" })
      .expect(400);
    expect(errorEnvelopeSchema.parse(self.body).error.code).toBe("connection_self_not_allowed");

    await ada
      .post("/api/v1/connections/requests")
      .set("Origin", origin)
      .send({ email: " grace@example.com " })
      .expect(201);
    await ada
      .post("/api/v1/connections/requests")
      .set("Origin", origin)
      .send({ email: "grace@example.com" })
      .expect(409);
    const reverse = await grace
      .post("/api/v1/connections/requests")
      .set("Origin", origin)
      .send({ email: "ada@example.com" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(reverse.body).error.code).toBe("connection_already_exists");
  });

  it("supports list, accept, remove, reject, and cancel with participant authorization", async () => {
    const { app } = createTestApp();
    const ada = request.agent(app);
    const grace = request.agent(app);
    const thirdParty = request.agent(app);
    const adaUser = await register(ada, "ada@example.com", "Ada");
    const graceUser = await register(grace, "grace@example.com", "Grace");
    await register(thirdParty, "third@example.com", "Third");

    const created = await ada
      .post("/api/v1/connections/requests")
      .set("Origin", origin)
      .send({ email: graceUser.email })
      .expect(201);
    const pending = connectionResponseSchema.parse(created.body).connection;
    expect(pending).toMatchObject({ status: "pending", requestedByUserId: adaUser.id });

    const incoming = connectionListResponseSchema.parse(
      (await grace.get("/api/v1/connections").expect(200)).body,
    ).connections;
    expect(incoming[0]?.otherUser.id).toBe(adaUser.id);

    await thirdParty
      .patch(`/api/v1/connections/${pending.id}`)
      .set("Origin", origin)
      .send({ action: "accept" })
      .expect(404);
    await ada
      .patch(`/api/v1/connections/${pending.id}`)
      .set("Origin", origin)
      .send({ action: "accept" })
      .expect(403);

    const accepted = await grace
      .patch(`/api/v1/connections/${pending.id}`)
      .set("Origin", origin)
      .send({ action: "accept" })
      .expect(200);
    expect(connectionResponseSchema.parse(accepted.body).connection.status).toBe("accepted");
    await ada
      .delete(`/api/v1/connections/${pending.id}`)
      .set("Origin", origin)
      .expect(204);

    const rejectedRequest = connectionResponseSchema.parse(
      (
        await ada
          .post("/api/v1/connections/requests")
          .set("Origin", origin)
          .send({ email: graceUser.email })
          .expect(201)
      ).body,
    ).connection;
    await grace
      .patch(`/api/v1/connections/${rejectedRequest.id}`)
      .set("Origin", origin)
      .send({ action: "reject" })
      .expect(204);

    const cancelledRequest = connectionResponseSchema.parse(
      (
        await grace
          .post("/api/v1/connections/requests")
          .set("Origin", origin)
          .send({ email: adaUser.email })
          .expect(201)
      ).body,
    ).connection;
    await grace
      .patch(`/api/v1/connections/${cancelledRequest.id}`)
      .set("Origin", origin)
      .send({ action: "cancel" })
      .expect(204);
    expect(connectionListResponseSchema.parse((await ada.get("/api/v1/connections")).body).connections).toEqual([]);
  });
});

