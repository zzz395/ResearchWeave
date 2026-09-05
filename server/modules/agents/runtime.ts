import type { AgentRuntimeReadiness, AgentRuntimeState } from "./service";
import type { AgentWorker } from "./worker";

export interface AgentRuntime extends AgentRuntimeReadiness {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type AgentRuntimeOptions =
  | { readonly configured: false }
  | {
      readonly configured: true;
      readonly providerModel: string;
      readonly worker: AgentWorker;
    };

type ConfiguredRuntimeState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed";

class UnconfiguredAgentRuntime implements AgentRuntime {
  readonly #snapshot = Object.freeze({
    ready: false,
    reason: "provider_unconfigured",
  } as const);

  getSnapshot(): AgentRuntimeState {
    return this.#snapshot;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

class ConfiguredAgentRuntime implements AgentRuntime {
  readonly #providerModel: string;
  readonly #worker: AgentWorker;
  #state: ConfiguredRuntimeState = "idle";
  #startPromise: Promise<void> | null = null;
  #stopPromise: Promise<void> | null = null;
  #settleStoppedStart: (() => void) | null = null;

  constructor(providerModel: string, worker: AgentWorker) {
    this.#providerModel = providerModel;
    this.#worker = worker;
  }

  getSnapshot(): AgentRuntimeState {
    return this.#state === "ready"
      ? { ready: true, providerModel: this.#providerModel }
      : { ready: false, reason: "runtime_unavailable" };
  }

  start(): Promise<void> {
    if (this.#state === "ready") return Promise.resolve();
    if (this.#state === "starting" && this.#startPromise) return this.#startPromise;
    if (this.#state !== "idle") {
      return Promise.reject(new TypeError("A stopped or failed Agent runtime cannot be restarted."));
    }

    this.#state = "starting";
    const stoppedDuringStart = new Promise<"stopped">((resolve) => {
      this.#settleStoppedStart = () => resolve("stopped");
    });
    const workerStart = Promise.resolve()
      .then(() => (this.#state === "starting" ? this.#worker.start() : undefined))
      .then(() => "started" as const);
    this.#startPromise = Promise.race([workerStart, stoppedDuringStart])
      .then(
        (outcome) => {
          if (outcome === "started" && this.#state === "starting") {
            this.#state = "ready";
          }
        },
        (error: unknown) => {
          if (this.#state === "starting") this.#state = "failed";
          throw error;
        },
      )
      .finally(() => {
        this.#settleStoppedStart = null;
      });
    return this.#startPromise;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;

    this.#state = "stopping";
    this.#settleStoppedStart?.();
    this.#stopPromise = Promise.resolve()
      .then(() => this.#worker.stop())
      .then(
        () => {
          this.#state = "stopped";
        },
        (error: unknown) => {
          this.#state = "failed";
          throw error;
        },
      );
    return this.#stopPromise;
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  if (!options.configured) return new UnconfiguredAgentRuntime();
  return new ConfiguredAgentRuntime(options.providerModel, options.worker);
}
