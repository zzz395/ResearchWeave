/// <reference lib="dom" />

import { describe, expect, it, vi } from "vitest";

import type { PaperComparisonGeneratedContent } from "../../shared/contracts/paper-comparison";
import { PaperComparisonGeneratorError } from "../../server/integrations/paper-comparison/errors";
import {
  MAX_PAPER_COMPARISON_RESPONSE_BYTES,
  OpenAICompatiblePaperComparisonGenerator,
} from "../../server/integrations/paper-comparison/openai-compatible-generator";
import type { PaperComparisonSource } from "../../server/modules/paper-comparison/source";

const sources: PaperComparisonSource[] = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    versionedArxivId: "2501.00001v1",
    version: 1,
    title: "Grounded comparison one",
    abstract: "The first abstract states a supported research focus.",
    authors: ["Ada Researcher"],
    primaryCategory: "cs.AI",
    categories: ["cs.AI"],
    publishedAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  },
  {
    id: "60000000-0000-4000-8000-000000000002",
    versionedArxivId: "2501.00002v2",
    version: 2,
    title: "Grounded comparison two",
    abstract: "The second abstract states a different supported focus.",
    authors: ["Lin Scholar"],
    primaryCategory: "cs.LG",
    categories: ["cs.LG"],
    publishedAt: new Date("2025-01-03T00:00:00.000Z"),
    updatedAt: new Date("2025-01-04T00:00:00.000Z"),
  },
];

const content: PaperComparisonGeneratedContent = {
  overview: "The abstracts state related but distinct research focuses.",
  similarities: [],
  dimensions: [
    {
      label: "Research focus",
      observations: sources.map((source) => ({
        paperId: source.id,
        statement: source.abstract,
      })),
    },
  ],
};

function successResponse(comparison: unknown = content): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(comparison) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function generator(fetchFn: typeof fetch) {
  return new OpenAICompatiblePaperComparisonGenerator({
    baseUrl: "https://provider.example/v1/",
    apiKey: "test-key",
    model: "test-model",
    fetchFn,
  });
}

async function expectGeneratorError(
  promise: Promise<unknown>,
  code: PaperComparisonGeneratorError["code"],
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected paper comparison generation to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(PaperComparisonGeneratorError);
    expect((error as PaperComparisonGeneratorError).code).toBe(code);
  }
}

describe("OpenAI-compatible paper comparison generator", () => {
  it("sends only allowlisted abstract evidence and validates JSON content", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    await expect(generator(fetchMock).generate(sources)).resolves.toEqual(content);

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
    const body = JSON.parse(init.body) as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("UNTRUSTED REFERENCE DATA");
    expect(body.messages[0]?.content).toContain("Do not use outside knowledge");
    expect(body.messages[0]?.content).toContain("do not claim access to full text");
    const sentSources = JSON.parse(body.messages[1].content) as Array<Record<string, unknown>>;
    expect(sentSources).toHaveLength(2);
    expect(Object.keys(sentSources[0]).sort()).toEqual([
      "abstract",
      "authors",
      "categories",
      "id",
      "primaryCategory",
      "publishedAt",
      "title",
      "updatedAt",
      "version",
      "versionedArxivId",
    ]);
  });

  it.each([
    ["invalid outer JSON", new Response("not json", { status: 200 })],
    ["missing choices", new Response(JSON.stringify({}), { status: 200 })],
    [
      "Markdown fences",
      new Response(
        JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(content)}\n\`\`\`` } }] }),
        { status: 200 },
      ),
    ],
    ["invalid generated schema", successResponse({ ...content, overview: "" })],
  ])("rejects %s without retry", async (_label, response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expectGeneratorError(
      generator(fetchMock).generate(sources),
      "COMPARISON_INVALID_RESPONSE",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an oversized provider response without retry", async () => {
    const oversized = JSON.stringify({
      choices: [{ message: { content: "x".repeat(MAX_PAPER_COMPARISON_RESPONSE_BYTES) } }],
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(oversized, { status: 200 }));
    await expectGeneratorError(
      generator(fetchMock).generate(sources),
      "COMPARISON_RESPONSE_TOO_LARGE",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a non-transient HTTP failure or expose its body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret provider body", { status: 400 }));
    try {
      await generator(fetchMock).generate(sources);
      throw new Error("Expected paper comparison generation to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PaperComparisonGeneratorError);
      expect((error as Error).message).not.toContain("secret provider body");
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([429, 502, 503, 504])("retries HTTP %i once and succeeds", async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(successResponse());
    await expect(generator(fetchMock).generate(sources)).resolves.toEqual(content);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure once and caps total attempts at two", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("secret network detail"))
      .mockRejectedValueOnce(new TypeError("secret network detail"));
    await expectGeneratorError(
      generator(fetchMock).generate(sources),
      "COMPARISON_UPSTREAM_FAILURE",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries timeout and maps the final timeout explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      return Promise.resolve(successResponse());
    });
    const timedGenerator = new OpenAICompatiblePaperComparisonGenerator({
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
    await expectGeneratorError(
      timedGenerator.generate(sources),
      "COMPARISON_UPSTREAM_TIMEOUT",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
