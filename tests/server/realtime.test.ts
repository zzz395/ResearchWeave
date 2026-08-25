import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import { authResponseSchema, type User } from "../../shared/contracts/auth";
import { chatHistoryResponseSchema } from "../../shared/contracts/chat";
import {
  realtimeServerEventSchema,
  type RealtimeClientCommand,
  type RealtimeServerEvent,
} from "../../shared/contracts/realtime";
import { createRealtimeTestServer } from "../helpers/create-realtime-test-server";
import { testEnvironment } from "../helpers/create-test-app";

interface RegisteredUser {
  user: User;
  cookie: string;
}

function decodeTextFrame(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

class EventRecorder {
  private readonly events: RealtimeServerEvent[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      this.events.push(realtimeServerEventSchema.parse(JSON.parse(decodeTextFrame(data))));
      for (const notify of this.waiters) notify();
    });
  }

  async take(
    predicate: (event: RealtimeServerEvent) => boolean,
    timeoutMs = 1500,
  ): Promise<RealtimeServerEvent> {
    const existingIndex = this.events.findIndex(predicate);
    if (existingIndex >= 0) return this.events.splice(existingIndex, 1)[0];
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error("Timed out waiting for realtime event."));
      }, timeoutMs);
      const check = () => {
        const index = this.events.findIndex(predicate);
        if (index < 0) return;
        clearTimeout(timeout);
        this.waiters.delete(check);
        resolve(this.events.splice(index, 1)[0]);
      };
      this.waiters.add(check);
    });
  }

  async expectNone(predicate: (event: RealtimeServerEvent) => boolean, durationMs = 150) {
    await expect(this.take(predicate, durationMs)).rejects.toThrow("Timed out");
  }
}

const openSockets = new Set<WebSocket>();

afterEach(async () => {
  await Promise.all(
    [...openSockets].map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.once("close", () => resolve());
          socket.close();
        }),
    ),
  );
  openSockets.clear();
});

async function register(server: Server, email: string, displayName: string): Promise<RegisteredUser> {
  const response = await request(server)
    .post("/api/v1/auth/register")
    .set("Origin", testEnvironment.CLIENT_ORIGIN)
    .send({ email, displayName, password: "secure-password" })
    .expect(201);
  const setCookie = response.headers["set-cookie"]?.[0];
  if (!setCookie) throw new Error("Registration did not issue a session cookie.");
  return {
    user: authResponseSchema.parse(response.body).user,
    cookie: setCookie.split(";", 1)[0],
  };
}

function connect(wsUrl: string, cookie: string, origin = testEnvironment.CLIENT_ORIGIN) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { Cookie: cookie, Origin: origin } });
    socket.once("open", () => {
      openSockets.add(socket);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function rejectedUpgrade(wsUrl: string, cookie?: string, origin = testEnvironment.CLIENT_ORIGIN) {
  return new Promise<number | undefined>((resolve, reject) => {
    const socket = new WebSocket(wsUrl, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin },
    });
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    socket.once("open", () => reject(new Error("Expected the WebSocket upgrade to be rejected.")));
    socket.once("error", () => undefined);
  });
}

function send(socket: WebSocket, command: RealtimeClientCommand) {
  socket.send(JSON.stringify(command));
}

function command(
  type: RealtimeClientCommand["type"],
  spaceId: string,
  payload: Record<string, unknown> = {},
): RealtimeClientCommand {
  return { version: 1, requestId: randomUUID(), type, spaceId, payload } as RealtimeClientCommand;
}

async function closeSocket(socket: WebSocket) {
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
  openSockets.delete(socket);
}

