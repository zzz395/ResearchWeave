import { describe, expect, it } from "vitest";

import {
  buildArxivSearchUrl,
  parseResearchSearchQuery,
} from "../../server/integrations/arxiv/query";

describe("arXiv search query builder", () => {
  it("normalizes simple search input and applies bounded defaults", () => {
    expect(parseResearchSearchQuery({ q: "  quantum   gravity  " })).toEqual({
      q: "quantum gravity",
      page: 1,
      pageSize: 10,
      sort: "relevance",
    });
    expect(parseResearchSearchQuery({ q: "ab", page: "2", pageSize: "20" })).toMatchObject({
      q: "ab",
      page: 2,
      pageSize: 20,
    });
  });

  it("rejects invalid query, page, page size, and sort values", () => {
    for (const input of [
      { q: "x" },
      { q: "x".repeat(201) },
      { q: "valid", page: 0 },
      { q: "valid", page: 1.5 },
      { q: "valid", pageSize: 0 },
      { q: "valid", pageSize: 21 },
      { q: "valid", sort: "ascending" },
    ]) {
      expect(() => parseResearchSearchQuery(input)).toThrow();
    }
  });

  it.each([
    ["relevance", "relevance"],
    ["submitted", "submittedDate"],
    ["updated", "lastUpdatedDate"],
  ] as const)("maps %s sorting with descending order", (sort, upstreamSort) => {
    const url = buildArxivSearchUrl(
      parseResearchSearchQuery({ q: "evidence", page: 3, pageSize: 7, sort }),
    );
    expect(url.searchParams.get("start")).toBe("14");
    expect(url.searchParams.get("max_results")).toBe("7");
    expect(url.searchParams.get("sortBy")).toBe(upstreamSort);
    expect(url.searchParams.get("sortOrder")).toBe("descending");
  });

  it("uses AND semantics across ordinary whitespace-separated literal terms", () => {
    const retrieval = buildArxivSearchUrl(
      parseResearchSearchQuery({ q: "retrieval augmented generation" }),
    );
    expect(retrieval.searchParams.get("search_query")).toBe(
      'all:"retrieval" AND all:"augmented" AND all:"generation"',
    );
    expect(retrieval.searchParams.get("search_query")).not.toBe(
      'all:"retrieval augmented generation"',
    );

    const quantum = buildArxivSearchUrl(parseResearchSearchQuery({ q: "quantum gravity" }));
    expect(quantum.searchParams.get("search_query")).toBe(
      'all:"quantum" AND all:"gravity"',
    );
  });

  it("keeps field prefixes and Boolean operators as literal all-field terms", () => {
    const url = buildArxivSearchUrl(
      parseResearchSearchQuery({
        q: "cat:cs.AI OR ti:transformer",
        search_query: "cat:cs.AI OR ti:transformer",
      }),
    );

    expect(url.searchParams.get("search_query")).toBe(
      'all:"cat:cs.AI" AND all:"OR" AND all:"ti:transformer"',
    );
  });

  it("escapes query-control characters without allowing host or parameter control", () => {
    const input = parseResearchSearchQuery({
      q: 'https://attacker.example/?x=1 quantum"escape \\field (group)',
      baseUrl: "https://attacker.example",
    });
    const url = buildArxivSearchUrl(input);

    expect(url.origin).toBe("https://export.arxiv.org");
    expect(url.pathname).toBe("/api/query");
    expect([...url.searchParams.keys()].sort()).toEqual([
      "max_results",
      "search_query",
      "sortBy",
      "sortOrder",
      "start",
    ]);
    expect(url.searchParams.get("search_query")).toBe(
      'all:"https://attacker.example/?x=1" AND all:"quantum\\"escape" AND all:"\\\\field" AND all:"(group)"',
    );
    expect(url.href).toContain("search_query=all%3A%22");
  });
});
