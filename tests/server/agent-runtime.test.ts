import { describe, expect, it, vi } from "vitest";

import { createAgentRuntime } from "../../server/modules/agents/runtime";

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Agent runtime", () => {
  it("reports provider_unconfigured without owning a Worker", async () => {
    const runtime = createAgentRuntime({ configured: false });

    expect(runtime.getSnapshot()).toEqual({
      ready: false,
      reason: "provider_unconfigured",
    });
    await runtime.start();
    await runtime.stop();
    expect(runtime.getSnapshot()).toEqual({
      ready: false,
      reason: "provider_unconfigured",
    });
  });

  it("stays unavailable until configured Worker startup resolves", async () => {
    const startup = createDeferred();
    const worker = {
      start: vi.fn(() => startup.promise),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createAgentRuntime({
      configured: true,
      providerModel: "provider-model",
      worker,
    });

    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });
    const firstStart = runtime.start();
    const concurrentStart = runtime.start();
    expect(concurrentStart).toBe(firstStart);
    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });
    expect(worker.start).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(worker.start).toHaveBeenCalledOnce();
    startup.resolve();
    await firstStart;

    expect(runtime.getSnapshot()).toEqual({ ready: true, providerModel: "provider-model" });
    await runtime.start();
    expect(worker.start).toHaveBeenCalledOnce();
  });

  it("remains unavailable after startup rejection and prohibits restart", async () => {
    const startupError = new Error("claim probe failed");
    const worker = {
      start: vi.fn().mockRejectedValue(startupError),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createAgentRuntime({
      configured: true,
      providerModel: "provider-model",
      worker,
    });

    await expect(runtime.start()).rejects.toBe(startupError);
    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });
    await expect(runtime.start()).rejects.toThrow(
      "A stopped or failed Agent runtime cannot be restarted.",
    );
    expect(worker.start).toHaveBeenCalledOnce();
  });

  it("revokes readiness before awaiting Worker stop and memoizes stop", async () => {
    const shutdown = createDeferred();
    const worker = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(() => shutdown.promise),
    };
    const runtime = createAgentRuntime({
      configured: true,
      providerModel: "provider-model",
      worker,
    });
    await runtime.start();

    const firstStop = runtime.stop();
    const concurrentStop = runtime.stop();
    expect(concurrentStop).toBe(firstStop);
    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });
    await Promise.resolve();
    expect(worker.stop).toHaveBeenCalledOnce();

    shutdown.resolve();
    await firstStop;
    await runtime.stop();
    expect(worker.stop).toHaveBeenCalledOnce();
    await expect(runtime.start()).rejects.toThrow(
      "A stopped or failed Agent runtime cannot be restarted.",
    );
  });

  it("never becomes ready when stop races an unresolved startup", async () => {
    const startup = createDeferred();
    const shutdown = createDeferred();
    const worker = {
      start: vi.fn(() => startup.promise),
      stop: vi.fn(() => shutdown.promise),
    };
    const runtime = createAgentRuntime({
      configured: true,
      providerModel: "provider-model",
      worker,
    });

    const startPromise = runtime.start();
    await Promise.resolve();
    const stopPromise = runtime.stop();
    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });

    startup.resolve();
    await startPromise;
    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });

    shutdown.resolve();
    await stopPromise;
    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });
  });

  it("settles its public startup when stop owns an unresolved Worker startup", async () => {
    const startup = createDeferred();
    const worker = {
      start: vi.fn(() => startup.promise),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createAgentRuntime({
      configured: true,
      providerModel: "provider-model",
      worker,
    });
    const startPromise = runtime.start();
    let startSettled = false;
    void startPromise.then(() => {
      startSettled = true;
    });
    await Promise.resolve();

    try {
      await runtime.stop();
      await Promise.resolve();
      expect(startSettled).toBe(true);
      expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });
    } finally {
      startup.resolve();
      await startPromise;
    }
  });

  it("keeps readiness unavailable when Worker stop rejects", async () => {
    const shutdownError = new Error("stop failed");
    const worker = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockRejectedValue(shutdownError),
    };
    const runtime = createAgentRuntime({
      configured: true,
      providerModel: "provider-model",
      worker,
    });
    await runtime.start();

    await expect(runtime.stop()).rejects.toBe(shutdownError);
    expect(runtime.getSnapshot()).toEqual({ ready: false, reason: "runtime_unavailable" });
    await expect(runtime.stop()).rejects.toBe(shutdownError);
    expect(worker.stop).toHaveBeenCalledOnce();
  });
});
