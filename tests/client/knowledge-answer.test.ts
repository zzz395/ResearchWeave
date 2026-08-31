import { describe, expect, it } from "vitest";

import {
  getUniqueKnowledgeCitations,
  tokenizeKnowledgeAnswer,
} from "../../src/features/knowledge/knowledge-answer";

function citation(sourceId: "S1" | "S2") {
  return {
    sourceId,
    documentId: sourceId === "S1"
      ? "10000000-0000-4000-8000-000000000001"
      : "10000000-0000-4000-8000-000000000002",
    originalFilename: `${sourceId}.pdf`,
    ordinal: 0,
    contentHash: "a".repeat(64),
    pageNumber: null,
    startOffset: 0,
    endOffset: 10,
  };
}

const s1 = citation("S1");
const s2 = citation("S2");

function compact(answer: string, citations = [s1, s2]) {
  return tokenizeKnowledgeAnswer(answer, citations).map((token) =>
    token.type === "text" ? ["text", token.value] : ["citation", token.value],
  );
}

describe("Knowledge answer citation tokenization", () => {
  it("preserves plain text when there are no markers", () => {
    expect(compact("Plain grounded answer.")).toEqual([["text", "Plain grounded answer."]]);
  });

  it("recognizes authoritative canonical markers and preserves surrounding text", () => {
    expect(compact("Before [S1] between [S2] after.")).toEqual([
      ["text", "Before "],
      ["citation", "[S1]"],
      ["text", " between "],
      ["citation", "[S2]"],
      ["text", " after."],
    ]);
  });

  it("keeps repeated authoritative markers interactive", () => {
    expect(compact("[S1] then [S1]", [s1])).toEqual([
      ["citation", "[S1]"],
      ["text", " then "],
      ["citation", "[S1]"],
    ]);
  });

  it.each([
    ["unknown canonical", "Text [S9]", "Text [S9]"],
    ["spaced", "Text [ S1 ]", "Text [ S1 ]"],
    ["lowercase", "Text [s1]", "Text [s1]"],
    ["extended", "Text [S1-extra]", "Text [S1-extra]"],
  ])("keeps %s marker-like content as ordinary text", (_label, answer, expected) => {
    expect(compact(answer, [s1])).toEqual([["text", expected]]);
  });

  it("recognizes the inner canonical marker in nested brackets", () => {
    expect(compact("Nested [[S1]] marker", [s1])).toEqual([
      ["text", "Nested ["],
      ["citation", "[S1]"],
      ["text", "] marker"],
    ]);
  });

  it("keeps all markers as text without authoritative citations", () => {
    expect(compact("No source [S1] or [S2].", [])).toEqual([
      ["text", "No source [S1] or [S2]."],
    ]);
  });

  it("does not depend on authoritative source ordering", () => {
    expect(compact("[S1] and [S2]", [s2, s1])).toEqual([
      ["citation", "[S1]"],
      ["text", " and "],
      ["citation", "[S2]"],
    ]);
  });

  it("deduplicates source rows while preserving the first server position", () => {
    expect(getUniqueKnowledgeCitations([s2, s1, s2])).toEqual([s2, s1]);
  });
});
