import type { SpaceRealtimeUpdate } from "./realtime-context";

type SpaceListener = (event: SpaceRealtimeUpdate) => void;

export function retainSpaceListener(
  listenersBySpace: Map<string, Set<SpaceListener>>,
  spaceId: string,
  listener: SpaceListener,
  onFirstListener: (spaceId: string) => void,
  onLastListenerRemoved: (spaceId: string) => void,
): () => void {
  const listeners = listenersBySpace.get(spaceId) ?? new Set<SpaceListener>();
  const isFirst = listeners.size === 0;
  listeners.add(listener);
  listenersBySpace.set(spaceId, listeners);
  if (isFirst) onFirstListener(spaceId);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = listenersBySpace.get(spaceId);
    current?.delete(listener);
    if (current?.size === 0) {
      listenersBySpace.delete(spaceId);
      onLastListenerRemoved(spaceId);
    }
  };
}

