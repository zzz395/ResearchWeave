import type { Server } from "node:http";

interface DocumentWorkerStartupLifecycleOptions {
  startWorker: () => Promise<void>;
  stopWorker: () => Promise<void>;
  onServerError: (error: Error) => void;
  onWorkerStartError: (error: unknown) => void;
}

interface DocumentWorkerStartupLifecycle {
  shutdownWorker: () => Promise<void>;
}

export function attachDocumentWorkerStartupLifecycle(
  server: Server,
  {
    startWorker,
    stopWorker,
    onServerError,
    onWorkerStartError,
  }: DocumentWorkerStartupLifecycleOptions,
): DocumentWorkerStartupLifecycle {
  let shutdownRequested = false;
  let workerStartupPromise: Promise<void> | null = null;

  server.on("error", onServerError);
  server.once("listening", () => {
    if (shutdownRequested) {
      return;
    }

    let startupPromise: Promise<void>;
    try {
      startupPromise = startWorker();
    } catch (error: unknown) {
      startupPromise = Promise.reject(
        error instanceof Error
          ? error
          : new Error("Document indexing worker startup threw.", { cause: error }),
      );
    }
    workerStartupPromise = startupPromise;
    void startupPromise.catch(onWorkerStartError);
  });

  return {
    async shutdownWorker(): Promise<void> {
      shutdownRequested = true;
      await workerStartupPromise?.catch(() => undefined);
      await stopWorker();
    },
  };
}
