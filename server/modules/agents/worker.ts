import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type {
  AgentRunClaim,
  AgentRepository,
  AgentWorkerFence,
  ClaimAgentRunResult,
  HeartbeatAgentLeaseResult,
} from "./repository";
import type {
  AgentExecutionLeaseCheckpoint,
  AgentRunExecutionOutcome,
  AgentRunExecutor,
} from "./run-executor";

export interface AgentWorkerTiming {
  readonly idlePollMs: number;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatRetryMs: number;
  readonly leaseSafetyMarginMs: number;
  readonly shutdownGraceMs: number;
  readonly shutdownSettleMs: number;
}

export const AGENT_WORKER_TIMING = Object.freeze({
  idlePollMs: 2_000,
  leaseDurationMs: 60_000,
  heartbeatIntervalMs: 15_000,
  heartbeatRetryMs: 2_000,
  leaseSafetyMarginMs: 15_000,
  shutdownGraceMs: 10_000,
  shutdownSettleMs: 5_000,
} as const satisfies AgentWorkerTiming);

type WorkerRepository = Pick<AgentRepository, "claimRun" | "heartbeatLease">;
type WorkerLogger = Pick<Logger, "info" | "warn" | "error">;
type Wait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface AgentWorkerDependencies {
  readonly repository: WorkerRepository;
  readonly executor: AgentRunExecutor;
  readonly logger: WorkerLogger;
  readonly timing?: AgentWorkerTiming;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly wait?: Wait;
}

export interface AgentWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

type WorkerState = "constructed" | "starting" | "running" | "stopping" | "stopped" | "failed";
type HeartbeatOutcome = "updated" | "retry" | "stop";
type StopCause = "cancel_requested" | "lease_lost" | "lease_renewal_uncertain" | "shutdown";

interface ActiveRun {
  readonly runId: string;
  readonly executionController: AbortController;
  readonly stopMaintenance: (cause?: StopCause) => void;
  readonly completion: Promise<void>;
}

class AgentWorkerBoundaryError extends Error {
  constructor(readonly kind: StopCause | "wait_cancelled") {
    super("The Agent worker stopped a local execution boundary.");
    this.name = "AgentWorkerBoundaryError";
    this.stack = undefined;
  }
}

const WAIT_CANCELLED = new AgentWorkerBoundaryError("wait_cancelled");
const SHUTDOWN = new AgentWorkerBoundaryError("shutdown");

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : WAIT_CANCELLED);
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason instanceof Error ? signal.reason : WAIT_CANCELLED);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    timer.unref();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function validateTiming(timing: AgentWorkerTiming): void {
  for (const [name, value] of Object.entries(timing)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(`Agent worker ${name} must be a positive integer.`);
    }
  }
  if (timing.heartbeatIntervalMs >= timing.leaseDurationMs) {
    throw new TypeError("Agent heartbeat interval must be shorter than the lease duration.");
  }
  if (timing.leaseSafetyMarginMs >= timing.leaseDurationMs) {
    throw new TypeError("Agent lease safety margin must be shorter than the lease duration.");
  }
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

class DefaultAgentWorker implements AgentWorker {
  readonly #repository: WorkerRepository;
  readonly #executor: AgentRunExecutor;
  readonly #logger: WorkerLogger;
  readonly #timing: AgentWorkerTiming;
  readonly #now: () => Date;
  readonly #wait: Wait;
  readonly #leaseOwnerId: string;
  readonly #lifecycleController = new AbortController();
  #state: WorkerState = "constructed";
  #stopRequested = false;
  #startPromise: Promise<void> | null = null;
  #stopPromise: Promise<void> | null = null;
  #loopPromise: Promise<void> | null = null;
  #activeRun: ActiveRun | null = null;

  constructor(dependencies: AgentWorkerDependencies) {
    const timing = dependencies.timing ?? AGENT_WORKER_TIMING;
    validateTiming(timing);
    this.#repository = dependencies.repository;
    this.#executor = dependencies.executor;
    this.#logger = dependencies.logger;
    this.#timing = Object.freeze({ ...timing });
    this.#now = dependencies.now ?? (() => new Date());
    this.#wait = dependencies.wait ?? defaultWait;
    this.#leaseOwnerId = (dependencies.createId ?? randomUUID)();
  }

