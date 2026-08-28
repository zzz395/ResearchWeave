import { describe, expect, it } from "vitest";

import { ArxivScheduler } from "../../server/integrations/arxiv/scheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("process-wide arXiv scheduler", () => {
  it("starts attempts in FIFO order with at least 3000ms between starts", async () => {
    let clock = 10_000;
    const sleeps: number[] = [];
    const starts: Array<{ id: number; at: number }> = [];
    const scheduler = new ArxivScheduler({
      now: () => clock,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        clock += milliseconds;
        return Promise.resolve();
      },
    });

    await Promise.all(
      [1, 2, 3].map((id) =>
        scheduler.schedule(() => {
          starts.push({ id, at: clock });
          return Promise.resolve(id);
        }),
      ),
    );

    expect(starts).toEqual([
      { id: 1, at: 10_000 },
      { id: 2, at: 13_000 },
      { id: 3, at: 16_000 },
    ]);
    expect(sleeps).toEqual([3000, 3000]);
  });

  it("allows only one active attempt", async () => {
    let clock = 0;
    let active = 0;
    let maximumActive = 0;
    const firstRelease = deferred<void>();
    const scheduler = new ArxivScheduler({
      now: () => clock,
      sleep: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    });
    const run = (release?: Promise<void>) =>
      scheduler.schedule(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (release) await release;
        active -= 1;
      });

    const first = run(firstRelease.promise);
    const second = run();
    await Promise.resolve();
    expect(active).toBe(1);
    firstRelease.resolve();
    await Promise.all([first, second]);
    expect(maximumActive).toBe(1);
  });

  it("rejects work beyond the bounded pending queue", async () => {
    const release = deferred<void>();
    const scheduler = new ArxivScheduler({
      maxPending: 2,
      minimumSpacingMs: 0,
    });
    const active = scheduler.schedule(() => release.promise);
    const pendingOne = scheduler.schedule(() => Promise.resolve(undefined));
    const pendingTwo = scheduler.schedule(() => Promise.resolve(undefined));
    const rejected = scheduler.schedule(() => Promise.resolve(undefined));

    await expect(rejected).rejects.toMatchObject({
      code: "ARXIV_QUEUE_FULL",
    });
    release.resolve();
    await Promise.all([active, pendingOne, pendingTwo]);
  });
});
