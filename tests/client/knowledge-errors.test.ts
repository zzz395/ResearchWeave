import { describe, expect, it } from "vitest";

import { mapAskKnowledgeError } from "../../src/features/knowledge/knowledge-errors";
import { ApiClientError } from "../../src/services/api/client";

describe("Ask Knowledge error presentation", () => {
  it.each([
    ["knowledge_not_indexed", "Knowledge is not indexed yet", "Index at least one document"],
    ["knowledge_embedding_incompatible", "Knowledge indexes are incompatible", "Reindex the affected documents"],
    ["space_not_found", "Space is unavailable", "access may have changed"],
    ["answer_generation_unavailable", "Answer generation is unavailable", "not currently configured"],
    ["answer_upstream_timeout", "Answer generation timed out", "safe to retry"],
    ["answer_upstream_failure", "Answer generation is temporarily unavailable", "upstream"],
    ["answer_invalid_response", "Answer could not be validated", "could not be validated"],
  ])("maps %s", (code, title, message) => {
    const mapped = mapAskKnowledgeError(
      new ApiClientError("private detail", code, 500, "request-1"),
    );
    expect(mapped.title).toBe(title);
    expect(mapped.message).toContain(message);
    expect(mapped.requestId).toBe("request-1");
  });

  it("maps unknown API errors without discarding the safe server message", () => {
    expect(mapAskKnowledgeError(new ApiClientError("Safe fallback.", "unknown", 500)))
      .toEqual({ title: "Answer could not be generated", message: "Safe fallback.", requestId: undefined });
  });

  it("maps non-API failures to a stable fallback", () => {
    expect(mapAskKnowledgeError(new Error("private"))).toEqual({
      title: "Answer could not be generated",
      message: "Please try asking your question again.",
    });
  });
});
