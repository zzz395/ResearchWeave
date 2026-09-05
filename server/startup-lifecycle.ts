import type { Server } from "node:http";

export interface ApplicationLifecycleComponent {
  readonly name: string;
  /** stop() is safe during start() and causes the public start Promise to settle. */
  readonly stopWhileStarting?: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type ComponentStopResult =
  | { readonly status: "fulfilled" }
  | { readonly status: "rejected"; readonly error: unknown };

interface ApplicationWorkerStartupLifecycleOptions {
  readonly components: readonly ApplicationLifecycleComponent[];
  readonly onServerError: (error: Error) => void;
  readonly onComponentStartError: (componentName: string, error: unknown) => void;
}

interface ApplicationWorkerStartupLifecycle {
  shutdownComponents(): Promise<void>;
}

export class ApplicationLifecycleStopError extends Error {
  constructor(
    readonly componentName: string,
    options: ErrorOptions,
  ) {
    super(`Application lifecycle component ${componentName} failed to stop.`, options);
    this.name = "ApplicationLifecycleStopError";
  }
}

export function attachApplicationWorkerStartupLifecycle(
  server: Server,
  {
    components,
    onServerError,
    onComponentStartError,
  }: ApplicationWorkerStartupLifecycleOptions,
): ApplicationWorkerStartupLifecycle {
  let shutdownRequested = false;
  let startupPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let startingComponent: ApplicationLifecycleComponent | null = null;
  const stopResults = new Map<
    ApplicationLifecycleComponent,
    Promise<ComponentStopResult>
  >();

  const requestStop = (
    component: ApplicationLifecycleComponent,
  ): Promise<ComponentStopResult> => {
    const existing = stopResults.get(component);
    if (existing) return existing;
    const result = Promise.resolve()
      .then(() => component.stop())
      .then(
        (): ComponentStopResult => ({ status: "fulfilled" }),
        (error: unknown): ComponentStopResult => ({ status: "rejected", error }),
      );
    stopResults.set(component, result);
    return result;
  };

  server.on("error", onServerError);
  server.once("listening", () => {
    if (shutdownRequested) return;

    startupPromise = (async () => {
      for (const component of components) {
        if (shutdownRequested) return;
        startingComponent = component;
        try {
          await component.start();
        } catch (error: unknown) {
          if (!shutdownRequested) onComponentStartError(component.name, error);
          throw error;
        } finally {
          if (startingComponent === component) startingComponent = null;
        }
      }
    })();
    void startupPromise.catch(() => undefined);
  });

  return {
    shutdownComponents(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      shutdownRequested = true;
      const componentStartingAtShutdown = startingComponent;
      shutdownPromise = (async () => {
        if (componentStartingAtShutdown?.stopWhileStarting) {
          void requestStop(componentStartingAtShutdown);
        }
        await startupPromise?.catch(() => undefined);

        const failures: ApplicationLifecycleStopError[] = [];
        for (const component of [...components].reverse()) {
          const result = await requestStop(component);
          if (result.status === "rejected") {
            failures.push(
              new ApplicationLifecycleStopError(component.name, { cause: result.error }),
            );
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, "Application lifecycle components failed to stop.");
        }
      })();
      return shutdownPromise;
    },
  };
}
