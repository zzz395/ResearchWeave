import { describe, expect, it, vi } from "vitest";

import { retainSpaceLayoutSubscription } from "../../src/features/spaces/components/space-layout-subscription";
import { retainSpaceListener } from "../../src/services/realtime/space-subscription-lifecycle";
import type { SpaceRealtimeUpdate } from "../../src/services/realtime/realtime-context";

describe("space subscription lifecycle", () => {
  it("retains a subscription for the shared SpaceLayout lifecycle", () => {
    const release = vi.fn();
    const subscribeSpace = vi.fn(() => release);
    const cleanup = retainSpaceLayoutSubscription(
      subscribeSpace,
      "00000000-0000-4000-8000-000000000001",
    );

    expect(subscribeSpace).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.any(Function),
    );
    cleanup();
    expect(release).toHaveBeenCalledOnce();
  });

  it("sends one subscribe for the first listener and one unsubscribe after the last", () => {
    const listeners = new Map<
      string,
      Set<(event: SpaceRealtimeUpdate) => void>
    >();
    const onFirst = vi.fn();
    const onLast = vi.fn();
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const releaseLayout = retainSpaceListener(
      listeners,
      "space-1",
      firstListener,
      onFirst,
      onLast,
    );
    const releaseNestedPage = retainSpaceListener(
      listeners,
      "space-1",
      secondListener,
      onFirst,
      onLast,
    );

    expect(onFirst).toHaveBeenCalledOnce();
    releaseNestedPage();
    expect(onLast).not.toHaveBeenCalled();
    releaseLayout();
    expect(onLast).toHaveBeenCalledOnce();
    releaseLayout();
    expect(onLast).toHaveBeenCalledOnce();
  });
});

