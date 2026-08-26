import type {
  ResearchPaperSearchResult,
  ResearchSearchQuery,
} from "../../../shared/contracts/research";
import { BoundedCache } from "./cache";
import { ArxivIntegrationError, isArxivIntegrationError } from "./errors";
import { parseArxivAtom } from "./parser";
import {
  buildArxivSearchUrl,
  createArxivCacheKey,
  parseResearchSearchQuery,
} from "./query";
import { globalArxivScheduler, type ArxivScheduler } from "./scheduler";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

interface ArxivClientOptions {
  fetchFn?: typeof fetch;
  scheduler?: Pick<ArxivScheduler, "schedule">;
  cache?: BoundedCache<ResearchPaperSearchResult>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxAttempts?: 1 | 2;
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

async function discardBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already being discarded; cancellation failure is not useful to callers.
  }
}

function parseRetryAfter(value: string | null, now: () => number) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) return Number(trimmed) * 1000;
  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - now());
}

export class ArxivClient {
  private readonly fetchFn: typeof fetch;
  private readonly scheduler: Pick<ArxivScheduler, "schedule">;
  private readonly cache: BoundedCache<ResearchPaperSearchResult>;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxAttempts: 1 | 2;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<ArxivClientOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<ArxivClientOptions["clearTimer"]>;
  private readonly inFlight = new Map<string, Promise<ResearchPaperSearchResult>>();

  constructor({
    fetchFn = fetch,
    scheduler = globalArxivScheduler,
    cache = new BoundedCache<ResearchPaperSearchResult>(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxAttempts = 2,
    now = Date.now,
    setTimer = (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer = (timer) => clearTimeout(timer),
  }: ArxivClientOptions = {}) {
    if (timeoutMs <= 0 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
      throw new TypeError("arXiv client limits must be positive.");
    }
    this.fetchFn = fetchFn;
    this.scheduler = scheduler;
    this.cache = cache;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.maxAttempts = maxAttempts;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  search(input: unknown) {
    const query = parseResearchSearchQuery(input);
    const cacheKey = createArxivCacheKey(query);
    const cached = this.cache.get(cacheKey);
    if (cached) return Promise.resolve(cached);

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const request = this.searchUncached(query)
      .then((result) => {
        this.cache.set(cacheKey, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async searchUncached(query: ResearchSearchQuery) {
    const url = buildArxivSearchUrl(query);
    let notBefore = 0;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.scheduler.schedule(() => this.fetchAndParse(url), { notBefore });
      } catch (error: unknown) {
        if (
          attempt >= this.maxAttempts ||
          !isArxivIntegrationError(error) ||
          !error.retryable
        ) {
          throw error;
        }
        notBefore = this.now() + (error.retryAfterMs ?? 0);
      }
    }

    throw new ArxivIntegrationError("ARXIV_UPSTREAM_ERROR", "The arXiv request failed.");
  }

  private async fetchAndParse(url: URL) {
    const controller = new AbortController();
    const timer = this.setTimer(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: {
          Accept: "application/atom+xml",
          "User-Agent": "ResearchWeave/0.1 (academic metadata integration)",
        },
        redirect: "error",
        signal: controller.signal,
      });

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.now);
        await discardBody(response);
        throw new ArxivIntegrationError(
          "ARXIV_RATE_LIMITED",
          "arXiv rate limited the metadata request.",
          { retryable: true, retryAfterMs },
        );
      }

      if (!response.ok) {
        const retryable = TRANSIENT_HTTP_STATUSES.has(response.status);
        await discardBody(response);
        throw new ArxivIntegrationError(
          "ARXIV_UPSTREAM_ERROR",
          "arXiv returned an unsuccessful response.",
          { retryable },
        );
      }

      const body = await this.readBoundedBody(response);
      return parseArxivAtom(body);
    } catch (error: unknown) {
      if (isArxivIntegrationError(error)) throw error;
      if (controller.signal.aborted) {
        throw new ArxivIntegrationError("ARXIV_TIMEOUT", "The arXiv request timed out.", {
          retryable: true,
          cause: error,
        });
      }
      throw new ArxivIntegrationError(
        "ARXIV_UPSTREAM_ERROR",
        "The arXiv metadata request failed.",
        { retryable: true, cause: error },
      );
    } finally {
      this.clearTimer(timer);
    }
  }

  private async readBoundedBody(response: Response) {
    const contentLength = response.headers.get("content-length");
    if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > this.maxResponseBytes) {
      await discardBody(response);
      throw new ArxivIntegrationError(
        "ARXIV_RESPONSE_TOO_LARGE",
        "The arXiv response exceeded the allowed size.",
      );
    }
    if (!response.body) {
      throw new ArxivIntegrationError(
        "ARXIV_INVALID_RESPONSE",
        "arXiv returned an empty response body.",
      );
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const readResult = (await reader.read()) as { done: boolean; value?: Uint8Array };
      if (readResult.done) break;
      const value = readResult.value;
      if (!value) {
        throw new ArxivIntegrationError(
          "ARXIV_INVALID_RESPONSE",
          "arXiv returned an invalid response stream.",
        );
      }
      totalBytes += value.byteLength;
      if (totalBytes > this.maxResponseBytes) {
        await reader.cancel();
        throw new ArxivIntegrationError(
          "ARXIV_RESPONSE_TOO_LARGE",
          "The arXiv response exceeded the allowed size.",
        );
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error: unknown) {
      throw new ArxivIntegrationError(
        "ARXIV_INVALID_RESPONSE",
        "arXiv returned invalid UTF-8 metadata.",
        { cause: error },
      );
    }
  }
}
