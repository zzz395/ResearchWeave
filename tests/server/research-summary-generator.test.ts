/// <reference lib="dom" />

import { describe, expect, it, vi } from "vitest";

import { ResearchSummaryGeneratorError } from "../../server/integrations/research-summary/errors";
import { OpenAICompatibleResearchSummaryGenerator } from "../../server/integrations/research-summary/openai-compatible-generator";
import type { PaperSummarySource } from "../../server/modules/research/summary-fingerprint";

const source: PaperSummarySource = {
  id: "10000000-0000-4000-8000-000000000001",
  versionedArxivId: "2401.00001v2",
  version: 2,
  title: "Grounded summaries",
  abstract: "The abstract explicitly supports this overview.",
  authors: ["Ada Researcher"],
  primaryCategory: "cs.AI",
  categories: ["cs.AI"],
  publishedAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
};

const content = {
  overview: "A grounded overview.",
  keyContributions: ["A supported contribution."],
  methodHighlights: [],
  findings: [],
  caveats: [],
};

function successResponse(summary: unknown = content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(summary) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function generator(fetchFn: typeof fetch, overrides: { timeoutMs?: number } = {}) {
  return new OpenAICompatibleResearchSummaryGenerator({
    baseUrl: "https://provider.example/v1/",
    apiKey: "test-key",
    model: "test-model",
    fetchFn,
    ...overrides,
  });
}

function expectGeneratorError(error: unknown, code: ResearchSummaryGeneratorError["code"]) {
  expect(error).toBeInstanceOf(ResearchSummaryGeneratorError);
  expect((error as ResearchSummaryGeneratorError).code).toBe(code);
}

describe("OpenAI-compatible research summary generator", () => {
  it("sends grounded metadata to the normalized endpoint and validates valid JSON content", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    await expect(generator(fetchMock).generate(source)).resolves.toEqual(content);

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toBeInstanceOf(URL);
    if (!(requestUrl instanceof URL)) throw new Error("Expected the provider request URL.");
    expect(requestUrl.href).toBe("https://provider.example/v1/chat/completions");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
    const body = JSON.parse(init.body) as { model: string; messages: Array<{ content: string }> };
    expect(body.model).toBe("test-model");
    expect(body.messages[0]?.content).toContain("Use only the supplied paper metadata and abstract");
    expect(body.messages[1]?.content).toContain(source.abstract);
  });

  it.each([
    ["malformed model JSON", { choices: [{ message: { content: "not json" } }] }],
    ["invalid summary schema", { choices: [{ message: { content: JSON.stringify({ ...content, caveats: [""] }) } }] }],
    ["missing choices", {}],
    ["missing content", { choices: [{ message: {} }] }],
    ["Markdown fences", { choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(content)}\n\`\`\`` } }] }],
  ])("rejects %s without retry", async (_label, payload) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    await generator(fetchMock).generate(source).catch((error) => {
      expectGeneratorError(error, "SUMMARY_INVALID_RESPONSE");
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a non-transient HTTP failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret", { status: 400 }));
    await generator(fetchMock).generate(source).catch((error) => {
      expectGeneratorError(error, "SUMMARY_UPSTREAM_FAILURE");
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([429, 502, 503, 504])("retries HTTP %i once and succeeds", async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(successResponse());
    await expect(generator(fetchMock).generate(source)).resolves.toEqual(content);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure once and caps total attempts at two", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network detail"))
      .mockRejectedValueOnce(new TypeError("network detail"));
    await generator(fetchMock).generate(source).catch((error) => {
      expectGeneratorError(error, "SUMMARY_UPSTREAM_FAILURE");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries timeout and maps the final timeout explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      return Promise.resolve(successResponse());
    });
    const timedGenerator = new OpenAICompatibleResearchSummaryGenerator({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      model: "test-model",
      fetchFn: fetchMock,
      setTimer: (callback) => {
        callback();
        return {} as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });
    await timedGenerator.generate(source).catch((error) => {
      expectGeneratorError(error, "SUMMARY_UPSTREAM_TIMEOUT");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
