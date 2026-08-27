/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  removeSavedPaper,
  savePaperToSpace,
  searchResearchPapers,
} from "../../src/features/research/api/research";

const paper = {
  id: "10000000-0000-4000-8000-000000000001",
  canonicalArxivId: "2401.00001",
  versionedArxivId: "2401.00001v2",
  version: 2,
  title: "A durable research paper",
  abstract: "A complete abstract for contract validation.",
  authors: ["Ada Researcher"],
  primaryCategory: "cs.IR",
  categories: ["cs.IR", "cs.AI"],
  publishedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  fetchedAt: "2026-01-03T00:00:00.000Z",
  absUrl: "https://arxiv.org/abs/2401.00001v2",
  pdfUrl: "https://arxiv.org/pdf/2401.00001v2",
};
const savedPaper = {
  paper,
  savedByUserId: "20000000-0000-4000-8000-000000000002",
  savedAt: "2026-01-04T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research API requests", () => {
  it("sends the submitted search state and fixed page size to the backend endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      totalResults: 1,
      startIndex: 10,
      itemsPerPage: 10,
      papers: [paper],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await searchResearchPapers({ q: "graph agents", page: 2, pageSize: 10, sort: "updated" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/research/papers/search?q=graph+agents&page=2&pageSize=10&sort=updated",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it.each([200, 201])("accepts a %i save response and sends only an empty JSON object", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ savedPaper }),
      { status, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(savePaperToSpace("space-1", paper.id)).resolves.toEqual(savedPaper);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/spaces/space-1/saved-papers/${paper.id}`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      body: "{}",
      credentials: "include",
    });
  });

  it("uses DELETE and accepts an empty 204 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(removeSavedPaper("space-1", paper.id)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/spaces/space-1/saved-papers/${paper.id}`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
});
