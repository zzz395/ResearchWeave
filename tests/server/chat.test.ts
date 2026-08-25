import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import { chatHistoryResponseSchema } from "../../shared/contracts/chat";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
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

describe("persistent chat", () => {
  it("authorizes history and paginates with a stable cursor without duplicates", async () => {
    const { app, chatService } = createTestApp();
    const owner = request.agent(app);
    const outsider = request.agent(app);
    const ownerUser = await register(owner, "owner@example.com", "Owner");
    await register(outsider, "outsider@example.com", "Outsider");
    const created = await owner
      .post("/api/v1/spaces")
      .set("Origin", origin)
      .send({ name: "Message Lab" })
      .expect(201);
    const space = researchSpaceResponseSchema.parse(created.body).space;

    for (const body of ["First", "Second", "Third"]) {
      await chatService.sendMessage(space.id, ownerUser.id, { body });
    }

    await outsider.get(`/api/v1/spaces/${space.id}/messages`).expect(404);
    const firstPage = chatHistoryResponseSchema.parse(
      (await owner.get(`/api/v1/spaces/${space.id}/messages?limit=2`).expect(200)).body,
    );
    expect(firstPage.messages).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = chatHistoryResponseSchema.parse(
      (
        await owner
          .get(`/api/v1/spaces/${space.id}/messages?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`)
          .expect(200)
      ).body,
    );
    expect(secondPage.messages).toHaveLength(1);
    const allMessages = [...firstPage.messages, ...secondPage.messages];
    expect(new Set(allMessages.map((message) => message.id)).size).toBe(3);
    expect(allMessages.map((message) => message.body).sort()).toEqual(["First", "Second", "Third"]);
  });

  it("derives sender on the server and rejects invalid bodies and cursors", async () => {
    const { app, chatService } = createTestApp();
    const owner = request.agent(app);
    const ownerUser = await register(owner, "owner@example.com", "Owner");
    const created = await owner
      .post("/api/v1/spaces")
      .set("Origin", origin)
      .send({ name: "Validation Lab" })
      .expect(201);
    const space = researchSpaceResponseSchema.parse(created.body).space;

    const message = await chatService.sendMessage(space.id, ownerUser.id, { body: "  Evidence first.  " });
    expect(message.sender.id).toBe(ownerUser.id);
    expect(message.body).toBe("Evidence first.");
    await expect(chatService.sendMessage(space.id, ownerUser.id, { body: "   " })).rejects.toBeDefined();
    await expect(
      chatService.sendMessage(space.id, ownerUser.id, { body: "x".repeat(4001) }),
    ).rejects.toBeDefined();

    const invalid = await owner
      .get(`/api/v1/spaces/${space.id}/messages?cursor=not-a-cursor`)
      .expect(400);
    expect(errorEnvelopeSchema.parse(invalid.body).error.code).toBe("invalid_chat_cursor");
  });
});
