import { randomUUID } from "node:crypto";

import WebSocket from "ws";

import {
  realtimeServerEventSchema,
  type RealtimeClientCommand,
  type RealtimeServerEvent,
} from "../../shared/contracts/realtime";
import type { ChatMessage } from "../../shared/contracts/chat";

interface ClientState {
  userId: string;
  sessionHash: string;
  subscriptions: Set<string>;
}

type AccessRevocationReason = "membership_removed" | "space_deleted";

export class RealtimeHub {
  private readonly clients = new Map<WebSocket, ClientState>();

  register(socket: WebSocket, userId: string, sessionHash: string): void {
    this.clients.set(socket, { userId, sessionHash, subscriptions: new Set() });
  }

  unregister(socket: WebSocket): void {
    const state = this.clients.get(socket);
    if (!state) return;
    const affectedSpaces = [...state.subscriptions];
    this.clients.delete(socket);
    for (const spaceId of affectedSpaces) {
      if (!this.isUserPresent(spaceId, state.userId)) this.broadcastPresence(spaceId);
    }
  }

  isSubscribed(socket: WebSocket, spaceId: string): boolean {
    return this.clients.get(socket)?.subscriptions.has(spaceId) ?? false;
  }

  subscribe(socket: WebSocket, spaceId: string, requestId: string): void {
    const state = this.clients.get(socket);
    if (!state) return;
    const wasPresent = this.isUserPresent(spaceId, state.userId);
    state.subscriptions.add(spaceId);
    this.send(socket, {
      type: "space.snapshot",
      spaceId,
      requestId,
      payload: { presentUserIds: this.getPresentUserIds(spaceId) },
    });
    if (!wasPresent) this.broadcastPresence(spaceId);
  }

  unsubscribe(socket: WebSocket, spaceId: string): void {
    const state = this.clients.get(socket);
    if (!state?.subscriptions.delete(spaceId)) return;
    if (!this.isUserPresent(spaceId, state.userId)) this.broadcastPresence(spaceId);
  }

  broadcastMessage(spaceId: string, message: ChatMessage): void {
    this.broadcast(spaceId, {
      type: "chat.message.created",
      spaceId,
      payload: { message },
    });
  }

  sendAck(socket: WebSocket, command: RealtimeClientCommand): void {
    this.send(socket, {
      type: "ack",
      spaceId: command.spaceId,
      requestId: command.requestId,
      payload: { commandType: command.type },
    });
  }

  sendError(
    socket: WebSocket,
    code: string,
    message: string,
    requestId?: string,
    spaceId?: string,
  ): void {
    this.send(socket, {
      type: "error",
      ...(requestId ? { requestId } : {}),
      ...(spaceId ? { spaceId } : {}),
      payload: { code, message },
    });
  }

  revokeMember(spaceId: string, userId: string): void {
    let changed = false;
    for (const [socket, state] of this.clients) {
      if (state.userId !== userId || !state.subscriptions.delete(spaceId)) continue;
      changed = true;
      this.sendAccessRevoked(socket, spaceId, "membership_removed");
    }
    if (changed) this.broadcastPresence(spaceId);
  }

  revokeSpace(spaceId: string): void {
    for (const [socket, state] of this.clients) {
      if (!state.subscriptions.delete(spaceId)) continue;
      this.sendAccessRevoked(socket, spaceId, "space_deleted");
    }
  }

  closeSession(sessionHash: string): void {
    for (const [socket, state] of this.clients) {
      if (state.sessionHash === sessionHash) socket.close(4001, "Session ended");
    }
  }

  getPresentUserIds(spaceId: string): string[] {
    const userIds = new Set<string>();
    for (const state of this.clients.values()) {
      if (state.subscriptions.has(spaceId)) userIds.add(state.userId);
    }
    return [...userIds].sort();
  }

  private isUserPresent(spaceId: string, userId: string): boolean {
    for (const state of this.clients.values()) {
      if (state.userId === userId && state.subscriptions.has(spaceId)) return true;
    }
    return false;
  }

  private broadcastPresence(spaceId: string): void {
    this.broadcast(spaceId, {
      type: "presence.updated",
      spaceId,
      payload: { presentUserIds: this.getPresentUserIds(spaceId) },
    });
  }

  private sendAccessRevoked(
    socket: WebSocket,
    spaceId: string,
    reason: AccessRevocationReason,
  ): void {
    this.send(socket, {
      type: "space.access.revoked",
      spaceId,
      payload: { reason },
    });
  }

  private broadcast(
    spaceId: string,
    event: Omit<RealtimeServerEvent, "version" | "eventId" | "occurredAt">,
  ): void {
    for (const [socket, state] of this.clients) {
      if (state.subscriptions.has(spaceId)) this.send(socket, event);
    }
  }

  private send(
    socket: WebSocket,
    event: Omit<RealtimeServerEvent, "version" | "eventId" | "occurredAt">,
  ): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1_000_000) {
      socket.terminate();
      return;
    }
    const envelope = realtimeServerEventSchema.parse({
      version: 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      ...event,
    });
    try {
      socket.send(JSON.stringify(envelope));
    } catch {
      socket.terminate();
    }
  }
}