  start(): Promise<void> {
    if (this.#state === "running") return Promise.resolve();
    if (this.#startPromise) return this.#startPromise;
    if (this.#state !== "constructed") {
      return Promise.reject(new TypeError("A stopped or failed Agent worker cannot be restarted."));
    }
    this.#state = "starting";
    this.#startPromise = this.#startInternal();
    return this.#startPromise;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopRequested = true;
    this.#state = "stopping";
    this.#lifecycleController.abort(SHUTDOWN);
    this.#stopPromise = this.#stopInternal();
    return this.#stopPromise;
  }

  async #startInternal(): Promise<void> {
    try {
      const firstClaim = await this.#claimRun();
      if (this.#stopRequested) {
        this.#state = "stopped";
        return;
      }
      this.#state = "running";
      this.#logger.info({ event: "agent_worker_started" }, "Agent worker started");
      this.#loopPromise = this.#runLoop(firstClaim);
    } catch (error: unknown) {
      this.#state = this.#stopRequested ? "stopped" : "failed";
      if (!this.#stopRequested) {
        this.#logger.error(
          { event: "agent_worker_start_failed", errorType: errorType(error) },
          "Agent worker failed to start",
        );
      }
      throw error;
    }
  }

  async #stopInternal(): Promise<void> {
    if (this.#startPromise) {
      const startSettled = await this.#settlesWithin(
        this.#startPromise,
        this.#timing.shutdownSettleMs,
      );
      if (!startSettled) void this.#startPromise.catch(() => undefined);
    }

    const active = this.#activeRun;
    let activeSettlementTimedOut = false;
    if (active) {
      const completedDuringGrace = await this.#settlesWithin(
        active.completion,
        this.#timing.shutdownGraceMs,
      );
      if (!completedDuringGrace) {
        active.executionController.abort(SHUTDOWN);
        active.stopMaintenance("shutdown");
        const settledAfterAbort = await this.#settlesWithin(
          active.completion,
          this.#timing.shutdownSettleMs,
        );
        if (!settledAfterAbort) {
          activeSettlementTimedOut = true;
          this.#logger.error(
            { event: "agent_worker_shutdown_timeout", runId: active.runId },
            "Agent worker execution did not settle before shutdown",
          );
          void active.completion.catch(() => undefined);
        }
      }
    }

    if (this.#loopPromise && !activeSettlementTimedOut) {
      const loopSettled = await this.#settlesWithin(
        this.#loopPromise,
        this.#timing.shutdownSettleMs,
      );
      if (!loopSettled) {
        this.#logger.error(
          { event: "agent_worker_loop_shutdown_timeout" },
          "Agent worker loop did not settle before shutdown",
        );
        void this.#loopPromise.catch(() => undefined);
      }
    }
    this.#state = "stopped";
    this.#logger.info({ event: "agent_worker_stopped" }, "Agent worker stopped");
  }

  async #runLoop(firstClaim: ClaimAgentRunResult): Promise<void> {
    let nextClaim: ClaimAgentRunResult | null = firstClaim;
    while (!this.#stopRequested) {
      try {
        const claim = nextClaim ?? (await this.#claimRun());
        nextClaim = null;
        if (this.#stopRequested) return;
        if (claim.status === "empty") {
          await this.#waitFor(this.#timing.idlePollMs, this.#lifecycleController.signal);
          continue;
        }
        await this.#processClaim(claim.claim);
      } catch (error: unknown) {
        if (this.#stopRequested) return;
        this.#logger.warn(
          { event: "agent_worker_poll_failed", errorType: errorType(error) },
          "Agent worker iteration failed",
        );
        await this.#waitFor(this.#timing.idlePollMs, this.#lifecycleController.signal);
      }
    }
  }

  #claimRun(): Promise<ClaimAgentRunResult> {
    return this.#repository.claimRun({
      leaseOwnerId: this.#leaseOwnerId,
      now: this.#now(),
      leaseDurationMs: this.#timing.leaseDurationMs,
    });
  }

  async #processClaim(claim: AgentRunClaim): Promise<void> {
    const run = claim.run;
    if (
      run.leaseOwnerId !== this.#leaseOwnerId ||
      !run.leaseExpiresAt ||
      !run.deadlineAt
    ) {
      this.#logger.error(
        {
          event: "agent_worker_invalid_claim",
          runId: run.id,
          leaseGeneration: run.leaseGeneration,
        },
        "Agent worker received an invalid claim",
      );
      return;
    }

    const fence: AgentWorkerFence = {
      runId: run.id,
      leaseOwnerId: this.#leaseOwnerId,
      leaseGeneration: run.leaseGeneration,
    };
    const executionController = new AbortController();
    const maintenanceController = new AbortController();
    let confirmedLeaseExpiresAt = run.leaseExpiresAt;
    let stopCause: StopCause | undefined;
    let heartbeatInFlight: Promise<HeartbeatOutcome> | null = null;
    let watchdogController: AbortController | null = null;

    const stopMaintenance = (cause?: StopCause) => {
      stopCause ??= cause;
      maintenanceController.abort(
        cause ? new AgentWorkerBoundaryError(cause) : WAIT_CANCELLED,
      );
      watchdogController?.abort(WAIT_CANCELLED);
    };

    const stopExecution = (cause: StopCause) => {
      stopCause ??= cause;
      executionController.abort(new AgentWorkerBoundaryError(cause));
      stopMaintenance(cause);
    };

    const resetWatchdog = () => {
      watchdogController?.abort(WAIT_CANCELLED);
      const controller = new AbortController();
      watchdogController = controller;
      const deadlineCapped =
        confirmedLeaseExpiresAt.getTime() === run.deadlineAt!.getTime();
      const cutoff =
        confirmedLeaseExpiresAt.getTime() -
        (deadlineCapped ? 0 : this.#timing.leaseSafetyMarginMs);
      const delayMs = Math.max(0, cutoff - this.#now().getTime());
      void this.#wait(delayMs, controller.signal)
        .then(() => {
          if (!controller.signal.aborted && !maintenanceController.signal.aborted) {
            this.#logger.warn(
              {
                event: "agent_worker_lease_renewal_uncertain",
                runId: fence.runId,
                leaseGeneration: fence.leaseGeneration,
              },
              "Agent worker could not confirm lease renewal",
            );
            stopExecution("lease_renewal_uncertain");
          }
        })
        .catch(() => undefined);
    };

    const heartbeat = (): Promise<HeartbeatOutcome> => {
      if (heartbeatInFlight) return heartbeatInFlight;
      if (maintenanceController.signal.aborted) return Promise.resolve("stop");
      heartbeatInFlight = this.#heartbeat(fence)
        .then((result): HeartbeatOutcome => {
          if (maintenanceController.signal.aborted) return "stop";
          if (result.status === "updated") {
            confirmedLeaseExpiresAt = result.leaseExpiresAt;
            resetWatchdog();
            return "updated";
          }
          if (result.status === "cancel_requested") {
            this.#logger.info(
              {
                event: "agent_worker_cancellation_observed",
                runId: fence.runId,
                leaseGeneration: fence.leaseGeneration,
              },
              "Agent worker observed durable cancellation",
            );
            stopExecution("cancel_requested");
            return "stop";
          }
          this.#logger.warn(
            {
              event: "agent_worker_lease_lost",
              runId: fence.runId,
              leaseGeneration: fence.leaseGeneration,
            },
            "Agent worker lost its lease",
          );
          stopExecution("lease_lost");
          return "stop";
        })
        .catch((error: unknown): HeartbeatOutcome => {
          if (maintenanceController.signal.aborted) return "stop";
          this.#logger.warn(
            {
              event: "agent_worker_heartbeat_failed",
              runId: fence.runId,
              leaseGeneration: fence.leaseGeneration,
              errorType: errorType(error),
            },
            "Agent worker heartbeat failed",
          );
          return "retry";
        })
        .finally(() => {
          heartbeatInFlight = null;
        });
      return heartbeatInFlight;
    };

    const awaitHeartbeat = (): Promise<HeartbeatOutcome> => {
      const request = heartbeat();
      if (maintenanceController.signal.aborted) return Promise.resolve("stop");
      return new Promise<HeartbeatOutcome>((resolve) => {
        let settled = false;
        const finish = (result: HeartbeatOutcome) => {
          if (settled) return;
          settled = true;
          maintenanceController.signal.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const onAbort = () => finish("stop");
        maintenanceController.signal.addEventListener("abort", onAbort, { once: true });
        void request.then(finish);
      });
    };

    const leaseCheckpoint: AgentExecutionLeaseCheckpoint = async () => {
      while (!maintenanceController.signal.aborted) {
        const result = await awaitHeartbeat();
        if (result === "updated") return "continue";
        if (result === "stop") return "stop";
        const waited = await this.#tryWait(
          this.#timing.heartbeatRetryMs,
          maintenanceController.signal,
        );
        if (!waited) return "stop";
      }
      return "stop";
    };

    const maintenancePromise = (async () => {
      let delayMs = this.#timing.heartbeatIntervalMs;
      while (!maintenanceController.signal.aborted) {
        const waited = await this.#tryWait(delayMs, maintenanceController.signal);
        if (!waited || maintenanceController.signal.aborted) return;
        const result = await awaitHeartbeat();
        if (result === "stop") return;
        delayMs =
          result === "retry"
            ? this.#timing.heartbeatRetryMs
            : this.#timing.heartbeatIntervalMs;
      }
    })();
    void maintenancePromise.catch(() => undefined);

    resetWatchdog();
    this.#logger.info(
      {
        event: "agent_worker_run_claimed",
        runId: fence.runId,
        leaseGeneration: fence.leaseGeneration,
      },
      "Agent worker claimed a run",
    );

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.#activeRun = {
      runId: fence.runId,
      executionController,
      stopMaintenance,
      completion,
    };

    let outcome: AgentRunExecutionOutcome | null = null;
    try {
      outcome = await this.#executor.execute({
        ...fence,
        signal: executionController.signal,
        leaseCheckpoint,
      });
    } catch (error: unknown) {
      this.#logger.error(
        {
          event: "agent_worker_executor_failed",
          runId: fence.runId,
          leaseGeneration: fence.leaseGeneration,
          errorType: errorType(error),
        },
        "Agent worker executor threw",
      );
    } finally {
      stopMaintenance();
      const maintenanceSettled = await this.#settlesWithin(
        maintenancePromise,
        this.#timing.shutdownSettleMs,
      );
      if (!maintenanceSettled) {
        this.#logger.error(
          {
            event: "agent_worker_maintenance_timeout",
            runId: fence.runId,
            leaseGeneration: fence.leaseGeneration,
          },
          "Agent worker lease maintenance did not settle",
        );
      }
      void maintenancePromise.catch(() => undefined);
      resolveCompletion();
      if (this.#activeRun?.runId === fence.runId) this.#activeRun = null;
    }

    if (outcome) {
      this.#logger.info(
        {
          event: "agent_worker_run_execution_finished",
          runId: fence.runId,
          leaseGeneration: fence.leaseGeneration,
          outcome: outcome.status,
          ...("errorCode" in outcome && outcome.errorCode
            ? { errorCode: outcome.errorCode }
            : {}),
          ...(stopCause ? { stopCause } : {}),
        },
        "Agent worker run execution finished",
      );
    }
  }

  #heartbeat(fence: AgentWorkerFence): Promise<HeartbeatAgentLeaseResult> {
    return this.#repository.heartbeatLease({
      ...fence,
      now: this.#now(),
      leaseDurationMs: this.#timing.leaseDurationMs,
    });
  }

  async #waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
    try {
      await this.#wait(milliseconds, signal);
    } catch (error: unknown) {
      if (!signal.aborted) throw error;
    }
  }

  async #tryWait(milliseconds: number, signal: AbortSignal): Promise<boolean> {
    try {
      await this.#wait(milliseconds, signal);
      return !signal.aborted;
    } catch (error: unknown) {
      if (signal.aborted) return false;
      throw error;
    }
  }

  async #settlesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = this.#wait(milliseconds, controller.signal)
      .then(() => {
        timedOut = true;
      })
      .catch(() => undefined);
    await Promise.race([promise.catch(() => undefined), timeout]);
    controller.abort(WAIT_CANCELLED);
    return !timedOut;
  }
}

export function createAgentWorker(dependencies: AgentWorkerDependencies): AgentWorker {
  return new DefaultAgentWorker(dependencies);
}
