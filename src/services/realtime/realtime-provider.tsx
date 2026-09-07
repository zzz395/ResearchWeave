import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  realtimeServerEventSchema,
  type RealtimeClientCommand,
} from "../../../shared/contracts/realtime";
import { sendChatMessageInputSchema } from "../../../shared/contracts/chat";
import { queryClient } from "../../app/query-client";
import {
  actorOwnership,
  type ActorOwnershipSnapshot,
} from "../../features/auth/actor-ownership";
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
  ownership: ActorOwnershipSnapshot;
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
  const actorId = user?.id ?? null;
  const ownership = actorOwnership.current();
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Map<string, Set<(event: SpaceRealtimeUpdate) => void>>());
  const pendingRef = useRef(new Map<string, PendingCommand>());

  const sendCommand = useCallback((command: RealtimeClientCommand) => {
    if (!actorOwnership.owns(ownership)) {
      throw new Error("Realtime actor lifetime was retired.");
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime connection is unavailable.");
    }
    socket.send(JSON.stringify(command));
  }, [ownership]);

  useEffect(() => {
    const listeners = listenersRef.current;
    const pendingCommands = pendingRef.current;

    if (!actorId) {
      socketRef.current?.close(1000, "Signed out");
      socketRef.current = null;
      listeners.clear();
      rejectAllPending(pendingCommands, "Realtime connection was closed.");
      return;
    }

    let disposed = false;
    let retryTimer: number | undefined;
    let retryAttempt = 0;
    let hasConnected = false;

    function ownsLifetime(): boolean {
      return !disposed && actorOwnership.owns(ownership);
    }

    function notify(spaceId: string, event: SpaceRealtimeUpdate) {
      for (const listener of listeners.get(spaceId) ?? []) {
        if (!ownsLifetime()) return;
        listener(event);
      }
    }

    function retire(message: string): void {
      if (disposed) return;
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      rejectAllPending(pendingCommands, message);
      listeners.clear();
      const socket = socketRef.current;
      if (socket) {
        socketRef.current = null;
        socket.close(1000, "Actor lifetime retired");
      }
    }

    function connect() {
      if (!ownsLifetime()) return;
      setStatus("connecting");
      const socket = new WebSocket(realtimeUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (!ownsLifetime() || socket !== socketRef.current) return;
        const reconnected = hasConnected;
        hasConnected = true;
        retryAttempt = 0;
        setStatus("connected");
        for (const spaceId of listeners.keys()) {
          socket.send(JSON.stringify(createCommand("space.subscribe", spaceId)));
          if (reconnected) notify(spaceId, { type: "realtime.reconnected", spaceId });
        }
      });

      socket.addEventListener("message", (message) => {
        if (!ownsLifetime() || socket !== socketRef.current) return;
        if (typeof message.data !== "string") return;
        let event;
        try {
          event = realtimeServerEventSchema.parse(JSON.parse(message.data));
        } catch {
          return;
        }

        if (event.type === "ack" && event.requestId) {
          const pending = pendingCommands.get(event.requestId);
          if (pending) {
            pendingCommands.delete(event.requestId);
            if (actorOwnership.owns(pending.ownership)) pending.resolve();
            else pending.reject(new Error("Realtime actor lifetime was retired."));
          }
        }
        if (event.type === "error" && event.requestId) {
          const pending = pendingCommands.get(event.requestId);
          if (pending) {
            pendingCommands.delete(event.requestId);
            if (actorOwnership.owns(pending.ownership)) {
              pending.reject(new Error(event.payload.message));
            } else {
              pending.reject(new Error("Realtime actor lifetime was retired."));
            }
          }
        }
        if (event.spaceId) notify(event.spaceId, event);
        if (!ownsLifetime()) return;
        if (event.type === "space.access.revoked" && event.spaceId) {
          listeners.delete(event.spaceId);
          queryClient.removeQueries({ queryKey: ["spaces", event.spaceId] });
          queryClient.removeQueries({ queryKey: ["space-members", event.spaceId] });
          queryClient.removeQueries({ queryKey: ["chat-messages", event.spaceId] });
          void queryClient.invalidateQueries({ queryKey: ["spaces"], exact: true });
          window.dispatchEvent(
            new CustomEvent(REALTIME_ACCESS_REVOKED_EVENT, {
              detail: {
                actorId: ownership.actorId,
                generation: ownership.generation,
                spaceId: event.spaceId,
                reason: event.payload.reason,
              },
            }),
          );
        }
      });

      socket.addEventListener("close", () => {
        if (!ownsLifetime() || socket !== socketRef.current) return;
        socketRef.current = null;
        setStatus("disconnected");
        rejectAllPending(pendingCommands, "Realtime connection closed before acknowledgement.");
        if (!ownsLifetime()) return;
        const baseDelay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
        retryAttempt += 1;
        retryTimer = window.setTimeout(connect, baseDelay + Math.floor(Math.random() * 250));
      });

      socket.addEventListener("error", () => {
        // Close drives the bounded reconnect loop and preserves durable REST data.
      });
    }

    const handleActorRetirement = () => retire("Realtime connection was closed.");
    ownership.signal.addEventListener("abort", handleActorRetirement, { once: true });
    connect();
    return () => {
      ownership.signal.removeEventListener("abort", handleActorRetirement);
      retire("Realtime connection was closed.");
    };
  }, [actorId, ownership]);

  const subscribeSpace = useCallback(
    (spaceId: string, listener: (event: SpaceRealtimeUpdate) => void) => {
      if (!actorOwnership.owns(ownership)) return () => undefined;
      return retainSpaceListener(
        listenersRef.current,
        spaceId,
        listener,
        (firstSpaceId) => {
          if (
            actorOwnership.owns(ownership)
            && socketRef.current?.readyState === WebSocket.OPEN
          ) {
            sendCommand(createCommand("space.subscribe", firstSpaceId));
          }
        },
        (lastSpaceId) => {
          if (
            actorOwnership.owns(ownership)
            && socketRef.current?.readyState === WebSocket.OPEN
          ) {
            sendCommand(createCommand("space.unsubscribe", lastSpaceId));
          }
        },
      );
    },
    [ownership, sendCommand],
  );

  const sendChatMessage = useCallback(
    (spaceId: string, body: string) => {
      const input = sendChatMessageInputSchema.parse({ body });
      const command = createCommand("chat.message.send", spaceId, input);
      return new Promise<void>((resolve, reject) => {
        if (!actorOwnership.owns(ownership)) {
          reject(new Error("Realtime actor lifetime was retired."));
          return;
        }
        pendingRef.current.set(command.requestId, { ownership, resolve, reject });
        try {
          sendCommand(command);
        } catch (error: unknown) {
          pendingRef.current.delete(command.requestId);
          reject(error instanceof Error ? error : new Error("Realtime send failed."));
        }
      });
    },
    [ownership, sendCommand],
  );

  const value = useMemo<RealtimeContextValue>(
    () => ({ status: user ? status : "disconnected", subscribeSpace, sendChatMessage }),
    [sendChatMessage, status, subscribeSpace, user],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

function rejectAllPending(pendingCommands: Map<string, PendingCommand>, message: string): void {
  for (const pending of pendingCommands.values()) pending.reject(new Error(message));
  pendingCommands.clear();
}