describe("authenticated realtime gateway", () => {
  it("rejects missing/invalid sessions and wrong origins while allowing a valid cookie", async () => {
    const context = await createRealtimeTestServer();
    try {
      const registered = await register(context.server, "ada@example.com", "Ada");
      expect(await rejectedUpgrade(context.wsUrl)).toBe(401);
      expect(await rejectedUpgrade(context.wsUrl, "researchweave_session=invalid")).toBe(401);
      expect(await rejectedUpgrade(context.wsUrl, registered.cookie, "http://wrong.example")).toBe(403);
      const socket = await connect(context.wsUrl, registered.cookie);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      const closed = new Promise<number>((resolve) => {
        socket.once("close", (code) => resolve(code));
      });
      await request(context.server)
        .post("/api/v1/auth/logout")
        .set("Origin", testEnvironment.CLIENT_ORIGIN)
        .set("Cookie", registered.cookie)
        .expect(204);
      expect(await closed).toBe(4001);
    } finally {
      await context.close();
    }
  });

  it("authorizes subscriptions, persists before broadcast, and recovers missed history", async () => {
    const context = await createRealtimeTestServer();
    try {
      const owner = await register(context.server, "owner@example.com", "Owner");
      const member = await register(context.server, "member@example.com", "Member");
      const outsider = await register(context.server, "outsider@example.com", "Outsider");
      const space = await context.spaceService.createSpace(
        { name: "Realtime Lab", description: null },
        owner.user.id,
      );
      context.spaceRepository.addMember(space.id, member.user.id);

      const ownerSocket = await connect(context.wsUrl, owner.cookie);
      const memberSocket = await connect(context.wsUrl, member.cookie);
      const outsiderSocket = await connect(context.wsUrl, outsider.cookie);
      const ownerEvents = new EventRecorder(ownerSocket);
      const memberEvents = new EventRecorder(memberSocket);
      const outsiderEvents = new EventRecorder(outsiderSocket);

      const ownerSubscribe = command("space.subscribe", space.id);
      send(ownerSocket, ownerSubscribe);
      await ownerEvents.take((event) => event.type === "space.snapshot");
      await ownerEvents.take((event) => event.type === "ack" && event.requestId === ownerSubscribe.requestId);
      const memberSubscribe = command("space.subscribe", space.id);
      send(memberSocket, memberSubscribe);
      await memberEvents.take((event) => event.type === "space.snapshot");
      await memberEvents.take((event) => event.type === "ack" && event.requestId === memberSubscribe.requestId);

      const outsiderSubscribe = command("space.subscribe", space.id);
      send(outsiderSocket, outsiderSubscribe);
      const denied = await outsiderEvents.take(
        (event) => event.type === "error" && event.requestId === outsiderSubscribe.requestId,
      );
      expect(denied.type === "error" && denied.payload.code).toBe("space_not_found");

      const sendMessage = command("chat.message.send", space.id, {
        body: "Committed evidence",
        senderUserId: outsider.user.id,
      });
      send(ownerSocket, sendMessage);
      const ownerCreated = await ownerEvents.take((event) => event.type === "chat.message.created");
      const memberCreated = await memberEvents.take((event) => event.type === "chat.message.created");
      await ownerEvents.take((event) => event.type === "ack" && event.requestId === sendMessage.requestId);
      expect(ownerCreated.type === "chat.message.created" && ownerCreated.payload.message.sender.id).toBe(owner.user.id);
      expect(memberCreated.type === "chat.message.created" && memberCreated.payload.message.id).toBe(
        ownerCreated.type === "chat.message.created" ? ownerCreated.payload.message.id : "",
      );
      expect(context.chatRepository.messages).toHaveLength(1);
      await outsiderEvents.expectNone((event) => event.type === "chat.message.created");

      await closeSocket(memberSocket);
      const missed = command("chat.message.send", space.id, { body: "Missed while disconnected" });
      send(ownerSocket, missed);
      await ownerEvents.take((event) => event.type === "chat.message.created");
      await ownerEvents.take((event) => event.type === "ack" && event.requestId === missed.requestId);

      const reconnected = await connect(context.wsUrl, member.cookie);
      const reconnectEvents = new EventRecorder(reconnected);
      const resubscribe = command("space.subscribe", space.id);
      send(reconnected, resubscribe);
      await reconnectEvents.take((event) => event.type === "space.snapshot");
      await reconnectEvents.take((event) => event.type === "ack" && event.requestId === resubscribe.requestId);
      const history = chatHistoryResponseSchema.parse(
        (
          await request(context.server)
            .get(`/api/v1/spaces/${space.id}/messages`)
            .set("Cookie", member.cookie)
            .expect(200)
        ).body,
      );
      expect(history.messages.map((message) => message.body)).toEqual([
        "Committed evidence",
        "Missed while disconnected",
      ]);
      expect(new Set(history.messages.map((message) => message.id)).size).toBe(history.messages.length);
    } finally {
      await context.close();
    }
  });

  it("does not broadcast or acknowledge a failed persistence operation", async () => {
    const context = await createRealtimeTestServer();
    try {
      const owner = await register(context.server, "owner@example.com", "Owner");
      const space = await context.spaceService.createSpace(
        { name: "Durability Lab", description: null },
        owner.user.id,
      );
      const socket = await connect(context.wsUrl, owner.cookie);
      const events = new EventRecorder(socket);
      const subscribe = command("space.subscribe", space.id);
      send(socket, subscribe);
      await events.take((event) => event.type === "space.snapshot");
      await events.take((event) => event.type === "ack" && event.requestId === subscribe.requestId);

      context.chatRepository.failNextInsert = true;
      const failed = command("chat.message.send", space.id, { body: "Must not appear" });
      send(socket, failed);
      const error = await events.take((event) => event.type === "error" && event.requestId === failed.requestId);
      expect(error.type === "error" && error.payload.code).toBe("realtime_internal_error");
      await events.expectNone(
        (event) =>
          (event.type === "ack" && event.requestId === failed.requestId) ||
          event.type === "chat.message.created",
      );
      expect(context.chatRepository.messages).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("does not activate a subscription whose membership is removed during authorization", async () => {
    const context = await createRealtimeTestServer();
    let releaseAuthorization: (() => void) | undefined;
    try {
      const owner = await register(context.server, "race-owner@example.com", "Race Owner");
      const removedMember = await register(
        context.server,
        "race-removed@example.com",
        "Removed Member",
      );
      const normalMember = await register(
        context.server,
        "race-normal@example.com",
        "Normal Member",
      );
      const space = await context.spaceService.createSpace(
        { name: "Authorization Race Lab", description: null },
        owner.user.id,
      );
      context.spaceRepository.addMember(space.id, removedMember.user.id);
      context.spaceRepository.addMember(space.id, normalMember.user.id);

      const ownerSocket = await connect(context.wsUrl, owner.cookie);
      const removedSocket = await connect(context.wsUrl, removedMember.cookie);
      const normalSocket = await connect(context.wsUrl, normalMember.cookie);
      const ownerEvents = new EventRecorder(ownerSocket);
      const removedEvents = new EventRecorder(removedSocket);
      const normalEvents = new EventRecorder(normalSocket);

      const ownerSubscribe = command("space.subscribe", space.id);
      send(ownerSocket, ownerSubscribe);
      await ownerEvents.take((event) => event.type === "space.snapshot");
      await ownerEvents.take(
        (event) => event.type === "ack" && event.requestId === ownerSubscribe.requestId,
      );
      const normalSubscribe = command("space.subscribe", space.id);
      send(normalSocket, normalSubscribe);
      await normalEvents.take((event) => event.type === "space.snapshot");
      await normalEvents.take(
        (event) => event.type === "ack" && event.requestId === normalSubscribe.requestId,
      );

      const authorizationPause = context.pauseNextSpaceAuthorization();
      releaseAuthorization = authorizationPause.release;
      const staleSubscribe = command("space.subscribe", space.id);
      send(removedSocket, staleSubscribe);
      await authorizationPause.reached;

      await request(context.server)
        .delete(`/api/v1/spaces/${space.id}/members/${removedMember.user.id}`)
        .set("Origin", testEnvironment.CLIENT_ORIGIN)
        .set("Cookie", owner.cookie)
        .expect(204);
      authorizationPause.release();
      releaseAuthorization = undefined;

      const revoked = await removedEvents.take(
        (event) => event.type === "space.access.revoked" && event.spaceId === space.id,
      );
      expect(revoked.type === "space.access.revoked" && revoked.payload.reason).toBe(
        "membership_removed",
      );
      await removedEvents.expectNone(
        (event) =>
          event.type === "space.snapshot" ||
          (event.type === "ack" && event.requestId === staleSubscribe.requestId),
      );
      expect(context.hub.getPresentUserIds(space.id)).toEqual(
        [normalMember.user.id, owner.user.id].sort(),
      );

      const sendMessage = command("chat.message.send", space.id, { body: "Authorized only" });
      send(ownerSocket, sendMessage);
      await ownerEvents.take((event) => event.type === "chat.message.created");
      await normalEvents.take((event) => event.type === "chat.message.created");
      await ownerEvents.take(
        (event) => event.type === "ack" && event.requestId === sendMessage.requestId,
      );
      await removedEvents.expectNone((event) => event.type === "chat.message.created");

      const resubscribe = command("space.subscribe", space.id);
      send(removedSocket, resubscribe);
      const denied = await removedEvents.take(
        (event) => event.type === "error" && event.requestId === resubscribe.requestId,
      );
      expect(denied.type === "error" && denied.payload.code).toBe("space_not_found");
    } finally {
      releaseAuthorization?.();
      await context.close();
    }
  });

  it("does not activate a subscription when its space is deleted during authorization", async () => {
    const context = await createRealtimeTestServer();
    let releaseAuthorization: (() => void) | undefined;
    try {
      const owner = await register(context.server, "delete-owner@example.com", "Delete Owner");
      const member = await register(context.server, "delete-member@example.com", "Delete Member");
      const space = await context.spaceService.createSpace(
        { name: "Space Deletion Race Lab", description: null },
        owner.user.id,
      );
      context.spaceRepository.addMember(space.id, member.user.id);
      const memberSocket = await connect(context.wsUrl, member.cookie);
      const memberEvents = new EventRecorder(memberSocket);

      const authorizationPause = context.pauseNextSpaceAuthorization();
      releaseAuthorization = authorizationPause.release;
      const staleSubscribe = command("space.subscribe", space.id);
      send(memberSocket, staleSubscribe);
      await authorizationPause.reached;

      await request(context.server)
        .delete(`/api/v1/spaces/${space.id}`)
        .set("Origin", testEnvironment.CLIENT_ORIGIN)
        .set("Cookie", owner.cookie)
        .expect(204);
      authorizationPause.release();
      releaseAuthorization = undefined;

      const revoked = await memberEvents.take(
        (event) => event.type === "space.access.revoked" && event.spaceId === space.id,
      );
      expect(revoked.type === "space.access.revoked" && revoked.payload.reason).toBe(
        "space_deleted",
      );
      await memberEvents.expectNone(
        (event) =>
          event.type === "space.snapshot" ||
          (event.type === "ack" && event.requestId === staleSubscribe.requestId),
      );
      expect(context.hub.getPresentUserIds(space.id)).toEqual([]);
    } finally {
      releaseAuthorization?.();
      await context.close();
    }
  });

  it("deduplicates multi-tab presence and revokes removed members immediately", async () => {
    const context = await createRealtimeTestServer();
    try {
      const owner = await register(context.server, "owner@example.com", "Owner");
      const member = await register(context.server, "member@example.com", "Member");
      const space = await context.spaceService.createSpace(
        { name: "Presence Lab", description: null },
        owner.user.id,
      );
      context.spaceRepository.addMember(space.id, member.user.id);

      const ownerSocket = await connect(context.wsUrl, owner.cookie);
      const memberTabOne = await connect(context.wsUrl, member.cookie);
      const memberTabTwo = await connect(context.wsUrl, member.cookie);
      const ownerEvents = new EventRecorder(ownerSocket);
      const tabOneEvents = new EventRecorder(memberTabOne);
      const tabTwoEvents = new EventRecorder(memberTabTwo);

      const ownerSubscribe = command("space.subscribe", space.id);
      send(ownerSocket, ownerSubscribe);
      await ownerEvents.take((event) => event.type === "space.snapshot");
      await ownerEvents.take((event) => event.type === "presence.updated");
      await ownerEvents.take(
        (event) => event.type === "ack" && event.requestId === ownerSubscribe.requestId,
      );
      send(memberTabOne, command("space.subscribe", space.id));
      await tabOneEvents.take((event) => event.type === "space.snapshot");
      const firstPresence = await ownerEvents.take((event) => event.type === "presence.updated");
      expect(
        firstPresence.type === "presence.updated" && firstPresence.payload.presentUserIds,
      ).toEqual([member.user.id, owner.user.id].sort());

      send(memberTabTwo, command("space.subscribe", space.id));
      const secondSnapshot = await tabTwoEvents.take((event) => event.type === "space.snapshot");
      expect(
        secondSnapshot.type === "space.snapshot" && secondSnapshot.payload.presentUserIds,
      ).toEqual([member.user.id, owner.user.id].sort());
      await ownerEvents.expectNone((event) => event.type === "presence.updated");

      await closeSocket(memberTabOne);
      await ownerEvents.expectNone((event) => event.type === "presence.updated");

      await closeSocket(memberTabTwo);
      const presenceAfterLastClose = await ownerEvents.take(
        (event) => event.type === "presence.updated",
      );
      expect(
        presenceAfterLastClose.type === "presence.updated" &&
          presenceAfterLastClose.payload.presentUserIds,
      ).toEqual([owner.user.id]);

      const memberReconnected = await connect(context.wsUrl, member.cookie);
      const reconnectedEvents = new EventRecorder(memberReconnected);
      send(memberReconnected, command("space.subscribe", space.id));
      await reconnectedEvents.take((event) => event.type === "space.snapshot");
      await ownerEvents.take((event) => event.type === "presence.updated");

      await request(context.server)
        .delete(`/api/v1/spaces/${space.id}/members/${member.user.id}`)
        .set("Origin", testEnvironment.CLIENT_ORIGIN)
        .set("Cookie", owner.cookie)
        .expect(204);
      const revoked = await reconnectedEvents.take((event) => event.type === "space.access.revoked");
      expect(revoked.type === "space.access.revoked" && revoked.payload.reason).toBe("membership_removed");
      const presenceAfterRevoke = await ownerEvents.take((event) => event.type === "presence.updated");
      expect(
        presenceAfterRevoke.type === "presence.updated" && presenceAfterRevoke.payload.presentUserIds,
      ).toEqual([owner.user.id]);

      await request(context.server)
        .get(`/api/v1/spaces/${space.id}`)
        .set("Cookie", member.cookie)
        .expect(404);
      await request(context.server)
        .get(`/api/v1/spaces/${space.id}/messages`)
        .set("Cookie", member.cookie)
        .expect(404);
      const deniedSend = command("chat.message.send", space.id, { body: "No longer allowed" });
      send(memberReconnected, deniedSend);
      const sendError = await reconnectedEvents.take(
        (event) => event.type === "error" && event.requestId === deniedSend.requestId,
      );
      expect(sendError.type === "error" && sendError.payload.code).toBe("space_not_subscribed");
      const resubscribe = command("space.subscribe", space.id);
      send(memberReconnected, resubscribe);
      const denied = await reconnectedEvents.take(
        (event) => event.type === "error" && event.requestId === resubscribe.requestId,
      );
      expect(denied.type === "error" && denied.payload.code).toBe("space_not_found");
    } finally {
      await context.close();
    }
  });
});
