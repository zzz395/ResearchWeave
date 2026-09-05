import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentRunRecord,
  AgentTaskRecord,
} from "../../server/db/schema";
import type {
  AgentRepository,
  ClaimAgentRunInput,
  ClaimAgentRunResult,
} from "../../server/modules/agents/repository";
import type {
  AgentRunExecutionInput,
  AgentRunExecutionOutcome,
  AgentRunExecutor,
} from "../../server/modules/agents/run-executor";
import {
  createAgentWorker,
  type AgentWorkerTiming,
} from "../../server/modules/agents/worker";

const START = new Date("2026-09-05T00:00:00.000Z");
const OWNER_ID = "90000000-0000-4000-8000-000000000001";
const TASK_ID = "40000000-0000-4000-8000-000000000001";
const RUN_ID = "50000000-0000-4000-8000-000000000001";
const TIMING: AgentWorkerTiming = {
  idlePollMs: 10,
  leaseDurationMs: 100,
  heartbeatIntervalMs: 20,
  heartbeatRetryMs: 5,
  leaseSafetyMarginMs: 20,
  shutdownGraceMs: 30,
  shutdownSettleMs: 10,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function task(): AgentTaskRecord {
  return {
    id: TASK_ID,
    spaceId: "20000000-0000-4000-8000-000000000001",
    agentId: "30000000-0000-4000-8000-000000000001",
    createdByUserId: "10000000-0000-4000-8000-000000000001",
    prompt: "Worker test task",
    clientRequestId: "80000000-0000-4000-8000-000000000001",
    requestFingerprint: "a".repeat(64),
    createdAt: START,
  };
}

function claimedRun(input: ClaimAgentRunInput, overrides: Partial<AgentRunRecord> = {}) {
  const startedAt = input.now;
  const deadlineAt = new Date(startedAt.getTime() + 1_000);
  const run: AgentRunRecord = {
    id: RUN_ID,
    taskId: TASK_ID,
    spaceId: task().spaceId,
    actorUserId: task().createdByUserId,
    attemptNumber: 1,
    status: "running",
    definitionRevision: 1,
    toolNames: ["search_arxiv"],
    maxSteps: 8,
    maxToolCalls: 6,
    wallTimeSeconds: 180,
    providerDecisionTimeoutSeconds: 30,
    toolTimeoutSeconds: 45,
    providerAttempts: 2,
    providerResponseMaxBytes: 65_536,
    observationMaxBytes: 32_768,
    contextMaxBytes: 131_072,
    finalAnswerMaxCharacters: 8_000,
    maxEvidence: 32,
    promptVersion: "research-agent-v1",
    providerModel: "test-model",
    stepCount: 0,
    toolCallCount: 0,
    contextBytes: 0,
    leaseOwnerId: input.leaseOwnerId,
    leaseGeneration: 1,
    leaseExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
    cancelRequestedAt: null,
    cancelRequestedByUserId: null,
    startedAt,
    deadlineAt,
    finishedAt: null,
    errorCode: null,
    finalStatus: null,
    finalAnswer: null,
    retryClientRequestId: null,
    retryRequestFingerprint: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides,
  };
  return { task: task(), run, incompleteToolStep: null };
}

function logger() {
  return pino({ level: "silent" });
}

function repository(input: {
  claimRun?: AgentRepository["claimRun"];
  heartbeatLease?: AgentRepository["heartbeatLease"];
} = {}) {
  const claimRun = vi.fn<AgentRepository["claimRun"]>(
    input.claimRun ?? (() => Promise.resolve({ status: "empty" })),
  );
  const heartbeatLease = vi.fn<AgentRepository["heartbeatLease"]>(
    input.heartbeatLease ??
      ((heartbeat) =>
        Promise.resolve({
          status: "updated",
          leaseExpiresAt: new Date(heartbeat.now.getTime() + heartbeat.leaseDurationMs),
        })),
  );
  return { claimRun, heartbeatLease };
}

function executor(
  execute: AgentRunExecutor["execute"] = (input) =>
    Promise.resolve({ status: "completed", runId: input.runId }),
) {
  return { execute: vi.fn<AgentRunExecutor["execute"]>(execute) };
}

async function flushMicrotasks(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentWorker", () => {
  it("uses one stable owner, polls without busy looping, and starts idempotently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const testRepository = repository();
    const testExecutor = executor();
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await Promise.all([worker.start(), worker.start()]);
    expect(testRepository.claimRun).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(TIMING.idlePollMs);
    expect(testRepository.claimRun).toHaveBeenCalledTimes(2);
    expect(
      testRepository.claimRun.mock.calls.map(([input]) => input.leaseOwnerId),
    ).toEqual([OWNER_ID, OWNER_ID]);
    expect(testExecutor.execute).not.toHaveBeenCalled();

    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one execution in flight and passes the exact claim fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const execution = deferred<AgentRunExecutionOutcome>();
    let claimCount = 0;
    const testRepository = repository({
      claimRun: (input): Promise<ClaimAgentRunResult> => {
        claimCount += 1;
        return Promise.resolve(
          claimCount === 1
            ? { status: "claimed", claim: claimedRun(input) }
            : { status: "empty" },
        );
      },
    });
    const testExecutor = executor(() => execution.promise);
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    expect(testExecutor.execute).toHaveBeenCalledOnce();
    const executionInput = testExecutor.execute.mock.calls[0]?.[0];
    expect(executionInput).toMatchObject({
      runId: RUN_ID,
      leaseOwnerId: OWNER_ID,
      leaseGeneration: 1,
    });
    expect(executionInput?.signal).toBeInstanceOf(AbortSignal);
    expect(executionInput?.leaseCheckpoint).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(TIMING.idlePollMs * 3);
    expect(testRepository.claimRun).toHaveBeenCalledOnce();
    expect(testExecutor.execute).toHaveBeenCalledOnce();

    execution.resolve({ status: "completed", runId: RUN_ID });
    await flushMicrotasks();
    await worker.stop();
  });

  it("serializes persisted-boundary heartbeats and renews with the current fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const heartbeat = deferred<{
      status: "updated";
      leaseExpiresAt: Date;
    }>();
    let claimed = false;
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
      },
      heartbeatLease: () => heartbeat.promise,
    });
    const testExecutor = executor(async (input) => {
      const [first, second] = await Promise.all([
        input.leaseCheckpoint!(),
        input.leaseCheckpoint!(),
      ]);
      expect([first, second]).toEqual(["continue", "continue"]);
      return { status: "completed", runId: input.runId };
    });
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    await flushMicrotasks();
    expect(testRepository.heartbeatLease).toHaveBeenCalledOnce();
    expect(testRepository.heartbeatLease).toHaveBeenCalledWith({
      runId: RUN_ID,
      leaseOwnerId: OWNER_ID,
      leaseGeneration: 1,
      now: START,
      leaseDurationMs: TIMING.leaseDurationMs,
    });
    heartbeat.resolve({
      status: "updated",
      leaseExpiresAt: new Date(START.getTime() + TIMING.leaseDurationMs),
    });
    await flushMicrotasks();
    await worker.stop();
  });

  it("shares an unresolved periodic heartbeat with a boundary and invalidates the old watchdog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const mixedTiming: AgentWorkerTiming = {
      ...TIMING,
      heartbeatIntervalMs: 70,
    };
    const periodicHeartbeat = deferred<{
      status: "updated";
      leaseExpiresAt: Date;
    }>();
    const laterHeartbeat = deferred<never>();
    const triggerBoundary = deferred<void>();
    const boundaryResult = deferred<"continue" | "stop">();
    let claimed = false;
    let heartbeatCount = 0;
    let executionSignal: AbortSignal | undefined;
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
      },
      heartbeatLease: () => {
        heartbeatCount += 1;
        return heartbeatCount === 1
          ? periodicHeartbeat.promise
          : laterHeartbeat.promise;
      },
    });
    const testExecutor = executor(async (input) => {
      executionSignal = input.signal;
      await triggerBoundary.promise;
      boundaryResult.resolve(await input.leaseCheckpoint!());
      return new Promise<AgentRunExecutionOutcome>((resolve) => {
        input.signal.addEventListener(
          "abort",
          () => resolve({ status: "interrupted", runId: input.runId }),
          { once: true },
        );
      });
    });
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: mixedTiming,
      createId: () => OWNER_ID,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(mixedTiming.heartbeatIntervalMs);
    expect(testRepository.heartbeatLease).toHaveBeenCalledOnce();

    triggerBoundary.resolve();
    await flushMicrotasks();
    expect(testRepository.heartbeatLease).toHaveBeenCalledOnce();

    periodicHeartbeat.resolve({
      status: "updated",
      leaseExpiresAt: new Date(
        START.getTime() + mixedTiming.heartbeatIntervalMs + mixedTiming.leaseDurationMs,
      ),
    });
    await expect(boundaryResult.promise).resolves.toBe("continue");

    await vi.advanceTimersByTimeAsync(
      mixedTiming.leaseDurationMs -
        mixedTiming.leaseSafetyMarginMs -
        mixedTiming.heartbeatIntervalMs,
    );
    expect(Date.now()).toBe(
      START.getTime() + mixedTiming.leaseDurationMs - mixedTiming.leaseSafetyMarginMs,
    );
    expect(executionSignal?.aborted).toBe(false);
    expect(testRepository.heartbeatLease).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(
      mixedTiming.heartbeatIntervalMs * 2 -
        (mixedTiming.leaseDurationMs - mixedTiming.leaseSafetyMarginMs),
    );
    expect(testRepository.heartbeatLease).toHaveBeenCalledTimes(2);
    expect(executionSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(
      mixedTiming.leaseDurationMs -
        mixedTiming.leaseSafetyMarginMs -
        mixedTiming.heartbeatIntervalMs,
    );
    expect(Date.now()).toBe(
      START.getTime() +
        mixedTiming.heartbeatIntervalMs +
        mixedTiming.leaseDurationMs -
        mixedTiming.leaseSafetyMarginMs,
    );
    expect(executionSignal?.aborted).toBe(true);
    await flushMicrotasks();
    await worker.stop();
    expect(testRepository.heartbeatLease).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["cancel_requested", "stale"] as const)(
    "aborts unresolved execution when heartbeat reports %s",
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
      let claimed = false;
      let observedSignal: AbortSignal | undefined;
      const testRepository = repository({
        claimRun: (input) => {
          if (claimed) return Promise.resolve({ status: "empty" });
          claimed = true;
          return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
        },
        heartbeatLease: () => Promise.resolve({ status }),
      });
      const testExecutor = executor(
        (input) =>
          new Promise<AgentRunExecutionOutcome>((resolve) => {
            observedSignal = input.signal;
            input.signal.addEventListener(
              "abort",
              () => resolve({ status: "interrupted", runId: input.runId }),
              { once: true },
            );
          }),
      );
      const worker = createAgentWorker({
        repository: testRepository,
        executor: testExecutor,
        logger: logger(),
        timing: TIMING,
        createId: () => OWNER_ID,
      });

      await worker.start();
      expect(observedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(TIMING.heartbeatIntervalMs);
      expect(observedSignal?.aborted).toBe(true);
      expect(testRepository.heartbeatLease).toHaveBeenCalledOnce();
      await flushMicrotasks();
      await worker.stop();
    },
  );

  it("retries transient heartbeat failures until the lease safety watchdog aborts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let claimed = false;
    let observedInput: AgentRunExecutionInput | undefined;
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
      },
      heartbeatLease: () => Promise.reject(new Error("temporary database outage")),
    });
    const testExecutor = executor(
      (input) =>
        new Promise<AgentRunExecutionOutcome>((resolve) => {
          observedInput = input;
          input.signal.addEventListener(
            "abort",
            () => resolve({ status: "interrupted", runId: input.runId }),
            { once: true },
          );
        }),
    );
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(TIMING.heartbeatIntervalMs);
    expect(testRepository.heartbeatLease).toHaveBeenCalledOnce();
    expect(observedInput?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(TIMING.heartbeatRetryMs * 2);
    expect(testRepository.heartbeatLease.mock.calls.length).toBeGreaterThan(1);
    expect(observedInput?.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(
      TIMING.leaseDurationMs -
        TIMING.leaseSafetyMarginMs -
        TIMING.heartbeatIntervalMs -
        TIMING.heartbeatRetryMs * 2,
    );
    expect(observedInput?.signal.aborted).toBe(true);
    await flushMicrotasks();
    await worker.stop();
  });

  it("retries a persisted-boundary heartbeat before allowing execution to continue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let claimed = false;
    let heartbeatCount = 0;
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
      },
      heartbeatLease: (input) => {
        heartbeatCount += 1;
        if (heartbeatCount === 1) return Promise.reject(new Error("temporary database outage"));
        return Promise.resolve({
          status: "updated",
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
        });
      },
    });
    const checkpointResult = deferred<"continue" | "stop">();
    const testExecutor = executor(async (input) => {
      checkpointResult.resolve(await input.leaseCheckpoint!());
      return { status: "completed", runId: input.runId };
    });
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    await flushMicrotasks();
    expect(testRepository.heartbeatLease).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(TIMING.heartbeatRetryMs);
    await expect(checkpointResult.promise).resolves.toBe("continue");
    expect(testRepository.heartbeatLease).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it("lets the lease watchdog stop a boundary blocked on a hung heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let claimed = false;
    let executionSignal: AbortSignal | undefined;
    const neverHeartbeat = deferred<never>();
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
      },
      heartbeatLease: () => neverHeartbeat.promise,
    });
    const testExecutor = executor(async (input) => {
      executionSignal = input.signal;
      expect(await input.leaseCheckpoint!()).toBe("stop");
      return { status: "interrupted", runId: input.runId };
    });
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(
      TIMING.leaseDurationMs - TIMING.leaseSafetyMarginMs,
    );
    expect(executionSignal?.aborted).toBe(true);
    await flushMicrotasks();
    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the immutable deadline itself for a deadline-capped lease watchdog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let claimed = false;
    let executionSignal: AbortSignal | undefined;
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        const deadline = new Date(input.now.getTime() + input.leaseDurationMs);
        return Promise.resolve({
          status: "claimed",
          claim: claimedRun(input, { leaseExpiresAt: deadline, deadlineAt: deadline }),
        });
      },
      heartbeatLease: () => new Promise(() => undefined),
    });
    const testExecutor = executor(
      (input) =>
        new Promise<AgentRunExecutionOutcome>((resolve) => {
          executionSignal = input.signal;
          input.signal.addEventListener(
            "abort",
            () => resolve({ status: "interrupted", runId: input.runId }),
            { once: true },
          );
        }),
    );
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(
      TIMING.leaseDurationMs - TIMING.leaseSafetyMarginMs,
    );
    expect(executionSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(TIMING.leaseSafetyMarginMs);
    expect(executionSignal?.aborted).toBe(true);
    await flushMicrotasks();
    await worker.stop();
  });

  it("gives an in-flight run a grace period before local shutdown interruption", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let claimed = false;
    let observedSignal: AbortSignal | undefined;
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
      },
    });
    const testExecutor = executor(
      (input) =>
        new Promise<AgentRunExecutionOutcome>((resolve) => {
          observedSignal = input.signal;
          input.signal.addEventListener(
            "abort",
            () => resolve({ status: "interrupted", runId: input.runId }),
            { once: true },
          );
        }),
    );
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(TIMING.shutdownGraceMs - 1);
    expect(observedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(observedSignal?.aborted).toBe(true);
    await stopping;
    expect(testRepository.claimRun).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves natural completion immediately before the shutdown grace boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const execution = deferred<AgentRunExecutionOutcome>();
    let claimed = false;
    let executionSignal: AbortSignal | undefined;
    const testRepository = repository({
      claimRun: (input) => {
        if (claimed) return Promise.resolve({ status: "empty" });
        claimed = true;
        return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
      },
    });
    const testExecutor = executor((input) => {
      executionSignal = input.signal;
      return execution.promise;
    });
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(TIMING.shutdownGraceMs - 1);
    expect(executionSignal?.aborted).toBe(false);
    execution.resolve({ status: "completed", runId: RUN_ID });
    await flushMicrotasks();
    await stopping;

    expect(executionSignal?.aborted).toBe(false);
    expect(testExecutor.execute).toHaveBeenCalledOnce();
    expect(testRepository.claimRun).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)(
    "bounds shutdown when an abort-ignoring Executor later %ss",
    async (lateSettlement) => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
      const execution = deferred<AgentRunExecutionOutcome>();
      const onUnhandledRejection = vi.fn();
      process.on("unhandledRejection", onUnhandledRejection);
      let claimed = false;
      let executionSignal: AbortSignal | undefined;
      const testRepository = repository({
        claimRun: (input) => {
          if (claimed) return Promise.resolve({ status: "empty" });
          claimed = true;
          return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
        },
      });
      const testExecutor = executor((input) => {
        executionSignal = input.signal;
        return execution.promise;
      });
      const worker = createAgentWorker({
        repository: testRepository,
        executor: testExecutor,
        logger: logger(),
        timing: TIMING,
        createId: () => OWNER_ID,
      });

      try {
        await worker.start();
        const stopping = worker.stop();
        let stopped = false;
        void stopping.then(() => {
          stopped = true;
        });

        await vi.advanceTimersByTimeAsync(TIMING.shutdownGraceMs);
        expect(executionSignal?.aborted).toBe(true);
        const heartbeatCallsAfterAbort = testRepository.heartbeatLease.mock.calls.length;
        expect(stopped).toBe(false);

        await vi.advanceTimersByTimeAsync(TIMING.shutdownSettleMs);
        await stopping;
        expect(stopped).toBe(true);
        expect(testRepository.claimRun).toHaveBeenCalledOnce();
        expect(testExecutor.execute).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);

        if (lateSettlement === "reject") {
          execution.reject(new Error("late Executor rejection"));
        } else {
          execution.resolve({ status: "interrupted", runId: RUN_ID });
        }
        await flushMicrotasks(20);

        expect(onUnhandledRejection).not.toHaveBeenCalled();
        expect(testRepository.claimRun).toHaveBeenCalledOnce();
        expect(testRepository.heartbeatLease).toHaveBeenCalledTimes(
          heartbeatCallsAfterAbort,
        );
        expect(testExecutor.execute).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
      }
    },
  );

  it("does not execute a claim that arrives after shutdown begins", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const pendingClaim = deferred<ClaimAgentRunResult>();
    let claimInput: ClaimAgentRunInput | undefined;
    const testRepository = repository({
      claimRun: (input) => {
        claimInput = input;
        return pendingClaim.promise;
      },
    });
    const testExecutor = executor();
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    const starting = worker.start();
    const stopping = worker.stop();
    pendingClaim.resolve({ status: "claimed", claim: claimedRun(claimInput!) });
    await starting;
    await stopping;

    expect(testExecutor.execute).not.toHaveBeenCalled();
    expect(testRepository.heartbeatLease).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds shutdown when the initial claim probe never settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const pendingClaim = deferred<ClaimAgentRunResult>();
    const worker = createAgentWorker({
      repository: repository({ claimRun: () => pendingClaim.promise }),
      executor: executor(),
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    const starting = worker.start();
    const stopping = worker.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(TIMING.shutdownSettleMs - 1);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(stopped).toBe(true);

    pendingClaim.resolve({ status: "empty" });
    await starting;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("backs off after a loop poll error and then processes the next claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const secondRunId = "50000000-0000-4000-8000-000000000002";
    let claimCount = 0;
    const testRepository = repository({
      claimRun: (input) => {
        claimCount += 1;
        if (claimCount === 1 || claimCount >= 4) {
          return Promise.resolve({ status: "empty" });
        }
        if (claimCount === 2) return Promise.reject(new Error("temporary poll failure"));
        return Promise.resolve({
          status: "claimed",
          claim: claimedRun(input, { id: secondRunId }),
        });
      },
    });
    const testExecutor = executor();
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    expect(testRepository.claimRun).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(TIMING.idlePollMs);
    expect(testRepository.claimRun).toHaveBeenCalledTimes(2);
    expect(testExecutor.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TIMING.idlePollMs - 1);
    expect(testRepository.claimRun).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(testRepository.claimRun.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(testExecutor.execute).toHaveBeenCalledOnce();
    expect(testExecutor.execute.mock.calls[0]?.[0].runId).toBe(secondRunId);

    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains an Executor throw and continues with the next claimed Run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const secondRunId = "50000000-0000-4000-8000-000000000002";
    let claimCount = 0;
    const testRepository = repository({
      claimRun: (input) => {
        claimCount += 1;
        if (claimCount === 1) {
          return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
        }
        if (claimCount === 2) {
          return Promise.resolve({
            status: "claimed",
            claim: claimedRun(input, { id: secondRunId }),
          });
        }
        return Promise.resolve({ status: "empty" });
      },
    });
    const testExecutor = executor((input) =>
      input.runId === RUN_ID
        ? Promise.reject(new Error("Executor programmer failure"))
        : Promise.resolve({ status: "completed", runId: input.runId }),
    );
    const worker = createAgentWorker({
      repository: testRepository,
      executor: testExecutor,
      logger: logger(),
      timing: TIMING,
      createId: () => OWNER_ID,
    });

    await worker.start();
    await flushMicrotasks(20);
    expect(testExecutor.execute).toHaveBeenCalledTimes(2);
    expect(testExecutor.execute.mock.calls.map(([input]) => input.runId)).toEqual([
      RUN_ID,
      secondRunId,
    ]);
    expect(testRepository.claimRun).toHaveBeenCalledTimes(3);
    expect(testRepository.heartbeatLease).not.toHaveBeenCalled();

    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains every executor outcome without repository terminalization", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const outcomes: AgentRunExecutionOutcome[] = [
      { status: "completed", runId: RUN_ID },
      { status: "failed", runId: RUN_ID, errorCode: "agent_provider_unavailable" },
      { status: "cancelled", runId: RUN_ID },
      { status: "stale", runId: RUN_ID },
      { status: "interrupted", runId: RUN_ID, errorCode: "agent_persistence_failed" },
    ];

    for (const outcome of outcomes) {
      let claimed = false;
      const testRepository = repository({
        claimRun: (input) => {
          if (claimed) return Promise.resolve({ status: "empty" });
          claimed = true;
          return Promise.resolve({ status: "claimed", claim: claimedRun(input) });
        },
      });
      const worker = createAgentWorker({
        repository: testRepository,
        executor: executor(() => Promise.resolve(outcome)),
        logger: logger(),
        timing: TIMING,
        createId: () => OWNER_ID,
      });

      await worker.start();
      await flushMicrotasks();
      await worker.stop();
      expect(testRepository.heartbeatLease).not.toHaveBeenCalled();
    }
  });

  it("rejects unsafe timing configurations", () => {
    const testRepository = repository();
    const testExecutor = executor();

    expect(() =>
      createAgentWorker({
        repository: testRepository,
        executor: testExecutor,
        logger: logger(),
        timing: { ...TIMING, heartbeatIntervalMs: TIMING.leaseDurationMs },
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAgentWorker({
        repository: testRepository,
        executor: testExecutor,
        logger: logger(),
        timing: { ...TIMING, leaseSafetyMarginMs: TIMING.leaseDurationMs },
      }),
    ).toThrow(TypeError);
  });
});
