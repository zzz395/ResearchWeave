import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { BoundedCache } from "../../server/integrations/arxiv/cache";
import { ArxivClient } from "../../server/integrations/arxiv/client";
import { ArxivIntegrationError } from "../../server/integrations/arxiv/errors";
import { ArxivScheduler } from "../../server/integrations/arxiv/scheduler";
import type { ResearchPaperSearchResult } from "../../shared/contracts/research";

let successXml: string;
let emptyXml: string;

beforeAll(async () => {
  successXml = await readFile(
    new URL("../fixtures/arxiv/search-success.xml", import.meta.url),
    "utf8",
  );
  emptyXml = await readFile(
    new URL("../fixtures/arxiv/search-empty.xml", import.meta.url),
    "utf8",
  );
});

function immediateScheduler() {
  return new ArxivScheduler({ minimumSpacingMs: 0, sleep: () => Promise.resolve() });
}

type FetchImplementation = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function fetchMock(implementation: FetchImplementation) {
  return vi.fn<FetchImplementation>(implementation);
}

describe("arXiv client request safety", () => {
  it("returns normalized real and empty responses through the fixed endpoint", async () => {
    const fetchFn = fetchMock((input, init) => {
      if (!(input instanceof URL)) expect.fail("Expected the fixed arXiv URL");
      expect(input.href).toMatch(/^https:\/\/export\.arxiv\.org\/api\/query\?/u);
      expect(init?.method).toBe("GET");
      return Promise.resolve(new Response(successXml, { status: 200 }));
    });
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler() });
    const result = await client.search({ q: "learning" });
    expect(result.papers).toHaveLength(2);

    const emptyClient = new ArxivClient({
      fetchFn: fetchMock(() => Promise.resolve(new Response(emptyXml, { status: 200 }))),
      scheduler: immediateScheduler(),
    });
    await expect(emptyClient.search({ q: "nothing" })).resolves.toMatchObject({ papers: [] });
  });

  it("times out each attempt and performs at most one retry", async () => {
    const fetchFn = fetchMock((_input, init) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      return new Promise<Response>(() => undefined);
    });
    const client = new ArxivClient({
      fetchFn,
      scheduler: immediateScheduler(),
      setTimer: (callback) => {
        callback();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });

    await expect(client.search({ q: "timeout" })).rejects.toMatchObject({ code: "ARXIV_TIMEOUT" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries one transient network failure and then succeeds", async () => {
    const fetchFn = fetchMock(() => {
      if (fetchFn.mock.calls.length === 1) return Promise.reject(new TypeError("network unavailable"));
      return Promise.resolve(new Response(successXml, { status: 200 }));
    });
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler() });
    await expect(client.search({ q: "network" })).resolves.toMatchObject({ totalResults: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([429, 502, 503, 504])("retries transient HTTP %s only once", async (status) => {
    const fetchFn = fetchMock(() =>
      Promise.resolve(new Response("upstream unavailable", {
        status,
        headers: status === 429 ? { "Retry-After": "4" } : undefined,
      })),
    );
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler() });
    const expectedCode = status === 429 ? "ARXIV_RATE_LIMITED" : "ARXIV_UPSTREAM_ERROR";
    await expect(client.search({ q: `status ${status}` })).rejects.toMatchObject({
      code: expectedCode,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent HTTP failures", async () => {
    const fetchFn = fetchMock(() => Promise.resolve(new Response("bad request", { status: 400 })));
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler() });
    await expect(client.search({ q: "bad request" })).rejects.toMatchObject({
      code: "ARXIV_UPSTREAM_ERROR",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const fetchFn = fetchMock(() =>
      Promise.resolve(new Response("small body", { status: 200, headers: { "Content-Length": "100" } })),
    );
    const client = new ArxivClient({
      fetchFn,
      scheduler: immediateScheduler(),
      maxResponseBytes: 10,
    });
    await expect(client.search({ q: "large header" })).rejects.toMatchObject({
      code: "ARXIV_RESPONSE_TOO_LARGE",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("counts streamed bytes when Content-Length is absent", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("6"));
        controller.close();
      },
    });
    const client = new ArxivClient({
      fetchFn: fetchMock(() => Promise.resolve(new Response(body, { status: 200 }))),
      scheduler: immediateScheduler(),
      maxResponseBytes: 5,
    });
    await expect(client.search({ q: "stream large" })).rejects.toMatchObject({
      code: "ARXIV_RESPONSE_TOO_LARGE",
    });
  });

  it("schedules a retry through the same spacing gate and respects Retry-After", async () => {
    let clock = 20_000;
    const starts: number[] = [];
    const scheduler = new ArxivScheduler({
      now: () => clock,
      sleep: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    });
    const fetchFn = fetchMock(() => {
      starts.push(clock);
      return fetchFn.mock.calls.length === 1
        ? Promise.resolve(new Response("limited", { status: 429, headers: { "Retry-After": "5" } }))
        : Promise.resolve(new Response(successXml, { status: 200 }));
    });
    const client = new ArxivClient({ fetchFn, scheduler, now: () => clock });

    await expect(client.search({ q: "retry spacing" })).resolves.toMatchObject({ totalResults: 42 });
    expect(starts).toEqual([20_000, 25_000]);
  });
});

describe("arXiv client caching", () => {
  it("uses successful cache entries until TTL expiry", async () => {
    let clock = 1000;
    const cache = new BoundedCache<ResearchPaperSearchResult>({
      ttlMs: 100,
      now: () => clock,
    });
    const fetchFn = fetchMock(() => Promise.resolve(new Response(successXml, { status: 200 })));
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler(), cache });

    await client.search({ q: "cache me" });
    await client.search({ q: "  cache   me  " });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    clock += 101;
    await client.search({ q: "cache me" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const fetchFn = fetchMock(() =>
      fetchFn.mock.calls.length === 1
        ? Promise.resolve(new Response("bad request", { status: 400 }))
        : Promise.resolve(new Response(successXml, { status: 200 })),
    );
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler() });
    await expect(client.search({ q: "try again" })).rejects.toBeInstanceOf(ArxivIntegrationError);
    await expect(client.search({ q: "try again" })).resolves.toMatchObject({ totalResults: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("keys cache entries by normalized query, page, page size, and sort", async () => {
    const fetchFn = fetchMock(() => Promise.resolve(new Response(successXml, { status: 200 })));
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler() });
    await client.search({ q: "keys", page: 1, pageSize: 10, sort: "relevance" });
    await client.search({ q: "keys", page: 2, pageSize: 10, sort: "relevance" });
    await client.search({ q: "keys", page: 2, pageSize: 20, sort: "relevance" });
    await client.search({ q: "keys", page: 2, pageSize: 20, sort: "updated" });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("coalesces identical uncached in-flight searches", async () => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchFn = fetchMock(() => response);
    const client = new ArxivClient({ fetchFn, scheduler: immediateScheduler() });
    const first = client.search({ q: "same request" });
    const second = client.search({ q: "same request" });

    expect(first).toBe(second);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    release(new Response(successXml, { status: 200 }));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
  });

  it("evicts old cache entries at the configured capacity", () => {
    const cache = new BoundedCache<number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("refreshes recency on access before capacity eviction", () => {
    const cache = new BoundedCache<number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });
});
