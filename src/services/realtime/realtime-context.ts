import { createContext, useContext } from "react";

import type { RealtimeServerEvent } from "../../../shared/contracts/realtime";

export type RealtimeStatus = "disconnected" | "connecting" | "connected";
export type SpaceRealtimeUpdate =
  | RealtimeServerEvent
  | { type: "realtime.reconnected"; spaceId: string };

export interface RealtimeContextValue {
  status: RealtimeStatus;
  subscribeSpace: (spaceId: string, listener: (event: SpaceRealtimeUpdate) => void) => () => void;
  sendChatMessage: (spaceId: string, body: string) => Promise<void>;
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export const REALTIME_ACCESS_REVOKED_EVENT = "researchweave:space-access-revoked";

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("useRealtime must be used within RealtimeProvider.");
  return context;
}

