import { describe, expect, it } from "vitest";

import {
  canSubmitPaperComparison,
  createPaperComparisonMutationOwnership,
  createPaperComparisonSearchParams,
  getPaperComparisonMutationView,
  getPaperComparisonPath,
  getPaperComparisonSelectionFingerprint,
  parsePaperComparisonSearchParams,
  reconcilePaperComparisonPaperIds,
  togglePaperComparisonPaperId,
} from "../../src/features/research/paper-comparison-state";

const paperIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
];

describe("Paper comparison URL and selection state", () => {
  it("builds the Space-scoped comparison route", () => {
    expect(getPaperComparisonPath("10000000-0000-4000-8000-000000000001"))
      .toBe("/spaces/10000000-0000-4000-8000-000000000001/saved-papers/compare");
    expect(getPaperComparisonPath("space/with separator"))
      .toBe("/spaces/space%2Fwith%20separator/saved-papers/compare");
  });

  it("parses repeated paper parameters in their original order", () => {
    const params = new URLSearchParams();
    params.append("paper", paperIds[2]);
    params.append("paper", paperIds[0]);

    expect(parsePaperComparisonSearchParams(params)).toEqual({
      paperIds: [paperIds[2], paperIds[0]],
      wasNormalized: false,
    });
  });

  it("drops malformed and duplicate values, retains first occurrences, and keeps only four", () => {
    const params = new URLSearchParams();
    params.append("paper", "not-a-uuid");
    params.append("paper", paperIds[1]);
    params.append("paper", paperIds[1]);
    params.append("paper", paperIds[3]);
    params.append("paper", paperIds[0]);
    params.append("paper", paperIds[4]);
    params.append("paper", paperIds[2]);

    expect(parsePaperComparisonSearchParams(params)).toEqual({
      paperIds: [paperIds[1], paperIds[3], paperIds[0], paperIds[4]],
      wasNormalized: true,
    });
  });

  it("marks unsupported query keys for canonical replacement", () => {
    expect(parsePaperComparisonSearchParams(
      new URLSearchParams(`paper=${paperIds[0]}&result=not-durable`),
    )).toEqual({ paperIds: [paperIds[0]], wasNormalized: true });
  });

  it("serializes only valid, unique selections using repeated paper keys", () => {
    expect(createPaperComparisonSearchParams([
      paperIds[2],
      "invalid",
      paperIds[0],
      paperIds[2],
      paperIds[4],
      paperIds[1],
      paperIds[3],
    ]).toString()).toBe(
      `paper=${paperIds[2]}&paper=${paperIds[0]}&paper=${paperIds[4]}&paper=${paperIds[1]}`,
    );
  });

  it("reconciles stale or unavailable identifiers without revealing why they disappeared", () => {
    expect(reconcilePaperComparisonPaperIds(
      [paperIds[2], paperIds[0], paperIds[3]],
      [paperIds[0], paperIds[2]],
    )).toEqual({ paperIds: [paperIds[2], paperIds[0]], changed: true });

    const unchangedSelection = [paperIds[2], paperIds[0]];
    const unchanged = reconcilePaperComparisonPaperIds(
      unchangedSelection,
      [paperIds[0], paperIds[2], paperIds[4]],
    );
    expect(unchanged).toEqual({ paperIds: [paperIds[2], paperIds[0]], changed: false });
    expect(unchanged.paperIds).toBe(unchangedSelection);
  });

  it("adds selections up to four, refuses a fifth, and always permits deselection", () => {
    expect(togglePaperComparisonPaperId([], paperIds[0])).toEqual([paperIds[0]]);
    const maximumSelection = paperIds.slice(0, 4);
    expect(togglePaperComparisonPaperId(maximumSelection, paperIds[4]))
      .toBe(maximumSelection);
    expect(togglePaperComparisonPaperId(paperIds.slice(0, 4), paperIds[1]))
      .toEqual([paperIds[0], paperIds[2], paperIds[3]]);
  });

  it("rejects invalid toggle targets and normalizes defensive input", () => {
    const validSelection = paperIds.slice(0, 2);
    expect(togglePaperComparisonPaperId(validSelection, "invalid")).toBe(validSelection);
    expect(togglePaperComparisonPaperId([paperIds[0], paperIds[0], "invalid"], "invalid"))
      .toEqual([paperIds[0]]);
  });

  it("allows submission only for two to four unique valid UUIDs", () => {
    expect(canSubmitPaperComparison([])).toBe(false);
    expect(canSubmitPaperComparison([paperIds[0]])).toBe(false);
    expect(canSubmitPaperComparison(paperIds.slice(0, 2))).toBe(true);
    expect(canSubmitPaperComparison(paperIds.slice(0, 4))).toBe(true);
    expect(canSubmitPaperComparison(paperIds)).toBe(false);
    expect(canSubmitPaperComparison([paperIds[0], paperIds[0]])).toBe(false);
    expect(canSubmitPaperComparison([paperIds[0], "invalid"])).toBe(false);
  });

  it("creates an order-sensitive stable fingerprint from normalized selection state", () => {
    const fingerprint = getPaperComparisonSelectionFingerprint([paperIds[0], paperIds[1]]);
    expect(getPaperComparisonSelectionFingerprint([paperIds[0], paperIds[1]]))
      .toBe(fingerprint);
    expect(getPaperComparisonSelectionFingerprint([paperIds[1], paperIds[0]]))
      .not.toBe(fingerprint);
    expect(getPaperComparisonSelectionFingerprint([paperIds[0], paperIds[1], paperIds[1]]))
      .toBe(fingerprint);
  });
});

