import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import type { Logger } from "pino";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { z, ZodError } from "zod";

import { realtimeClientCommandSchema, type RealtimeClientCommand } from "../../shared/contracts/realtime";
import type { Environment } from "../config/env";
import { AppError } from "../middleware/app-error";
import { SESSION_COOKIE_NAME } from "../modules/auth/session-cookie";
import { hashSessionToken, type AuthService } from "../modules/auth/service";
import type { ChatService } from "../modules/chat/service";
import type { SpaceService } from "../modules/spaces/service";
import { RealtimeHub } from "./hub";

const REALTIME_PATH = "/api/v1/realtime";
const MAX_COMMANDS_PER_WINDOW = 60;
const MAX_CHAT_SENDS_PER_WINDOW = 20;
const RATE_WINDOW_MS = 60_000;
const HEARTBEAT_MS = 30_000;
const uuidSchema = z.string().uuid();

interface SocketRuntimeState {
  token: string;
  userId: string;
  alive: boolean;
  windowStartedAt: number;
  commandsInWindow: number;
  chatSendsInWindow: number;
  queue: Promise<void>;
}

interface RealtimeGatewayDependencies {
  server: Server;
  environment: Environment;
  logger: Logger;
  authService: AuthService;
  spaceService: SpaceService;
  chatService: ChatService;
  hub: RealtimeHub;
}

function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = valueParts.join("=");
    if (!value || value.length > 128) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
  if (!socket.writable) return;
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function decodeTextFrame(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

export function attachRealtimeGateway({
  server,
  environment,
  logger,
  authService,
  spaceService,
  chatService,
  hub,
}: RealtimeGatewayDependencies) {
  const trustedOrigin = new URL(environment.CLIENT_ORIGIN).origin;
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
  });
  const runtime = new Map<WebSocket, SocketRuntimeState>();

  async function dispatch(socket: WebSocket, command: RealtimeClientCommand): Promise<void> {
    const state = runtime.get(socket);
    if (!state) return;
    const now = Date.now();
    if (now - state.windowStartedAt >= RATE_WINDOW_MS) {
      state.windowStartedAt = now;
      state.commandsInWindow = 0;
      state.chatSendsInWindow = 0;
    }
    state.commandsInWindow += 1;
    if (command.type === "chat.message.send") state.chatSendsInWindow += 1;
    if (
      state.commandsInWindow > MAX_COMMANDS_PER_WINDOW ||
      state.chatSendsInWindow > MAX_CHAT_SENDS_PER_WINDOW
    ) {
      hub.sendError(socket, "realtime_rate_limited", "Too many realtime commands. Try again shortly.", command.requestId, command.spaceId);
      return;
    }

    if (command.type === "space.subscribe") {
      await spaceService.getSpace(command.spaceId, state.userId);
      hub.subscribe(socket, command.spaceId, command.requestId);
      hub.sendAck(socket, command);
      return;
    }
    if (command.type === "space.unsubscribe") {
      hub.unsubscribe(socket, command.spaceId);
      hub.sendAck(socket, command);
      return;
    }
    if (!hub.isSubscribed(socket, command.spaceId)) {
      throw new AppError(403, "space_not_subscribed", "Subscribe to the research space before sending messages.");
    }
    await spaceService.getSpace(command.spaceId, state.userId);
    const message = await chatService.sendMessage(command.spaceId, state.userId, command.payload);
    hub.broadcastMessage(command.spaceId, message);
    hub.sendAck(socket, command);
  }

  async function handleMessage(socket: WebSocket, data: RawData, isBinary: boolean): Promise<void> {
    let parsed: unknown;
    let requestId: string | undefined;
    let spaceId: string | undefined;
    try {
      if (isBinary) throw new AppError(400, "invalid_realtime_command", "Binary realtime commands are not supported.");
      parsed = JSON.parse(decodeTextFrame(data));
      if (typeof parsed === "object" && parsed !== null) {
        const candidate = parsed as { requestId?: unknown; spaceId?: unknown };
        const candidateRequestId = uuidSchema.safeParse(candidate.requestId);
        const candidateSpaceId = uuidSchema.safeParse(candidate.spaceId);
        if (candidateRequestId.success) requestId = candidateRequestId.data;
        if (candidateSpaceId.success) spaceId = candidateSpaceId.data;
      }
      const command = realtimeClientCommandSchema.parse(parsed);
      await dispatch(socket, command);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        hub.sendError(socket, error.code, error.message, requestId, spaceId);
        return;
      }
      if (error instanceof ZodError || error instanceof SyntaxError) {
        hub.sendError(socket, "invalid_realtime_command", "The realtime command did not match the expected structure.", requestId, spaceId);
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : "UnknownError", userId: runtime.get(socket)?.userId },
        "realtime command failed",
      );
      hub.sendError(socket, "realtime_internal_error", "The realtime command could not be completed.", requestId, spaceId);
    }
  }

  function initializeSocket(
    socket: WebSocket,
    request: IncomingMessage,
    userId: string,
    token: string,
  ): void {
    runtime.set(socket, {
      token,
      userId,
      alive: true,
      windowStartedAt: Date.now(),
      commandsInWindow: 0,
      chatSendsInWindow: 0,
      queue: Promise.resolve(),
    });
    hub.register(socket, userId, hashSessionToken(token));
    socket.on("pong", () => {
      const state = runtime.get(socket);
      if (state) state.alive = true;
    });
    socket.on("message", (data, isBinary) => {
      const state = runtime.get(socket);
      if (!state) return;
      state.queue = state.queue
        .then(() => handleMessage(socket, data, isBinary))
        .catch((error: unknown) => {
          logger.error(
            { errorType: error instanceof Error ? error.name : "UnknownError", userId },
            "realtime command queue failed",
          );
          hub.sendError(socket, "realtime_internal_error", "The realtime command could not be completed.");
        });
    });
    socket.on("error", () => {
      logger.warn({ userId, remoteAddress: request.socket.remoteAddress }, "realtime socket error");
    });
    socket.on("close", () => {
      runtime.delete(socket);
      hub.unregister(socket);
    });
  }

  const upgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const target = new URL(request.url ?? "/", "http://researchweave.local");
      if (target.pathname !== REALTIME_PATH || target.search !== "") {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      if (request.headers.origin !== trustedOrigin) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      const token = readSessionToken(request.headers.cookie);
      if (!token) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      try {
        const user = await authService.getUserForSession(token);
        if (!user) {
          rejectUpgrade(socket, 401, "Unauthorized");
          return;
        }
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          initializeSocket(webSocket, request, user.id, token);
        });
      } catch (error: unknown) {
        logger.error(
          { errorType: error instanceof Error ? error.name : "UnknownError" },
          "realtime authentication failed",
        );
        rejectUpgrade(socket, 503, "Service Unavailable");
      }
    })();
  };
  server.on("upgrade", upgradeHandler);

  const heartbeat = setInterval(() => {
    for (const [socket, state] of runtime) {
      if (!state.alive) {
        socket.terminate();
        continue;
      }
      state.alive = false;
      void authService
        .getUserForSession(state.token)
        .then((user) => {
          if (!user) socket.close(4001, "Session ended");
          else if (socket.readyState === WebSocket.OPEN) socket.ping();
        })
        .catch(() => socket.terminate());
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    async close(): Promise<void> {
      clearInterval(heartbeat);
      server.off("upgrade", upgradeHandler);
      for (const socket of runtime.keys()) socket.close(1001, "Server shutting down");
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    },
  };
}
