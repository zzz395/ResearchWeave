/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from "vitest";

import { askKnowledge } from "../../src/features/knowledge/api/ask-knowledge";
import { ApiClientError } from "../../src/services/api/client";

const citation = {
  sourceId: "S1",
  documentId: "10000000-0000-4000-8000-000000000001",
  originalFilename: "evidence.pdf",
  ordinal: 3,
  contentHash: "a".repeat(64),
  pageNumber: 4,
  startOffset: 120,
  endOffset: 220,
};

afterEach(() => vi.unstubAllGlobals());

describe("Ask Knowledge API", () => {
  it("POSTs the trimmed request to the Space-scoped endpoint and parses the shared response contract", async () => {
    const response = { status: "answered", answer: "Supported [S1]", citations: [citation] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(response),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askKnowledge("space-1", { query: "  What is supported?  " })).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/spaces/space-1/knowledge/ask");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ query: "What is supported?" }),
      credentials: "include",
    });
  });

  it("rejects a successful response that does not match the shared contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: "answered", answer: "Missing citations", citations: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(askKnowledge("space-1", { query: "What is supported?" })).rejects.toMatchObject({
      code: "api_contract_mismatch",
    });
  });

  it("propagates shared API error metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "knowledge_not_indexed",
        message: "No active knowledge index exists.",
        requestId: "request-7c",
      },
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    const promise = askKnowledge("space-1", { query: "What is supported?" });
    await expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await expect(promise).rejects.toMatchObject({
      code: "knowledge_not_indexed",
      status: 409,
      requestId: "request-7c",
    });
  });
});