describe("Paper comparison mutation lifecycle", () => {
  const spaceX = "space-x";
  const spaceY = "space-y";
  const selection = paperIds.slice(0, 2);
  const otherSelection = paperIds.slice(1, 3);
  const submitted = createPaperComparisonMutationOwnership(spaceX, selection);

  it("keeps a submitted result current only for the same Space and selection", () => {
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceX, paperIds: selection },
      submitted,
      status: "success",
    })).toBe("result");

    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceX, paperIds: otherSelection },
      submitted,
      status: "success",
    })).toBe("idle");
  });

  it("makes a same-Space error stale when the selection changes", () => {
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceX, paperIds: otherSelection },
      submitted,
      status: "error",
      errorCode: "comparison_unavailable",
    })).toBe("idle");
  });

  it("makes Space X result and error stale in Space Y even with identical paper IDs", () => {
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceY, paperIds: selection },
      submitted,
      status: "success",
    })).toBe("idle");
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceY, paperIds: selection },
      submitted,
      status: "error",
      errorCode: "comparison_unavailable",
    })).toBe("idle");
  });

  it("makes a mutation stale when both Space and paper IDs change", () => {
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceY, paperIds: otherSelection },
      submitted,
      status: "success",
    })).toBe("idle");
  });

  it("keeps current-Space space_not_found as an access error after selection changes", () => {
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceX, paperIds: otherSelection },
      submitted,
      status: "error",
      errorCode: "space_not_found",
    })).toBe("space_unavailable");
  });

  it("does not carry old-Space space_not_found into the destination Space", () => {
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceY, paperIds: selection },
      submitted,
      status: "error",
      errorCode: "space_not_found",
    })).toBe("idle");
  });

  it("follows Back and Forward selection changes for result visibility", () => {
    const view = (paperIdsForLocation: string[]) => getPaperComparisonMutationView({
      current: { spaceId: spaceX, paperIds: paperIdsForLocation },
      submitted,
      status: "success",
    });

    expect(view(selection)).toBe("result");
    expect(view(otherSelection)).toBe("idle");
    expect(view(selection)).toBe("result");
  });

  it("restores URL selection after refresh without restoring a result state", () => {
    const restored = parsePaperComparisonSearchParams(
      createPaperComparisonSearchParams(selection),
    );

    expect(restored.paperIds).toEqual(selection);
    expect(getPaperComparisonMutationView({
      current: { spaceId: spaceX, paperIds: restored.paperIds },
      submitted: undefined,
      status: "idle",
    })).toBe("idle");
  });

  it("clones the submitted paper IDs into the Space-scoped mutation variables", () => {
    const mutableSelection = [...selection];
    const ownership = createPaperComparisonMutationOwnership(spaceX, mutableSelection);

    mutableSelection[0] = paperIds[4];

    expect(ownership).toEqual({ spaceId: spaceX, paperIds: selection });
    expect(ownership.paperIds).not.toBe(mutableSelection);
  });
});
