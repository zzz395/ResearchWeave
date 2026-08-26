import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ArxivIntegrationError } from "../../server/integrations/arxiv/errors";
import { parseArxivIdentifier } from "../../server/integrations/arxiv/identifier";
import { parseArxivAtom } from "../../server/integrations/arxiv/parser";

async function fixture(name: string) {
  return readFile(new URL(`../fixtures/arxiv/${name}`, import.meta.url), "utf8");
}

describe("arXiv identifier parsing", () => {
  it.each([
    ["1501.00001", "1501.00001", undefined],
    ["1501.00001v2", "1501.00001", 2],
    ["0706.0001v3", "0706.0001", 3],
    ["2501.12345", "2501.12345", undefined],
    ["hep-ex/0307015v1", "hep-ex/0307015", 1],
    ["math.GT/0309136", "math.GT/0309136", undefined],
    ["https://arxiv.org/pdf/hep-ex/0307015v2.pdf", "hep-ex/0307015", 2],
  ] as const)("parses %s", (input, canonicalArxivId, version) => {
    expect(parseArxivIdentifier(input)).toEqual({ canonicalArxivId, version });
  });

  it("rejects unrelated URLs and malformed identifiers", () => {
    for (const identifier of [
      "https://attacker.example/abs/1501.00001v1",
      "1234.123",
      "2501.1234",
      "1401.12345",
      "2513.12345",
      "2500.12345",
      "2501.00000",
      "1501.000001",
      "1501.00001v0",
    ]) {
      expect(parseArxivIdentifier(identifier)).toBeUndefined();
    }
  });
});

describe("arXiv Atom parser", () => {
  it("normalizes multi-paper metadata, ordering, categories, whitespace, versions, and links", async () => {
    const result = parseArxivAtom(await fixture("search-success.xml"));

    expect(result).toMatchObject({ totalResults: 42, startIndex: 0, itemsPerPage: 2 });
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0]).toEqual({
      canonicalArxivId: "1501.00001",
      versionedArxivId: "1501.00001v2",
      version: 2,
      title: "A Line-Wrapped Research Title",
      abstract: "First abstract line. Second line with repeated spacing.",
      authors: ["Ada Lovelace", "Grace Hopper"],
      primaryCategory: "cs.LG",
      categories: ["cs.LG", "cs.AI"],
      publishedAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-02-03T04:05:06.000Z",
      comment: "12 pages, 3 figures",
      journalRef: "Journal of Tests 10 (2024)",
      doi: "10.1000/test.1",
      absUrl: "https://arxiv.org/abs/1501.00001v2",
      pdfUrl: "https://arxiv.org/pdf/1501.00001v2",
    });
    expect(result.papers[1]).toMatchObject({
      canonicalArxivId: "0706.0001",
      versionedArxivId: "0706.0001v3",
      version: 3,
      authors: ["Emmy Noether"],
      primaryCategory: "math.GT",
    });
  });

  it("treats a valid zero-result feed as successful and empty", async () => {
    expect(parseArxivAtom(await fixture("search-empty.xml"))).toEqual({
      totalResults: 0,
      startIndex: 0,
      itemsPerPage: 0,
      papers: [],
    });
  });

  it("omits unavailable optional metadata instead of inventing values", async () => {
    const paper = parseArxivAtom(await fixture("optional-fields.xml")).papers[0];
    expect(paper).not.toHaveProperty("comment");
    expect(paper).not.toHaveProperty("journalRef");
    expect(paper).not.toHaveProperty("doi");
    expect(paper.title).toBe("Paper without optional metadata & placeholders");
    expect(paper.abstract).toBe("An abstract that remains real metadata & meaning.");
    expect(paper.authors).toEqual(["Test Author & Collaborator"]);
    expect(paper.categories).toEqual(["physics.gen-ph"]);
  });

  it("normalizes legacy identifiers without assuming a modern ID shape", async () => {
    const papers = parseArxivAtom(await fixture("old-identifiers.xml")).papers;
    expect(papers.map(({ canonicalArxivId, versionedArxivId, version }) => ({
      canonicalArxivId,
      versionedArxivId,
      version,
    }))).toEqual([
      {
        canonicalArxivId: "hep-ex/0307015",
        versionedArxivId: "hep-ex/0307015v2",
        version: 2,
      },
      {
        canonicalArxivId: "math.GT/0309136",
        versionedArxivId: "math.GT/0309136v1",
        version: 1,
      },
    ]);
  });

  it.each([
    ["malformed.xml", "ARXIV_INVALID_RESPONSE"],
    ["error-feed.xml", "ARXIV_UPSTREAM_ERROR"],
  ] as const)("rejects %s with a typed integration error", async (name, code) => {
    try {
      parseArxivAtom(await fixture(name));
      expect.fail("Expected parsing to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ArxivIntegrationError);
      expect((error as ArxivIntegrationError).code).toBe(code);
    }
  });

  it("fails explicitly when canonical and versioned source identifiers conflict", async () => {
    const xml = (await fixture("optional-fields.xml")).replace(
      "2501.12345v1\" rel=\"related",
      "2501.54321v1\" rel=\"related",
    );
    expect(() => parseArxivAtom(xml)).toThrowError(ArxivIntegrationError);
  });

  it("fails explicitly when a required entry identifier is malformed", async () => {
    const xml = (await fixture("optional-fields.xml")).replace(
      "http://arxiv.org/abs/2501.12345</id>",
      "not-an-arxiv-identifier</id>",
    );
    expect(() => parseArxivAtom(xml)).toThrowError(ArxivIntegrationError);
  });
});
