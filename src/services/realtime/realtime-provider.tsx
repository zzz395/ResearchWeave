import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  realtimeServerEventSchema,
  type RealtimeClientCommand,
} from "../../../shared/contracts/realtime";
import { sendChatMessageInputSchema } from "../../../shared/contracts/chat";
import { queryClient } from "../../app/query-client";
import { useAuth } from "../../features/auth/auth-state";
import {
  REALTIME_ACCESS_REVOKED_EVENT,
  RealtimeContext,
  type RealtimeContextValue,
  type RealtimeStatus,
  type SpaceRealtimeUpdate,
} from "./realtime-context";
import { retainSpaceListener } from "./space-subscription-lifecycle";

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
}

const retryDelays = [1000, 2000, 4000, 8000, 15_000] as const;

function realtimeUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/realtime`;
}

function createCommand(
  type: RealtimeClientCommand["type"],
  spaceId: string,
  payload: Record<string, unknown> = {},
): RealtimeClientCommand {
  return { version: 1, requestId: crypto.randomUUID(), type, spaceId, payload } as RealtimeClientCommand;
}

export function RealtimeProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Map<string, Set<(event: SpaceRealtimeUpdate) => void>>());
  const pendingRef = useRef(new Map<string, PendingCommand>());

  const sendCommand = useCallback((command: RealtimeClientCommand) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime connection is unavailable.");
    }
    socket.send(JSON.stringify(command));
  }, []);

  useEffect(() => {
    if (!user) {
      socketRef.current?.close(1000, "Signed out");
      socketRef.current = null;
      return;
    }

    let disposed = false;
    let retryTimer: number | undefined;
    let retryAttempt = 0;
    let hasConnected = false;

    function rejectPending(message: string) {
      for (const pending of pendingRef.current.values()) pending.reject(new Error(message));
      pendingRef.current.clear();
    }

    function notify(spaceId: string, event: SpaceRealtimeUpdate) {
      for (const listener of listenersRef.current.get(spaceId) ?? []) listener(event);
    }

    function connect() {
      if (disposed) return;
      setStatus("connecting");
      const socket = new WebSocket(realtimeUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed || socket !== socketRef.current) return;
        const reconnected = hasConnected;
        hasConnected = true;
        retryAttempt = 0;
        setStatus("connected");
        for (const spaceId of listenersRef.current.keys()) {
          socket.send(JSON.stringify(createCommand("space.subscribe", spaceId)));
          if (reconnected) notify(spaceId, { type: "realtime.reconnected", spaceId });
        }
      });

      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") return;
        let event;
        try {
          event = realtimeServerEventSchema.parse(JSON.parse(message.data));
        } catch {
          return;
        }

        if (event.type === "ack" && event.requestId) {
          const pending = pendingRef.current.get(event.requestId);
          if (pending) {
            pendingRef.current.delete(event.requestId);
            pending.resolve();
          }
        }
        if (event.type === "error" && event.requestId) {
          const pending = pendingRef.current.get(event.requestId);
          if (pending) {
            pendingRef.current.delete(event.requestId);
            pending.reject(new Error(event.payload.message));
          }
        }
        if (event.spaceId) notify(event.spaceId, event);
        if (event.type === "space.access.revoked" && event.spaceId) {
          listenersRef.current.delete(event.spaceId);
          queryClient.removeQueries({ queryKey: ["spaces", event.spaceId] });
          queryClient.removeQueries({ queryKey: ["space-members", event.spaceId] });
          queryClient.removeQueries({ queryKey: ["chat-messages", event.spaceId] });
          void queryClient.invalidateQueries({ queryKey: ["spaces"], exact: true });
          window.dispatchEvent(
            new CustomEvent(REALTIME_ACCESS_REVOKED_EVENT, {
              detail: { spaceId: event.spaceId, reason: event.payload.reason },
            }),
          );
        }
      });

      socket.addEventListener("close", () => {
        if (socket !== socketRef.current) return;
        socketRef.current = null;
        setStatus("disconnected");
        rejectPending("Realtime connection closed before acknowledgement.");
        if (disposed) return;
        const baseDelay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
        retryAttempt += 1;
        retryTimer = window.setTimeout(connect, baseDelay + Math.floor(Math.random() * 250));
      });

      socket.addEventListener("error", () => {
        // Close drives the bounded reconnect loop and preserves durable REST data.
      });
    }

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      rejectPending("Realtime connection was closed.");
      socketRef.current?.close(1000, "Provider stopped");
      socketRef.current = null;
    };
  }, [user]);

  const subscribeSpace = useCallback(
    (spaceId: string, listener: (event: SpaceRealtimeUpdate) => void) => {
      return retainSpaceListener(
        listenersRef.current,
        spaceId,
        listener,
        (firstSpaceId) => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            sendCommand(createCommand("space.subscribe", firstSpaceId));
          }
        },
        (lastSpaceId) => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            sendCommand(createCommand("space.unsubscribe", lastSpaceId));
          }
        },
      );
    },
    [sendCommand],
  );

  const sendChatMessage = useCallback(
    (spaceId: string, body: string) => {
      const input = sendChatMessageInputSchema.parse({ body });
      const command = createCommand("chat.message.send", spaceId, input);
      return new Promise<void>((resolve, reject) => {
        pendingRef.current.set(command.requestId, { resolve, reject });
        try {
          sendCommand(command);
        } catch (error: unknown) {
          pendingRef.current.delete(command.requestId);
          reject(error instanceof Error ? error : new Error("Realtime send failed."));
        }
      });
    },
    [sendCommand],
  );

  const value = useMemo<RealtimeContextValue>(
    () => ({ status: user ? status : "disconnected", subscribeSpace, sendChatMessage }),
    [sendChatMessage, status, subscribeSpace, user],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
