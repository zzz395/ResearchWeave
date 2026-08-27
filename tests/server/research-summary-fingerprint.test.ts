import { describe, expect, it } from "vitest";

import type { PaperRecord } from "../../server/db/schema";
import {
  createSummarySourceFingerprint,
  toPaperSummarySource,
} from "../../server/modules/research/summary-fingerprint";

const paper: PaperRecord = {
  id: "10000000-0000-4000-8000-000000000001",
  canonicalArxivId: "2401.00001",
  versionedArxivId: "2401.00001v2",
  version: 2,
  title: "Grounded summaries",
  abstract: "An abstract containing supported information.",
  authors: ["Ada Researcher"],
  primaryCategory: "cs.AI",
  categories: ["cs.AI", "cs.CL"],
  publishedAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  comment: "comment",
  journalRef: "Journal 1",
  doi: "10.1000/example",
  absUrl: "https://arxiv.org/abs/2401.00001v2",
  pdfUrl: "https://arxiv.org/pdf/2401.00001v2",
  fetchedAt: new Date("2025-01-03T00:00:00.000Z"),
};

function fingerprint(changes: Partial<PaperRecord> = {}) {
  return createSummarySourceFingerprint(toPaperSummarySource({ ...paper, ...changes }));
}

describe("paper summary source fingerprint", () => {
  it("is deterministic and changes for every grounded fingerprint field", () => {
    expect(fingerprint()).toBe(fingerprint());
    expect(fingerprint()).toMatch(/^[0-9a-f]{64}$/u);
    expect(fingerprint({ abstract: "Changed abstract" })).not.toBe(fingerprint());
    expect(fingerprint({ title: "Changed title" })).not.toBe(fingerprint());
    expect(fingerprint({ versionedArxivId: "2401.00001v3" })).not.toBe(fingerprint());
    expect(fingerprint({ version: 3 })).not.toBe(fingerprint());
    expect(fingerprint({ authors: ["Another Author"] })).not.toBe(fingerprint());
    expect(fingerprint({ primaryCategory: "cs.CL" })).not.toBe(fingerprint());
    expect(fingerprint({ categories: ["cs.AI"] })).not.toBe(fingerprint());
    expect(fingerprint({ publishedAt: new Date("2024-12-01T00:00:00.000Z") })).not.toBe(
      fingerprint(),
    );
    expect(fingerprint({ updatedAt: new Date("2025-01-04T00:00:00.000Z") })).not.toBe(
      fingerprint(),
    );
  });

  it("ignores persistence metadata that is outside the generation source fingerprint", () => {
    expect(fingerprint({ doi: "10.1000/changed" })).toBe(fingerprint());
    expect(fingerprint({ journalRef: "Another journal" })).toBe(fingerprint());
    expect(fingerprint({ comment: "Changed comment" })).toBe(fingerprint());
    expect(fingerprint({ fetchedAt: new Date("2030-01-01T00:00:00.000Z") })).toBe(
      fingerprint(),
    );
  });
});
