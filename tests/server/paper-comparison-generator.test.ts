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

const additionalSources: PaperComparisonSource[] = [
  {
    id: "60000000-0000-4000-8000-000000000003",
    versionedArxivId: "2501.00003v1",
    version: 1,
    title: "Grounded comparison three",
    abstract: "The third abstract states another supported research focus.",
    authors: ["Mina Scientist"],
    primaryCategory: "cs.CL",
    categories: ["cs.CL"],
    publishedAt: new Date("2025-01-05T00:00:00.000Z"),
    updatedAt: new Date("2025-01-06T00:00:00.000Z"),
  },
  {
    id: "60000000-0000-4000-8000-000000000004",
    versionedArxivId: "2501.00004v3",
    version: 3,
    title: "Grounded comparison four",
    abstract: "The fourth abstract states a final supported research focus.",
    authors: ["Noah Analyst"],
    primaryCategory: "stat.ML",
    categories: ["stat.ML"],
    publishedAt: new Date("2025-01-07T00:00:00.000Z"),
    updatedAt: new Date("2025-01-08T00:00:00.000Z"),
  },
];

const allSources = [...sources, ...additionalSources];

function contentFor(selectedSources: PaperComparisonSource[]): PaperComparisonGeneratedContent {
  return {
    overview: "The abstracts state related but distinct research focuses.",
    similarities: [],
    dimensions: [
      {
        label: "Research focus",
        observations: selectedSources.map((source) => ({
          paperId: source.id,
          statement: source.abstract,
        })),
      },
    ],
  };
}

const content = contentFor(sources);

function completionResponse({
  comparison = content,
  contentOverride,
  finishReason = "stop",
  refusal = null,
  omitContent = false,
}: {
  comparison?: unknown;
  contentOverride?: string | null;
  finishReason?: string | null;
  refusal?: string | null;
  omitContent?: boolean;
} = {}): Response {
  const message: Record<string, unknown> = { refusal };
  if (!omitContent) {
    message.content = contentOverride === undefined
      ? JSON.stringify(comparison)
      : contentOverride;
  }
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finishReason, message }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function successResponse(comparison: unknown = content): Response {
  return completionResponse({ comparison });
}

interface CapturedProviderRequest {
  messages: Array<{ content: string }>;
  response_format: {
    type: string;
    json_schema: {
      strict: boolean;
      schema: {
        properties: {
          dimensions: {
            items: {
              properties: {
                observations: {
                  minItems: number;
                  maxItems: number;
                  items: {
                    properties: {
                      paperId: { enum: string[] };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}

function capturedRequest(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): CapturedProviderRequest {
  const init = fetchMock.mock.calls[0]?.[1];
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(init.body) as CapturedProviderRequest;
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
    const body = capturedRequest(fetchMock);
    expect(body.messages[0]?.content).toContain("UNTRUSTED REFERENCE DATA");
    expect(body.messages[0]?.content).toContain("Do not use outside knowledge");
    expect(body.messages[0]?.content).toContain("do not claim access to full text");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
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

  it.each([2, 3, 4])(
    "constrains structured observations to exactly %i selected paper IDs",
    async (count) => {
      const selectedSources = allSources.slice(0, count);
      const expected = contentFor(selectedSources);
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse(expected));

      await expect(generator(fetchMock).generate(selectedSources)).resolves.toEqual(expected);

      const schema = capturedRequest(fetchMock).response_format.json_schema.schema;
      const observations = schema.properties.dimensions.items.properties.observations;
      expect(observations.minItems).toBe(count);
      expect(observations.maxItems).toBe(count);
      expect(observations.items.properties.paperId.enum).toEqual(
        selectedSources.map(({ id }) => id),
      );
    },
  );

  it.each([
    ["length completion", completionResponse({ finishReason: "length" })],
    [
      "content-filter completion",
      completionResponse({ finishReason: "content_filter", contentOverride: null }),
    ],
    [
      "refusal",
      completionResponse({ refusal: "The provider refused the request.", contentOverride: null }),
    ],
    ["empty content", completionResponse({ contentOverride: "" })],
    ["missing content", completionResponse({ omitContent: true })],
  ])("rejects %s safely without retry", async (_label, response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expectGeneratorError(
      generator(fetchMock).generate(sources),
      "COMPARISON_INVALID_RESPONSE",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["invalid outer JSON", new Response("not json", { status: 200 })],
    ["missing choices", new Response(JSON.stringify({}), { status: 200 })],
    ["truncated generated JSON", completionResponse({ contentOverride: '{"overview":"cut' })],
    [
      "Markdown fences",
      completionResponse({ contentOverride: `\`\`\`json\n${JSON.stringify(content)}\n\`\`\`` }),
    ],
    ["prose plus JSON", completionResponse({ contentOverride: `Result:\n${JSON.stringify(content)}` })],
    ["invalid generated schema", successResponse({ ...content, overview: "" })],
  ])("rejects %s without retry", async (_label, response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expectGeneratorError(
      generator(fetchMock).generate(sources),
      "COMPARISON_INVALID_RESPONSE",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["wrong", "missing", "duplicate"])(
    "rejects %s paper IDs at the provider boundary",
    async (kind) => {
      const selectedSources = allSources.slice(0, 3);
      const invalid = contentFor(selectedSources);
      const observations = invalid.dimensions[0]?.observations;
      if (!observations) throw new Error("Expected comparison observations.");
      if (kind === "wrong") {
        observations[0] = {
          ...observations[0],
          paperId: "60000000-0000-4000-8000-000000000099",
        };
      }
      if (kind === "missing") observations.pop();
      if (kind === "duplicate") observations[0] = { ...observations[0], paperId: observations[1].paperId };

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse(invalid));
      await expectGeneratorError(
        generator(fetchMock).generate(selectedSources),
        "COMPARISON_INVALID_RESPONSE",
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("does not expose malformed provider content through its stable error", async () => {
    const privateContent = "private abstract and sk-secret are not JSON";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      completionResponse({ contentOverride: privateContent }),
    );

    try {
      await generator(fetchMock).generate(sources);
      throw new Error("Expected paper comparison generation to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PaperComparisonGeneratorError);
      expect((error as Error).message).not.toContain(privateContent);
      expect((error as Error).message).not.toContain("sk-secret");
      expect((error as Error).message).not.toContain("UNTRUSTED REFERENCE DATA");
    }
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
