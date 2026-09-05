import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { attachApplicationWorkerStartupLifecycle } from "../../server/startup-lifecycle";

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

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function component(name: string, events: string[]) {
  return {
    name,
    start: vi.fn(() => {
      events.push(`start:${name}`);
      return Promise.resolve();
    }),
    stop: vi.fn(() => {
      events.push(`stop:${name}`);
      return Promise.resolve();
    }),
  };
}

describe("application worker startup lifecycle", () => {
  it("starts components once and sequentially after HTTP listening", async () => {
    const server = createServer();
    const events: string[] = [];
    const firstStart = createDeferred();
    const first = {
      name: "document worker",
      start: vi.fn(async () => {
        events.push("start:document");
        await firstStart.promise;
        events.push("ready:document");
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const second = component("Agent runtime", events);

    try {
      attachApplicationWorkerStartupLifecycle(server, {
        components: [first, second],
        onServerError: vi.fn(),
        onComponentStartError: vi.fn(),
      });
      expect(first.start).not.toHaveBeenCalled();

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      await vi.waitFor(() => expect(first.start).toHaveBeenCalledOnce());
      expect(second.start).not.toHaveBeenCalled();

      firstStart.resolve();
      await vi.waitFor(() => expect(second.start).toHaveBeenCalledOnce());
      expect(events).toEqual(["start:document", "ready:document", "start:Agent runtime"]);
    } finally {
      firstStart.resolve();
      await closeServer(server);
    }
  });

  it("starts no components when HTTP listen fails", async () => {
    const occupiedServer = createServer();
    const candidateServer = createServer();
    const events: string[] = [];
    const first = component("document worker", events);
    const second = component("Agent runtime", events);
    const onServerError = vi.fn();

    try {
      occupiedServer.listen(0, "127.0.0.1");
      await once(occupiedServer, "listening");
      const address = occupiedServer.address();
      if (address === null || typeof address === "string") throw new Error("expected port");

      attachApplicationWorkerStartupLifecycle(candidateServer, {
        components: [first, second],
        onServerError,
        onComponentStartError: vi.fn(),
      });
      const listenError = once(candidateServer, "error");
      candidateServer.listen(address.port, "127.0.0.1");
      await listenError;

      expect(onServerError).toHaveBeenCalledOnce();
      expect(first.start).not.toHaveBeenCalled();
      expect(second.start).not.toHaveBeenCalled();
    } finally {
      await closeServer(candidateServer);
      await closeServer(occupiedServer);
    }
  });

  it("prevents startup after shutdown begins", async () => {
    const server = createServer();
    const events: string[] = [];
    const first = component("document worker", events);
    const second = component("Agent runtime", events);
    const lifecycle = attachApplicationWorkerStartupLifecycle(server, {
      components: [first, second],
      onServerError: vi.fn(),
      onComponentStartError: vi.fn(),
    });

    await lifecycle.shutdownComponents();
    server.emit("listening");

    expect(first.start).not.toHaveBeenCalled();
    expect(second.start).not.toHaveBeenCalled();
    expect(events).toEqual(["stop:Agent runtime", "stop:document worker"]);
  });

  it("awaits in-flight startup and then stops components in reverse order", async () => {
    const server = createServer();
    const startup = createDeferred();
    const events: string[] = [];
    const first = {
      name: "document worker",
      start: vi.fn(async () => {
        events.push("start:document");
        await startup.promise;
        events.push("ready:document");
      }),
      stop: vi.fn(() => {
        events.push("stop:document");
        return Promise.resolve();
      }),
    };
    const second = component("Agent runtime", events);
    const lifecycle = attachApplicationWorkerStartupLifecycle(server, {
      components: [first, second],
      onServerError: vi.fn(),
      onComponentStartError: vi.fn(),
    });

    server.emit("listening");
    const shutdownPromise = lifecycle.shutdownComponents();
    await Promise.resolve();
    expect(events).toEqual(["start:document"]);

    startup.resolve();
    await shutdownPromise;
    expect(second.start).not.toHaveBeenCalled();
    expect(events).toEqual([
      "start:document",
      "ready:document",
      "stop:Agent runtime",
      "stop:document",
    ]);
  });

  it("gives a cancellable current startup a stop opportunity before awaiting it", async () => {
    const server = createServer();
    const startup = createDeferred();
    const events: string[] = [];
    const first = component("document worker", events);
    const current = {
      name: "Agent runtime",
      stopWhileStarting: true,
      start: vi.fn(() => {
        events.push("start:Agent runtime");
        return startup.promise;
      }),
      stop: vi.fn(() => {
        events.push("stop:Agent runtime");
        startup.resolve();
        return Promise.resolve();
      }),
    };
    const later = component("later worker", events);
    const lifecycle = attachApplicationWorkerStartupLifecycle(server, {
      components: [first, current, later],
      onServerError: vi.fn(),
      onComponentStartError: vi.fn(),
    });

    server.emit("listening");
    await vi.waitFor(() => expect(current.start).toHaveBeenCalledOnce());
    const shutdownPromise = lifecycle.shutdownComponents();
    const repeatedShutdown = lifecycle.shutdownComponents();

    try {
      expect(repeatedShutdown).toBe(shutdownPromise);
      await Promise.resolve();
      expect(current.stop).toHaveBeenCalledOnce();
      await shutdownPromise;
      expect(later.start).not.toHaveBeenCalled();
      expect(later.stop).toHaveBeenCalledOnce();
      expect(first.stop).toHaveBeenCalledOnce();
      expect(current.stop).toHaveBeenCalledOnce();
      expect(events).toEqual([
        "start:document worker",
        "start:Agent runtime",
        "stop:Agent runtime",
        "stop:later worker",
        "stop:document worker",
      ]);
    } finally {
      startup.resolve();
      await shutdownPromise.catch(() => undefined);
    }
  });

  it("identifies a failing component and stops the startup sequence", async () => {
    const server = createServer();
    const events: string[] = [];
    const startupError = new Error("claim probe failed");
    const first = component("document worker", events);
    const failing = {
      name: "Agent runtime",
      stopWhileStarting: true,
      start: vi.fn(() => {
        events.push("start:Agent runtime");
        return Promise.reject(startupError);
      }),
      stop: vi.fn(() => {
        events.push("stop:Agent runtime");
        return Promise.resolve();
      }),
    };
    const later = component("later worker", events);
    const shutdownCapture: { promise?: Promise<void> } = {};
    const onComponentStartError = vi.fn(() => {
      shutdownCapture.promise = lifecycle.shutdownComponents();
    });
    const lifecycle = attachApplicationWorkerStartupLifecycle(server, {
      components: [first, failing, later],
      onServerError: vi.fn(),
      onComponentStartError,
    });

    server.emit("listening");
    await vi.waitFor(() => expect(onComponentStartError).toHaveBeenCalledOnce());
    expect(onComponentStartError).toHaveBeenCalledWith("Agent runtime", startupError);
    const fatalShutdown = shutdownCapture.promise;
    if (!fatalShutdown) throw new Error("Expected startup failure to initiate shutdown.");
    await fatalShutdown;
    expect(later.start).not.toHaveBeenCalled();
    expect(later.stop).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(failing.stop).toHaveBeenCalledOnce();
    expect(lifecycle.shutdownComponents()).toBe(fatalShutdown);
    await lifecycle.shutdownComponents();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(failing.stop).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "start:document worker",
      "start:Agent runtime",
      "stop:Agent runtime",
      "stop:later worker",
      "stop:document worker",
    ]);
  });

  it("attempts every stop, aggregates failures, and memoizes shutdown", async () => {
    const server = createServer();
    const events: string[] = [];
    const stopError = new Error("Agent stop failed");
    const first = component("document worker", events);
    const failing = {
      name: "Agent runtime",
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(() => {
        events.push("stop:Agent runtime");
        return Promise.reject(stopError);
      }),
    };
    const lifecycle = attachApplicationWorkerStartupLifecycle(server, {
      components: [first, failing],
      onServerError: vi.fn(),
      onComponentStartError: vi.fn(),
    });

    const firstShutdown = lifecycle.shutdownComponents();
    const repeatedShutdown = lifecycle.shutdownComponents();
    expect(repeatedShutdown).toBe(firstShutdown);
    await expect(firstShutdown).rejects.toMatchObject({
      name: "AggregateError",
      errors: [
        expect.objectContaining({
          name: "ApplicationLifecycleStopError",
          componentName: "Agent runtime",
          cause: stopError,
        }),
      ],
    });
    expect(events).toEqual(["stop:Agent runtime", "stop:document worker"]);
    expect(failing.stop).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
    await expect(lifecycle.shutdownComponents()).rejects.toBeInstanceOf(AggregateError);
    expect(failing.stop).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
  });
});
