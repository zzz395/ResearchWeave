import { ArxivIntegrationError } from "./errors";

interface ScheduledJob<T> {
  task: () => Promise<T>;
  notBefore: number;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface ArxivSchedulerOptions {
  minimumSpacingMs?: number;
  maxPending?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class ArxivScheduler {
  private readonly queue: ScheduledJob<unknown>[] = [];
  private readonly minimumSpacingMs: number;
  private readonly maxPending: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private active = false;
  private lastStartedAt: number | undefined;

  constructor({
    minimumSpacingMs = 3000,
    maxPending = 50,
    now = Date.now,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: ArxivSchedulerOptions = {}) {
    if (minimumSpacingMs < 0 || !Number.isInteger(maxPending) || maxPending < 1) {
      throw new TypeError("Scheduler bounds are invalid.");
    }
    this.minimumSpacingMs = minimumSpacingMs;
    this.maxPending = maxPending;
    this.now = now;
    this.sleep = sleep;
  }

  schedule<T>(task: () => Promise<T>, options: { notBefore?: number } = {}) {
    if (this.active && this.queue.length >= this.maxPending) {
      return Promise.reject(
        new ArxivIntegrationError("ARXIV_QUEUE_FULL", "The arXiv request queue is full."),
      );
    }

    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        notBefore: options.notBefore ?? 0,
        resolve,
        reject,
      } as ScheduledJob<unknown>);
    });
    void this.drain();
    return promise;
  }

  private async drain() {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = true;

    try {
      const spacingStart =
        this.lastStartedAt === undefined ? 0 : this.lastStartedAt + this.minimumSpacingMs;
      const earliestStart = Math.max(spacingStart, job.notBefore);
      const delay = Math.max(0, earliestStart - this.now());
      if (delay > 0) await this.sleep(delay);
      this.lastStartedAt = this.now();
      job.resolve(await job.task());
    } catch (error: unknown) {
      job.reject(error);
    } finally {
      this.active = false;
      void this.drain();
    }
  }
}

// A multi-instance deployment would need cross-process coordination for arXiv's global limits.
export const globalArxivScheduler = new ArxivScheduler();
