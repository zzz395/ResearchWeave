/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PaperComparisonRequest } from "../../shared/contracts/paper-comparison";
import { compareSavedPapers } from "../../src/features/research/api/paper-comparison";
import { ApiClientError } from "../../src/services/api/client";

const paperIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
];

function responsePaper(id: string, index: number) {
  return {
    id,
    canonicalArxivId: `2401.0000${index}`,
    versionedArxivId: `2401.0000${index}v2`,
    version: 2,
    title: `Paper ${index}`,
    abstract: `Abstract ${index}`,
    authors: [`Author ${index}`],
    primaryCategory: "cs.AI",
    categories: ["cs.AI", "cs.LG"],
    publishedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    absUrl: `https://arxiv.org/abs/2401.0000${index}v2`,
    pdfUrl: `https://arxiv.org/pdf/2401.0000${index}v2`,
  };
}

function validResponse() {
  return {
    sourceBasis: {
      type: "arxiv_metadata_and_abstracts",
      label: "Abstract-based comparison",
      description:
        "This comparison uses stored arXiv metadata and abstracts only. It does not use or claim access to full text or indexed documents.",
    },
    papers: paperIds.map(responsePaper),
    comparison: {
      overview: "The papers study related problems.",
      similarities: ["Both evaluate learning systems."],
      dimensions: [{
        label: "Method",
        observations: [
          { paperId: paperIds[0], statement: "Uses a graph model." },
          { paperId: paperIds[1], statement: null },
        ],
      }],
    },
    generation: {
      model: "comparison-model",
      promptVersion: "abstract-comparison-v1",
      generatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Paper comparison API", () => {
  it("POSTs the exact parsed request to the Space-scoped endpoint and accepts only status 200", async () => {
    const response = validResponse();
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(response),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(compareSavedPapers("space-1", { paperIds })).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/spaces/space-1/paper-comparisons");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ paperIds }),
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  });

  it.each([
    { paperIds: [paperIds[0]] },
    { paperIds: [...paperIds, paperIds[0]] },
    { paperIds: [...paperIds, paperIds[0], paperIds[1], "10000000-0000-4000-8000-000000000003"] },
    { paperIds: [paperIds[0], "not-a-uuid"] },
    { paperIds, unexpected: true },
  ])("rejects an invalid request before fetch: $paperIds", async (request) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(compareSavedPapers("space-1", request as PaperComparisonRequest)).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a null observation while parsing the shared response contract", async () => {
    const response = validResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(response),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    const result = await compareSavedPapers("space-1", { paperIds });
    expect(result.comparison.dimensions[0]?.observations[1]?.statement).toBeNull();
  });

  it("rejects successful responses that do not match the shared contract", async () => {
    const response = validResponse();
    response.generation.promptVersion = "invented-version";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(response),
      { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "request-contract" } },
    )));

    await expect(compareSavedPapers("space-1", { paperIds })).rejects.toMatchObject({
      code: "api_contract_mismatch",
      status: 200,
      requestId: "request-contract",
    });
  });

  it("does not accept a non-200 success status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(validResponse()),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )));

    await expect(compareSavedPapers("space-1", { paperIds })).rejects.toMatchObject({
      code: "api_request_failed",
      status: 201,
    });
  });

  it("propagates safe API error metadata without changing the backend code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "comparison_papers_not_found",
        message: "One or more saved papers were not found.",
        requestId: "request-compare",
        details: { paperIds: [paperIds[0]] },
      },
    }), { status: 404, headers: { "Content-Type": "application/json" } })));

    const promise = compareSavedPapers("space-1", { paperIds });
    await expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await expect(promise).rejects.toMatchObject({
      code: "comparison_papers_not_found",
      status: 404,
      requestId: "request-compare",
    });
  });
});
