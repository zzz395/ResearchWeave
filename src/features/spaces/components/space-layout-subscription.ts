import type { RealtimeContextValue } from "../../../services/realtime/realtime-context";

export function retainSpaceLayoutSubscription(
  subscribeSpace: RealtimeContextValue["subscribeSpace"],
  spaceId: string,
): () => void {
  return subscribeSpace(spaceId, () => undefined);
}

