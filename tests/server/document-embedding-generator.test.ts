/// <reference lib="dom" />

import { describe, expect, it, vi } from "vitest";

import {
  MAX_EMBEDDING_RESPONSE_BYTES,
  OpenAICompatibleDocumentEmbeddingGenerator,
} from "../../server/integrations/document-embedding/openai-compatible-document-embedding-generator";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  DocumentEmbeddingError,
} from "../../server/modules/documents/document-embedding-generator";

function vector(value = 0.25, dimensions: number = DOCUMENT_EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length: dimensions }, () => value);
}

function successResponse(
  data: unknown = [
    { index: 0, embedding: vector() },
  ],
): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function generator(fetchFn: typeof fetch, overrides: { timeoutMs?: number } = {}) {
  return new OpenAICompatibleDocumentEmbeddingGenerator({
    baseUrl: "https://provider.example/v1/",
    apiKey: "secret-test-key",
    fetchFn,
    ...overrides,
  });
}

async function expectEmbeddingError(
  promise: Promise<unknown>,
  code: DocumentEmbeddingError["code"],
): Promise<DocumentEmbeddingError> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DocumentEmbeddingError);
    expect((error as DocumentEmbeddingError).code).toBe(code);
    return error as DocumentEmbeddingError;
  }
  throw new Error("Expected document embedding generation to fail.");
}

describe("OpenAI-compatible document embedding generator", () => {
  it("uses the frozen request contract and restores provider data to input order", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      successResponse([
        { index: 1, embedding: vector(0.2) },
        { index: 0, embedding: vector(0.1) },
      ]),
    );
    const result = await generator(fetchMock).embed({ texts: ["first", "second"] });

    expect(result).toEqual({
      model: DOCUMENT_EMBEDDING_MODEL,
      dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      embeddings: [vector(0.1), vector(0.2)],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toBeInstanceOf(URL);
    expect((requestUrl as URL).href).toBe("https://provider.example/v1/embeddings");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer secret-test-key",
      "Content-Type": "application/json",
    });
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(init.body)).toEqual({
      model: DOCUMENT_EMBEDDING_MODEL,
      input: ["first", "second"],
      encoding_format: "float",
      dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
    });
  });

  it("splits at 32 and awaits batches sequentially", async () => {
    let releaseFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(successResponse([{ index: 0, embedding: vector(0.9) }]));
    const pending = generator(fetchMock).embed({
      texts: Array.from({ length: 33 }, (_, index) => `chunk-${index}`),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstInit = fetchMock.mock.calls[0]?.[1];
    if (typeof firstInit?.body !== "string") throw new Error("Expected a JSON request body.");
    expect((JSON.parse(firstInit.body) as { input: string[] }).input).toHaveLength(32);
    releaseFirst?.(
      successResponse(Array.from({ length: 32 }, (_, index) => ({ index, embedding: vector(index) }))),
    );
    const result = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.embeddings).toHaveLength(33);
  });

  it("does not return partial output when a later sequential batch fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        successResponse(
          Array.from({ length: 32 }, (_, index) => ({ index, embedding: vector(index) })),
        ),
      )
      .mockResolvedValueOnce(new Response("provider-secret-body", { status: 400 }));
    await expectEmbeddingError(
      generator(fetchMock).embed({
        texts: Array.from({ length: 33 }, (_, index) => `chunk-${index}`),
      }),
      "document_embedding_rejected",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["duplicate index", [{ index: 0, embedding: vector() }, { index: 0, embedding: vector() }], 2],
    ["missing index", [{ index: 0, embedding: vector() }], 2],
    ["out-of-range index", [{ index: 1, embedding: vector() }], 1],
    ["non-integer index", [{ index: 0.5, embedding: vector() }], 1],
    ["embedding not array", [{ index: 0, embedding: "secret body" }], 1],
    ["short vector", [{ index: 0, embedding: vector(0.1, 1535) }], 1],
    ["long vector", [{ index: 0, embedding: vector(0.1, 1537) }], 1],
    ["non-number vector", [{ index: 0, embedding: [...vector().slice(1), "bad"] }], 1],
    ["non-finite vector", [{ index: 0, embedding: [...vector().slice(1), Number.NaN] }], 1],
  ] as const)("rejects %s without retry", async (_label, data, textCount) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse(data));
    await expectEmbeddingError(
      generator(fetchMock).embed({ texts: Array.from({ length: textCount }, () => "text") }),
      "document_embedding_invalid_response",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing data", JSON.stringify({})],
    ["invalid JSON", "not-json-secret"],
    ["empty body", ""],
  ])("rejects %s without exposing the provider body", async (_label, body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const error = await expectEmbeddingError(
      generator(fetchMock).embed({ texts: ["text"] }),
      "document_embedding_invalid_response",
    );
    if (body) expect(error.message).not.toContain(body);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a response larger than 4 MiB", async () => {
    const oversized = "x".repeat(MAX_EMBEDDING_RESPONSE_BYTES + 1);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(oversized));
    await expectEmbeddingError(
      generator(fetchMock).embed({ texts: ["text"] }),
      "document_embedding_invalid_response",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([429, 502, 503, 504])("retries HTTP %i once", async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(successResponse());
    await expect(generator(fetchMock).embed({ texts: ["text"] })).resolves.toMatchObject({
      embeddings: [vector()],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries network failures once and caps unavailable attempts at two", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network secret detail"));
    const error = await expectEmbeddingError(
      generator(fetchMock).embed({ texts: ["text"] }),
      "document_embedding_unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(error.message).not.toContain("network secret detail");
  });

  it("retries timeouts once and caps attempts at two", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException("secret", "AbortError"));
      return Promise.resolve(successResponse());
    });
    const timedGenerator = new OpenAICompatibleDocumentEmbeddingGenerator({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      fetchFn: fetchMock,
      setTimer: (callback) => {
        callback();
        return {} as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });
    await expectEmbeddingError(
      timedGenerator.embed({ texts: ["text"] }),
      "document_embedding_unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry rejected HTTP %i or expose its body",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("provider-secret-body", { status }));
      const error = await expectEmbeddingError(
        generator(fetchMock).embed({ texts: ["text"] }),
        "document_embedding_rejected",
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(error.message).not.toContain("provider-secret-body");
    },
  );

  it("does not retry an unexpected non-frozen 5xx status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    await expectEmbeddingError(
      generator(fetchMock).embed({ texts: ["text"] }),
      "document_embedding_unavailable",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
