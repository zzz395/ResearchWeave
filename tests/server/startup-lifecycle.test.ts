import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { attachDocumentWorkerStartupLifecycle } from "../../server/startup-lifecycle";

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
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe("document worker startup lifecycle", () => {
  it("starts the worker once after the HTTP server is listening", async () => {
    const server = createServer();
    const startWorker = vi.fn().mockResolvedValue(undefined);
    const stopWorker = vi.fn().mockResolvedValue(undefined);
    const onServerError = vi.fn();
    const onWorkerStartError = vi.fn();

    try {
      attachDocumentWorkerStartupLifecycle(server, {
        startWorker,
        stopWorker,
        onServerError,
        onWorkerStartError,
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      await vi.waitFor(() => expect(startWorker).toHaveBeenCalledOnce());

      expect(onServerError).not.toHaveBeenCalled();
      expect(onWorkerStartError).not.toHaveBeenCalled();
      expect(stopWorker).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it("does not start the worker when HTTP listen fails", async () => {
    const occupiedServer = createServer();
    const candidateServer = createServer();
    const startWorker = vi.fn().mockResolvedValue(undefined);
    const stopWorker = vi.fn().mockResolvedValue(undefined);
    let exitCode: number | undefined;
    const onServerError = vi.fn(() => {
      exitCode = 1;
    });

    try {
      occupiedServer.listen(0, "127.0.0.1");
      await once(occupiedServer, "listening");
      const address = occupiedServer.address();

      if (address === null || typeof address === "string") {
        throw new Error("expected an assigned TCP port");
      }

      attachDocumentWorkerStartupLifecycle(candidateServer, {
        startWorker,
        stopWorker,
        onServerError,
        onWorkerStartError: vi.fn(),
      });

      const listenError = once(candidateServer, "error");
      candidateServer.listen(address.port, "127.0.0.1");
      const [error] = (await listenError) as [NodeJS.ErrnoException];

      expect(error.code).toBe("EADDRINUSE");
      expect(onServerError).toHaveBeenCalledOnce();
      expect(exitCode).toBe(1);
      expect(startWorker).not.toHaveBeenCalled();
      expect(stopWorker).not.toHaveBeenCalled();
    } finally {
      await closeServer(candidateServer);
      await closeServer(occupiedServer);
    }
  });

  it("does not start the worker when listening occurs after shutdown begins", async () => {
    const server = createServer();
    const startWorker = vi.fn().mockResolvedValue(undefined);
    const stopWorker = vi.fn().mockResolvedValue(undefined);
    const lifecycle = attachDocumentWorkerStartupLifecycle(server, {
      startWorker,
      stopWorker,
      onServerError: vi.fn(),
      onWorkerStartError: vi.fn(),
    });

    await lifecycle.shutdownWorker();
    server.emit("listening");

    expect(startWorker).not.toHaveBeenCalled();
    expect(stopWorker).toHaveBeenCalledOnce();
  });

  it("waits for in-flight worker startup before stopping the worker", async () => {
    const server = createServer();
    const startup = createDeferred();
    const events: string[] = [];
    const startWorker = vi.fn(async () => {
      events.push("start initiated");
      await startup.promise;
      events.push("start resolved");
    });
    const stopWorker = vi.fn(() => {
      events.push("stop");
      return Promise.resolve();
    });
    const lifecycle = attachDocumentWorkerStartupLifecycle(server, {
      startWorker,
      stopWorker,
      onServerError: vi.fn(),
      onWorkerStartError: vi.fn(),
    });

    server.emit("listening");
    events.push("shutdown initiated");
    const shutdownPromise = lifecycle.shutdownWorker();
    await Promise.resolve();

    expect(events).toEqual(["start initiated", "shutdown initiated"]);
    expect(stopWorker).not.toHaveBeenCalled();

    startup.resolve();
    await shutdownPromise;

    expect(events).toEqual(["start initiated", "shutdown initiated", "start resolved", "stop"]);
    expect(stopWorker).toHaveBeenCalledOnce();
  });

  it("continues shutdown when in-flight worker startup rejects", async () => {
    const server = createServer();
    const startup = createDeferred();
    const startupError = new Error("recovery failed");
    const startWorker = vi.fn(() => startup.promise);
    const stopWorker = vi.fn().mockResolvedValue(undefined);
    const onWorkerStartError = vi.fn();
    const lifecycle = attachDocumentWorkerStartupLifecycle(server, {
      startWorker,
      stopWorker,
      onServerError: vi.fn(),
      onWorkerStartError,
    });

    server.emit("listening");
    const shutdownPromise = lifecycle.shutdownWorker();
    startup.reject(startupError);
    await shutdownPromise;

    expect(onWorkerStartError).toHaveBeenCalledOnce();
    expect(onWorkerStartError).toHaveBeenCalledWith(startupError);
    expect(stopWorker).toHaveBeenCalledOnce();
  });
});
