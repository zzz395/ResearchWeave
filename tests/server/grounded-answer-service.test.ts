import { describe, expect, it, vi } from "vitest";

import type {
  GroundedAnswerGenerationResult,
  GroundedAnswerGenerator,
} from "../../server/integrations/grounded-answer/generator";
import {
  createGroundedAnswerService,
  INSUFFICIENT_CONTEXT_ANSWER,
} from "../../server/modules/grounded-answer/service";
import type { SemanticRetrievalService } from "../../server/modules/retrieval/service";
import type { SemanticRetrievalResult } from "../../shared/contracts/retrieval";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000001";

function source(
  suffix: string,
  content: string,
  overrides: Partial<SemanticRetrievalResult> = {},
): SemanticRetrievalResult {
  return {
    documentId: `30000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    originalFilename: `source-${suffix}.txt`,
    ordinal: Number(suffix),
    content,
    contentHash: suffix.padStart(64, "0"),
    pageNumber: null,
    startOffset: 0,
    endOffset: content.length,
    cosineDistance: Number(suffix) / 10,
    ...overrides,
  };
}

function harness(input: {
  results: SemanticRetrievalResult[];
  generated?: GroundedAnswerGenerationResult;
  memberships?: boolean[];
}) {
  const retrieve = vi.fn<SemanticRetrievalService["retrieve"]>(() =>
    Promise.resolve({ results: input.results }),
  );
  const generate = vi.fn<GroundedAnswerGenerator["generate"]>(() =>
    Promise.resolve(
      input.generated ?? {
        status: "answered",
        answer: "Supported by the first source. [S1]",
        sourceIds: ["S1"],
      },
    ),
  );
  const memberships = [...(input.memberships ?? [true])];
  const hasMembership = vi.fn(() => Promise.resolve(memberships.shift() ?? true));
  const service = createGroundedAnswerService(
    { retrieve },
    { hasMembership },
    { model: "test-answer-model", generate },
  );
  return { service, retrieve, generate, hasMembership };
}

describe("GroundedAnswerService answerWithSources", () => {
  it("returns only cited source snapshots in validated citation order", async () => {
    const first = source("1", "First complete retrieved chunk.", {
      originalFilename: "first.pdf",
      ordinal: 4,
      pageNumber: 2,
      startOffset: 100,
      endOffset: 131,
    });
    const second = source("2", "Second complete retrieved chunk.", {
      originalFilename: "second.txt",
      ordinal: 7,
      startOffset: 20,
      endOffset: 52,
    });
    const uncited = source("3", "This retrieved chunk was not cited.");
    const { service } = harness({
      results: [first, second, uncited],
      generated: {
        status: "answered",
        answer: "Second adds detail. [S2] First establishes the rule. [S1] [S2]",
        sourceIds: ["S2", "S1"],
      },
    });

    const result = await service.answerWithSources(SPACE_ID, ACTOR_ID, {
      query: "Combine the evidence",
    });

    expect(result.response.status).toBe("answered");
    expect(result.response.citations.map((citation) => citation.sourceId)).toEqual(["S2", "S1"]);
    expect(result.sources).toEqual([
      {
        sourceId: "S2",
        documentId: second.documentId,
        originalFilename: second.originalFilename,
        ordinal: second.ordinal,
        contentHash: second.contentHash,
        pageNumber: second.pageNumber,
        startOffset: second.startOffset,
        endOffset: second.endOffset,
        content: second.content,
      },
      {
        sourceId: "S1",
        documentId: first.documentId,
        originalFilename: first.originalFilename,
        ordinal: first.ordinal,
        contentHash: first.contentHash,
        pageNumber: first.pageNumber,
        startOffset: first.startOffset,
        endOffset: first.endOffset,
        content: first.content,
      },
    ]);
    expect(JSON.stringify(result.sources)).not.toContain("cosineDistance");
    expect(JSON.stringify(result.sources)).not.toContain(uncited.content);
    expect(result.response.citations.every((citation) => !("content" in citation))).toBe(true);
  });

  it("returns no source snapshots when retrieval is empty", async () => {
    const { service, generate, hasMembership } = harness({ results: [] });

    await expect(
      service.answerWithSources(SPACE_ID, ACTOR_ID, { query: "No matching chunks" }),
    ).resolves.toEqual({
      response: {
        status: "insufficient_context",
        answer: INSUFFICIENT_CONTEXT_ANSWER,
        citations: [],
      },
      sources: [],
    });
    expect(generate).not.toHaveBeenCalled();
    expect(hasMembership).toHaveBeenCalledOnce();
  });

  it("returns no source snapshots when the generator abstains", async () => {
    const { service } = harness({
      results: [source("1", "Retrieved but insufficient source content.")],
      generated: {
        status: "insufficient_context",
        answer: "Provider-specific abstention text.",
        sourceIds: [],
      },
    });

    await expect(
      service.answerWithSources(SPACE_ID, ACTOR_ID, { query: "Can this be answered?" }),
    ).resolves.toEqual({
      response: {
        status: "insufficient_context",
        answer: INSUFFICIENT_CONTEXT_ANSWER,
        citations: [],
      },
      sources: [],
    });
  });

  it("keeps answer as a single-execution public projection without source content", async () => {
    const { service, retrieve, generate } = harness({
      results: [source("1", "Private source content for the internal boundary.")],
    });

    const response = await service.answer(SPACE_ID, ACTOR_ID, { query: "Public projection" });

    expect(response).toEqual({
      status: "answered",
      answer: "Supported by the first source. [S1]",
      citations: [
        {
          sourceId: "S1",
          documentId: "30000000-0000-4000-8000-000000000001",
          originalFilename: "source-1.txt",
          ordinal: 1,
          contentHash: "0".repeat(63) + "1",
          pageNumber: null,
          startOffset: 0,
          endOffset: 49,
        },
      ],
    });
    expect(response).not.toHaveProperty("sources");
    expect(JSON.stringify(response)).not.toContain("Private source content");
    expect(retrieve).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
  });

  it("does not release an answer or source snapshots after membership revocation", async () => {
    const { service } = harness({
      results: [source("1", "This result must be discarded.")],
      memberships: [false],
    });

    const pending = service.answerWithSources(SPACE_ID, ACTOR_ID, {
      query: "Revalidate membership",
    });
    await expect(pending).rejects.toMatchObject({
      statusCode: 404,
      code: "space_not_found",
    });
  });

  it("rejects invented generator provenance before returning snapshots", async () => {
    const { service } = harness({
      results: [source("1", "Trusted source content.")],
      generated: {
        status: "answered",
        answer: "Claim. [S1]",
        sourceIds: ["S1"],
        documentId: "30000000-0000-4000-8000-000000000099",
      } as GroundedAnswerGenerationResult,
    });

    await expect(
      service.answerWithSources(SPACE_ID, ACTOR_ID, { query: "Reject invented metadata" }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "answer_invalid_response",
    });
  });
});
