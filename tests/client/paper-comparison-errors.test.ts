import { describe, expect, it } from "vitest";

import {
  mapPaperComparisonError,
  shouldRetryPaperComparisonSavedPapers,
} from "../../src/features/research/paper-comparison-errors";
import { ApiClientError } from "../../src/services/api/client";

describe("Paper comparison error presentation", () => {
  it("does not retry a context-level space_not_found Saved Papers failure", () => {
    expect(shouldRetryPaperComparisonSavedPapers(
      0,
      new ApiClientError("private detail", "space_not_found", 404),
    )).toBe(false);
  });

  it("retains the existing single retry for other Saved Papers failures", () => {
    expect(shouldRetryPaperComparisonSavedPapers(
      0,
      new ApiClientError("temporary detail", "network_error", 0),
    )).toBe(true);
    expect(shouldRetryPaperComparisonSavedPapers(1, new Error("temporary failure")))
      .toBe(false);
  });

  it.each([
    ["space_not_found", "page", "back_to_spaces", false, "Space is unavailable"],
    ["comparison_papers_not_found", "selection", "refresh_selection", false, "Selected papers are unavailable"],
    ["comparison_source_unavailable", "selection", "change_selection", false, "Abstract evidence is unavailable"],
    ["comparison_rate_limited", "result", "none", false, "Comparison limit reached"],
    ["comparison_unavailable", "result", "retry", true, "Paper comparison is unavailable"],
    ["comparison_upstream_timeout", "result", "retry", true, "Comparison generation timed out"],
    ["comparison_upstream_failure", "result", "retry", true, "Comparison generation is temporarily unavailable"],
    ["comparison_invalid_response", "result", "retry", true, "Comparison could not be validated"],
  ] as const)(
    "maps backend code %s to its safe surface and recovery action",
    (code, surface, action, canRetry, title) => {
      const mapped = mapPaperComparisonError(
        new ApiClientError("private provider detail", code, 500, "request-1"),
      );
      expect(mapped).toMatchObject({ title, surface, action, canRetry, requestId: "request-1" });
      expect(mapped.message).not.toContain("private provider detail");
    },
  );

  it("uses the required non-identifying copy for unavailable selected papers", () => {
    const privatePaperId = "10000000-0000-4000-8000-000000000001";
    const mapped = mapPaperComparisonError(new ApiClientError(
      `Paper ${privatePaperId} belongs to another Space.`,
      "comparison_papers_not_found",
      404,
    ));

    expect(mapped.message).toBe(
      "One or more selected papers are unavailable in this Space. Refresh Saved Papers and review your selection.",
    );
    expect(mapped.message).not.toContain(privatePaperId);
    expect(mapped.message).not.toContain("another Space");
  });

  it.each([
    ["network_error", "result", "retry", true],
    ["api_contract_mismatch", "result", "retry", true],
    ["invalid_api_response", "result", "retry", true],
    ["validation_error", "selection", "change_selection", false],
    ["payload_too_large", "selection", "change_selection", false],
    ["origin_not_allowed", "result", "none", false],
  ] as const)("maps client or request error %s without raw detail", (code, surface, action, canRetry) => {
    const mapped = mapPaperComparisonError(
      new ApiClientError("secret error detail", code, 400, "request-client"),
    );
    expect(mapped).toMatchObject({ surface, action, canRetry, requestId: "request-client" });
    expect(mapped.message).not.toContain("secret error detail");
  });

  it("defers a 401 to the global authentication flow", () => {
    expect(mapPaperComparisonError(
      new ApiClientError("private auth detail", "anything", 401, "request-auth"),
    )).toEqual({
      title: "Your session has ended",
      message: "Sign in again to continue comparing papers.",
      surface: "result",
      action: "none",
      canRetry: false,
      requestId: "request-auth",
    });
  });

  it("never exposes unknown API error messages", () => {
    const mapped = mapPaperComparisonError(
      new ApiClientError("provider key sk-private", "unknown_provider_failure", 500, "request-unknown"),
    );
    expect(mapped).toEqual({
      title: "Comparison could not be generated",
      message: "ResearchWeave could not generate this comparison. Please try again.",
      surface: "result",
      action: "retry",
      canRetry: true,
      requestId: "request-unknown",
    });
  });

  it("maps non-API failures to the same safe fixed fallback", () => {
    expect(mapPaperComparisonError(new Error("local private detail"))).toEqual({
      title: "Comparison could not be generated",
      message: "ResearchWeave could not generate this comparison. Please try again.",
      surface: "result",
      action: "retry",
      canRetry: true,
    });
  });
});
