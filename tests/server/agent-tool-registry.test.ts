import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import type { AgentErrorCode } from "../../shared/contracts/agents";
import type { PersistentResearchPaper } from "../../shared/contracts/research";
import { AppError } from "../../server/middleware/app-error";
import type { GroundedAnswerService } from "../../server/modules/grounded-answer/service";
import type { ResearchService } from "../../server/modules/research/service";
import type { SemanticRetrievalService } from "../../server/modules/retrieval/service";
import type { SpaceService } from "../../server/modules/spaces/service";
import {
  agentToolExecutionResultSchema,
  AgentToolError,
  isAgentToolError,
  type AgentToolContext,
} from "../../server/modules/agents/tools/contracts";
import { truncateUnicode } from "../../server/modules/agents/tools/helpers";
import {
  createAgentToolRegistry,
  createResearchAgentToolRegistry,
} from "../../server/modules/agents/tools/registry";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000001";
const PAPER_ID = "30000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);

function space() {
  return {
    id: SPACE_ID,
    name: "Agent tools",
    description: null,
    ownerId: ACTOR_ID,
    role: "owner" as const,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
}

function paper(overrides: Partial<PersistentResearchPaper> = {}): PersistentResearchPaper {
  return {
    id: PAPER_ID,
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v2",
    version: 2,
    title: "Bounded agent systems",
    abstract: "A grounded abstract.",
    authors: ["Ada Lovelace", "Grace Hopper"],
    primaryCategory: "cs.AI",
    categories: ["cs.AI"],
    publishedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    absUrl: "https://arxiv.org/abs/2609.00001v2",
    pdfUrl: "https://arxiv.org/pdf/2609.00001v2",
    fetchedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

function researchResult(papers = [paper()]) {
  return {
    totalResults: papers.length,
    startIndex: 0,
    itemsPerPage: papers.length,
    papers,
  };
}

function retrievalResult(content = "A retrieved knowledge chunk.") {
  return {
    documentId: DOCUMENT_ID,
    originalFilename: "knowledge.pdf",
    ordinal: 4,
    content,
    contentHash: HASH,
    pageNumber: 3,
    startOffset: 120,
    endOffset: 120 + content.length,
    cosineDistance: 0.125,
  };
}

function answeredGroundedResult(content = "A cited source chunk.") {
  return {
    response: {
      status: "answered" as const,
      answer: "The grounded answer. [S1]",
      citations: [
        {
          sourceId: "S1",
          documentId: DOCUMENT_ID,
          originalFilename: "knowledge.pdf",
          ordinal: 4,
          contentHash: HASH,
          pageNumber: 3,
          startOffset: 120,
          endOffset: 120 + content.length,
        },
      ],
    },
    sources: [
      {
        sourceId: "S1",
        documentId: DOCUMENT_ID,
        originalFilename: "knowledge.pdf",
        ordinal: 4,
        contentHash: HASH,
        pageNumber: 3,
        startOffset: 120,
        endOffset: 120 + content.length,
        content,
      },
    ],
  };
}

function harness() {
  const getSpace = vi.fn<SpaceService["getSpace"]>(() => Promise.resolve(space()));
  const searchPapers = vi.fn<ResearchService["searchPapers"]>(() =>
    Promise.resolve(researchResult()),
  );
  const retrieve = vi.fn<SemanticRetrievalService["retrieve"]>(() =>
    Promise.resolve({ results: [retrievalResult()] }),
  );
  const answer = vi.fn<GroundedAnswerService["answer"]>();
  const answerWithSources = vi.fn<GroundedAnswerService["answerWithSources"]>(() =>
    Promise.resolve(answeredGroundedResult()),
  );
  const groundedAnswerService: GroundedAnswerService = { answer, answerWithSources };
  const registry = createResearchAgentToolRegistry({
    spaceService: { getSpace },
    researchService: { searchPapers },
    semanticRetrievalService: { retrieve },
    groundedAnswerService,
  });
  return { registry, getSpace, searchPapers, retrieve, answer, answerWithSources };
}

function context(controller = new AbortController()): AgentToolContext {
  return { spaceId: SPACE_ID, actorUserId: ACTOR_ID, signal: controller.signal };
}

async function capturedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

function expectSafeToolError(error: unknown, code: AgentErrorCode): void {
  expect(isAgentToolError(error)).toBe(true);
  expect(error).toMatchObject({ code });
  expect(JSON.stringify(error)).toBe(JSON.stringify({ code }));
  expect((error as AgentToolError).stack).toBeUndefined();
}

type RegistrableTool = Parameters<typeof createAgentToolRegistry>[0][number];

function fakeTool(overrides: Partial<RegistrableTool> = {}): RegistrableTool {
  return {
    name: "search_arxiv",
    description: "A test tool.",
    argumentsSchema: z.object({ query: z.string() }).strict(),
    resultSchema: agentToolExecutionResultSchema,
    isAvailable: () => true,
    execute: () => Promise.resolve({ observation: { ok: true }, evidence: [] }),
    ...overrides,
  };
}

describe("AgentToolRegistry", () => {
  it("exposes exactly the three fixed frozen descriptors in allowed order", () => {
    const { registry } = harness();
    const descriptors = registry.descriptorsFor([
      "search_knowledge_base",
      "ask_knowledge",
      "search_arxiv",
    ]);

    expect(descriptors.map((item) => item.name)).toEqual([
      "search_knowledge_base",
      "ask_knowledge",
      "search_arxiv",
    ]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(descriptors)).toBe(true);
    expect(descriptors.every(Object.isFrozen)).toBe(true);
    expect(descriptors.every((descriptor) => !("execute" in descriptor))).toBe(true);
    expect("register" in registry).toBe(false);
    expect("unregister" in registry).toBe(false);
    expect(registry.descriptorsFor(descriptors.map((item) => item.name))).toEqual(descriptors);
  });

  it("copies construction input, rejects duplicates, and ignores unavailable registrations", () => {
    const original = fakeTool();
    const input: RegistrableTool[] = [original];
    const registry = createAgentToolRegistry(input);
    input.splice(0, input.length, fakeTool({ name: "ask_knowledge" }));
    (original as { description: string }).description = "Mutated outside the registry.";

    const descriptors = registry.descriptorsFor(["search_arxiv", "ask_knowledge"]);
    expect(descriptors.map((item) => item.name)).toEqual(["search_arxiv"]);
    expect(descriptors[0]?.description).toBe("A test tool.");
    expect(() => createAgentToolRegistry([fakeTool(), fakeTool()])).toThrow(
      "Duplicate Agent tool name",
    );
    const unavailable = createAgentToolRegistry([
      fakeTool({ isAvailable: () => false }),
    ]);
    expect(unavailable.descriptorsFor(["search_arxiv"])).toEqual([]);
    expect(() => unavailable.prepareCall(["search_arxiv"], "search_arxiv", { query: "x" }))
      .toThrowError(expect.objectContaining({ code: "agent_tool_not_allowed" }));
  });

  it.each([
    ["unknown", ["search_arxiv"]],
    ["ask_knowledge", ["search_arxiv"]],
    ["search_knowledge_base", ["search_knowledge_base"]],
  ] as const)("maps unavailable call %s to the same safe error", (rawName, allowed) => {
    const registry = createAgentToolRegistry([fakeTool()]);
    expect(() => registry.prepareCall(allowed, rawName, {})).toThrowError(
      expect.objectContaining({ code: "agent_tool_not_allowed" }),
    );
  });

  it("strictly validates and freezes normalized safe arguments without executing", () => {
    const { registry, searchPapers } = harness();
    const prepared = registry.prepareCall(
      ["search_arxiv"],
      "search_arxiv",
      { query: "  graph\n\t agents  " },
    );

    expect(prepared.toolName).toBe("search_arxiv");
    expect(prepared.safeArguments).toEqual({
      query: "graph agents",
      page: 1,
      pageSize: 5,
      sort: "relevance",
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.safeArguments)).toBe(true);
    expect(searchPapers).not.toHaveBeenCalled();
    for (const invalid of [
      { query: "x" },
      { query: "valid", page: 21 },
      { query: "valid", pageSize: 0 },
      { query: "valid", sort: "newest" },
      { query: "valid", extra: true },
      { query: 42 },
    ]) {
      expect(() => registry.prepareCall(["search_arxiv"], "search_arxiv", invalid)).toThrowError(
        expect.objectContaining({ code: "agent_tool_invalid_arguments" }),
      );
    }
  });

  it("keeps a prepared call repeatable", async () => {
    const { registry, getSpace, searchPapers } = harness();
    const prepared = registry.prepareCall(
      ["search_arxiv"],
      "search_arxiv",
      { query: "repeatable call" },
    );

    const first = await prepared.execute(context());
    const second = await prepared.execute(context());
    expect(second).toEqual(first);
    expect(getSpace).toHaveBeenCalledTimes(2);
    expect(searchPapers).toHaveBeenCalledTimes(2);
  });

  it("validates tool-specific and global result schemas", async () => {
    const malformed = createAgentToolRegistry([
      fakeTool({
        resultSchema: z
          .object({ observation: z.object({ ok: z.literal(true) }).strict(), evidence: z.array(z.never()) })
          .strict() as unknown as RegistrableTool["resultSchema"],
        execute: () =>
          Promise.resolve({ observation: { ok: true, leaked: true }, evidence: [] }),
      }),
    ]);
    expectSafeToolError(
      await capturedError(
        malformed
          .prepareCall(["search_arxiv"], "search_arxiv", { query: "valid" })
          .execute(context()),
      ),
      "agent_tool_invalid_response",
    );

    const oversized = createAgentToolRegistry([
      fakeTool({
        resultSchema: z.unknown() as unknown as RegistrableTool["resultSchema"],
        execute: () =>
          Promise.resolve({ observation: { content: "x".repeat(40_000) }, evidence: [] }),
      }),
    ]);
    expectSafeToolError(
      await capturedError(
        oversized
          .prepareCall(["search_arxiv"], "search_arxiv", { query: "valid" })
          .execute(context()),
      ),
      "agent_tool_invalid_response",
    );
  });
});

describe("fixed Agent tool adapters", () => {
  it("authorizes first and does not delegate when Space access is revoked", async () => {
    const tools = harness();
    tools.getSpace.mockRejectedValueOnce(
      new AppError(404, "space_not_found", "Hidden membership detail."),
    );
    const prepared = tools.registry.prepareCall(
      ["search_arxiv"],
      "search_arxiv",
      { query: "agents" },
    );

    expectSafeToolError(
      await capturedError(prepared.execute(context())),
      "agent_space_access_revoked",
    );
    expect(tools.getSpace).toHaveBeenCalledWith(SPACE_ID, ACTOR_ID);
    expect(tools.searchPapers).not.toHaveBeenCalled();
  });

  it.each([
    ["search_arxiv", "searchPapers"],
    ["search_knowledge_base", "retrieve"],
    ["ask_knowledge", "answerWithSources"],
  ] as const)("authorizes before every %s delegation", async (toolName, delegateName) => {
    const tools = harness();
    await tools.registry
      .prepareCall([toolName], toolName, { query: "authorized call" })
      .execute(context());

    const authorizationOrder = tools.getSpace.mock.invocationCallOrder[0];
    const delegateOrder = tools[delegateName].mock.invocationCallOrder[0];
    expect(authorizationOrder).toBeLessThan(delegateOrder ?? 0);
  });

  it("normalizes arXiv results into bounded observations and exact abstract evidence", async () => {
    const tools = harness();
    const longAuthors = Array.from({ length: 11 }, (_, index) =>
      `${index}-${"😀".repeat(130)}`,
    );
    const papers = Array.from({ length: 7 }, (_, index) => {
      const identity = {
        id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        canonicalArxivId: `2609.${String(index + 1).padStart(5, "0")}`,
        versionedArxivId: `2609.${String(index + 1).padStart(5, "0")}v2`,
      };
      return index === 0
        ? paper({
        ...identity,
        title: `T${"😀".repeat(600)}`,
        abstract: `A${"🧪".repeat(2_100)}`,
        authors: longAuthors,
        absUrl: `https://arxiv.org/abs/${"a".repeat(1_100)}`,
        pdfUrl: `https://arxiv.org/pdf/${"b".repeat(1_100)}`,
          })
        : paper(identity);
    });
    tools.searchPapers.mockResolvedValueOnce(researchResult(papers));
    const result = await tools.registry
      .prepareCall(["search_arxiv"], "search_arxiv", {
        query: "  tool\n registry ",
        page: 2,
        pageSize: 5,
        sort: "updated",
      })
      .execute(context());

    expect(tools.searchPapers).toHaveBeenCalledWith({
      q: "tool registry",
      page: 2,
      pageSize: 5,
      sort: "updated",
    });
    const observation = result.observation as {
      resultCount: number;
      papers: Array<Record<string, unknown>>;
    };
    expect(observation.resultCount).toBe(5);
    expect(observation.papers).toHaveLength(5);
    expect(result.evidence).toHaveLength(5);
    expect(Array.from(observation.papers[0]?.title as string).length).toBeLessThanOrEqual(500);
    expect(observation.papers[0]?.authors).toHaveLength(8);
    expect(observation.papers[0]?.remainingAuthorCount).toBe(3);
    expect(
      Array.from((observation.papers[0]?.authors as string[])[0] ?? "").length,
    ).toBeLessThanOrEqual(120);
    expect(Array.from(observation.papers[0]?.absUrl as string)).toHaveLength(1_000);
    expect(Array.from(observation.papers[0]?.pdfUrl as string)).toHaveLength(1_000);
    expect(
      Array.from(observation.papers[0]?.abstractExcerpt as string).length,
    ).toBeLessThanOrEqual(2_000);
    expect(result.evidence[0]).toMatchObject({
      kind: "arxiv_abstract",
      paperId: papers[0]?.id,
      canonicalArxivId: papers[0]?.canonicalArxivId,
      versionedArxivId: papers[0]?.versionedArxivId,
      sourceVersion: 2,
      url: papers[0]?.absUrl,
    });
    expect(result.evidence[0]).not.toHaveProperty("id");
    expect(JSON.stringify(result)).not.toContain("primaryCategory");
    expect(JSON.stringify(result)).not.toContain("categories");
  });

  it("rejects a fixed-tool observation that exceeds 32 KiB after field truncation", async () => {
    const tools = harness();
    const oversizedPapers = Array.from({ length: 5 }, (_, index) =>
      paper({
        id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        canonicalArxivId: `2609.${String(index + 1).padStart(5, "0")}`,
        versionedArxivId: `2609.${String(index + 1).padStart(5, "0")}v2`,
        title: "😀".repeat(600),
        abstract: "🧪".repeat(2_100),
        authors: Array.from({ length: 8 }, () => "🧑".repeat(130)),
        absUrl: `https://arxiv.org/abs/${"a".repeat(900)}`,
        pdfUrl: `https://arxiv.org/pdf/${"b".repeat(900)}`,
      }),
    );
    tools.searchPapers.mockResolvedValueOnce(researchResult(oversizedPapers));
    const error = await capturedError(
      tools.registry
        .prepareCall(["search_arxiv"], "search_arxiv", { query: "oversized output" })
        .execute(context()),
    );

    expectSafeToolError(error, "agent_tool_invalid_response");
  });

  it("applies strict defaults and ranges to both knowledge tool argument schemas", () => {
    const { registry } = harness();
    expect(
      registry.prepareCall(["search_knowledge_base"], "search_knowledge_base", {
        query: "  retrieve  ",
      }).safeArguments,
    ).toEqual({ query: "retrieve", limit: 8 });
    expect(
      registry.prepareCall(["ask_knowledge"], "ask_knowledge", {
        query: "  answer  ",
      }).safeArguments,
    ).toEqual({ query: "answer" });
    for (const [toolName, arguments_] of [
      ["search_knowledge_base", { query: "valid", limit: 9 }],
      ["search_knowledge_base", { query: "valid", extra: true }],
      ["ask_knowledge", { query: "x" }],
      ["ask_knowledge", { query: "valid", extra: true }],
    ] as const) {
      expect(() => registry.prepareCall([toolName], toolName, arguments_)).toThrowError(
        expect.objectContaining({ code: "agent_tool_invalid_arguments" }),
      );
    }
  });

  it("preserves retrieval order and locator provenance without distances or full chunks", async () => {
    const tools = harness();
    const sourceContent = `Start ${"😀".repeat(1_100)}`;
    const results = Array.from({ length: 10 }, (_, index) => ({
      ...retrievalResult(sourceContent),
      documentId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ordinal: index + 3,
      contentHash: index.toString(16).padStart(64, "0"),
      cosineDistance: index / 10,
    }));
    tools.retrieve.mockResolvedValueOnce({ results });
    const result = await tools.registry
      .prepareCall(["search_knowledge_base"], "search_knowledge_base", {
        query: "  grounded chunks  ",
      })
      .execute(context());

    expect(tools.retrieve).toHaveBeenCalledWith(SPACE_ID, ACTOR_ID, {
      query: "grounded chunks",
      limit: 8,
    });
    const observation = result.observation as {
      resultCount: number;
      results: Array<Record<string, unknown>>;
    };
    expect(observation.resultCount).toBe(8);
    expect(observation.results.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(observation.results.map((item) => item.documentId)).toEqual(
      results.slice(0, 8).map((item) => item.documentId),
    );
    expect(Array.from(observation.results[0]?.excerpt as string).length).toBeLessThanOrEqual(1_000);
    expect(result.evidence[0]).toMatchObject({
      kind: "knowledge_chunk",
      documentId: results[0]?.documentId,
      ordinal: results[0]?.ordinal,
      contentHash: results[0]?.contentHash,
      pageNumber: 3,
      startOffset: 120,
      endOffset: 120 + sourceContent.length,
    });
    expect(JSON.stringify(result)).not.toContain("cosineDistance");
    expect(JSON.stringify(result)).not.toContain(sourceContent);
  });

  it("uses the single grounded source pipeline and emits only cited knowledge evidence", async () => {
    const tools = harness();
    const content = `Cited ${"🧠".repeat(1_100)}`;
    tools.answerWithSources.mockResolvedValueOnce(answeredGroundedResult(content));
    const result = await tools.registry
      .prepareCall(["ask_knowledge"], "ask_knowledge", { query: "  answer this  " })
      .execute(context());

    expect(tools.answerWithSources).toHaveBeenCalledOnce();
    expect(tools.answerWithSources).toHaveBeenCalledWith(SPACE_ID, ACTOR_ID, {
      query: "answer this",
    });
    expect(tools.answer).not.toHaveBeenCalled();
    expect(tools.retrieve).not.toHaveBeenCalled();
    expect(result.observation).toMatchObject({
      status: "answered",
      answer: "The grounded answer. [S1]",
      citations: [{ sourceId: "S1", localEvidenceOrdinal: 1 }],
    });
    expect(Array.from(result.evidence[0]?.excerpt ?? "").length).toBeLessThanOrEqual(1_000);
    expect(result.evidence).toHaveLength(1);
  });

  it.each([
    ["source ID", { sourceId: "S2" }],
    ["document provenance", { documentId: "40000000-0000-4000-8000-000000000099" }],
    ["content hash", { contentHash: "b".repeat(64) }],
  ] as const)("rejects mismatched grounded %s", async (_label, sourceOverride) => {
    const tools = harness();
    const value = answeredGroundedResult();
    value.sources[0] = { ...value.sources[0], ...sourceOverride };
    tools.answerWithSources.mockResolvedValueOnce(value);
    const error = await capturedError(
      tools.registry
        .prepareCall(["ask_knowledge"], "ask_knowledge", { query: "validate sources" })
        .execute(context()),
    );
    expectSafeToolError(error, "agent_tool_invalid_response");
  });

  it("rejects missing and reordered grounded sources", async () => {
    const tools = harness();
    const first = answeredGroundedResult("First source.");
    const secondDocumentId = "40000000-0000-4000-8000-000000000002";
    const secondCitation = {
      ...first.response.citations[0],
      sourceId: "S2",
      documentId: secondDocumentId,
      contentHash: "b".repeat(64),
    };
    const secondSource = {
      ...first.sources[0],
      ...secondCitation,
      content: "Second source.",
    };
    first.response.citations.push(secondCitation);
    first.sources.push(secondSource);

    for (const sources of [[first.sources[0]], [first.sources[1], first.sources[0]]]) {
      tools.answerWithSources.mockResolvedValueOnce({ ...first, sources });
      const error = await capturedError(
        tools.registry
          .prepareCall(["ask_knowledge"], "ask_knowledge", { query: "validate order" })
          .execute(context()),
      );
      expectSafeToolError(error, "agent_tool_invalid_response");
    }
  });

  it("keeps insufficient context successful and evidence-free", async () => {
    const tools = harness();
    tools.answerWithSources.mockResolvedValueOnce({
      response: {
        status: "insufficient_context",
        answer: "The available knowledge does not provide enough information to answer this question.",
        citations: [],
      },
      sources: [],
    });
    const result = await tools.registry
      .prepareCall(["ask_knowledge"], "ask_knowledge", { query: "unknown answer" })
      .execute(context());

    expect(result).toEqual({
      observation: {
        status: "insufficient_context",
        answer: "The available knowledge does not provide enough information to answer this question.",
        citations: [],
      },
      evidence: [],
    });
  });

  it("rejects malformed service results through the safe output boundary", async () => {
    const tools = harness();
    tools.retrieve.mockResolvedValueOnce({
      results: [{ ...retrievalResult(), documentId: "not-a-uuid" }],
    });
    expectSafeToolError(
      await capturedError(
        tools.registry
          .prepareCall(["search_knowledge_base"], "search_knowledge_base", { query: "valid" })
          .execute(context()),
      ),
      "agent_tool_invalid_response",
    );
  });
});

describe("Agent tool safe failures and abort boundaries", () => {
  const arxivCodes = [
    "research_temporarily_unavailable",
    "research_upstream_failure",
    "research_upstream_timeout",
  ] as const;
  const retrievalCodes = [
    "knowledge_not_indexed",
    "knowledge_embedding_incompatible",
    "retrieval_embedding_unconfigured",
    "retrieval_embedding_unavailable",
    "retrieval_embedding_rejected",
    "retrieval_embedding_invalid_response",
  ] as const;
  const answerCodes = [
    ...retrievalCodes,
    "answer_generation_unavailable",
    "answer_invalid_response",
    "answer_upstream_failure",
    "answer_upstream_timeout",
  ] as const;

  it.each([
    ...arxivCodes.map((code) => ["search_arxiv", code] as const),
    ...retrievalCodes.map((code) => ["search_knowledge_base", code] as const),
    ...answerCodes.map((code) => ["ask_knowledge", code] as const),
  ])("allows the safe %s error %s", async (toolName, code) => {
    const tools = harness();
    const failure = new AppError(502, code, "secret provider response", { body: "secret" });
    if (toolName === "search_arxiv") tools.searchPapers.mockRejectedValueOnce(failure);
    if (toolName === "search_knowledge_base") tools.retrieve.mockRejectedValueOnce(failure);
    if (toolName === "ask_knowledge") tools.answerWithSources.mockRejectedValueOnce(failure);
    const error = await capturedError(
      tools.registry
        .prepareCall([toolName], toolName, { query: "valid query" })
        .execute(context()),
    );

    expectSafeToolError(error, code);
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it.each([new AppError(500, "unexpected_code", "secret", { body: "secret" }), new Error("secret")])(
    "sanitizes an unexpected failure",
    async (failure) => {
      const tools = harness();
      tools.searchPapers.mockRejectedValueOnce(failure);
      const error = await capturedError(
        tools.registry
          .prepareCall(["search_arxiv"], "search_arxiv", { query: "valid query" })
          .execute(context()),
      );
      expectSafeToolError(error, "agent_tool_invalid_response");
      expect(JSON.stringify(error)).not.toContain("secret");
    },
  );

  it("preserves an abort that exists before authorization", async () => {
    const tools = harness();
    const controller = new AbortController();
    const reason = new Error("cancelled by executor");
    controller.abort(reason);
    const error = await capturedError(
      tools.registry
        .prepareCall(["search_arxiv"], "search_arxiv", { query: "valid query" })
        .execute(context(controller)),
    );

    expect(error).toBe(reason);
    expect(tools.getSpace).not.toHaveBeenCalled();
    expect(tools.searchPapers).not.toHaveBeenCalled();
  });

  it("preserves an abort after authorization and before delegation", async () => {
    const tools = harness();
    const controller = new AbortController();
    const reason = new Error("cancel before delegate");
    tools.getSpace.mockImplementationOnce(() => {
      controller.abort(reason);
      return Promise.resolve(space());
    });
    const error = await capturedError(
      tools.registry
        .prepareCall(["search_arxiv"], "search_arxiv", { query: "valid query" })
        .execute(context(controller)),
    );

    expect(error).toBe(reason);
    expect(tools.searchPapers).not.toHaveBeenCalled();
  });

  it("preserves the signal reason when a pending delegate rejects after abort", async () => {
    const tools = harness();
    const controller = new AbortController();
    const reason = new Error("tool timeout");
    let rejectDelegate: ((reason?: unknown) => void) | undefined;
    tools.searchPapers.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectDelegate = reject; }),
    );
    const pending = tools.registry
      .prepareCall(["search_arxiv"], "search_arxiv", { query: "valid query" })
      .execute(context(controller));
    await vi.waitFor(() => expect(tools.searchPapers).toHaveBeenCalledOnce());
    controller.abort(reason);
    rejectDelegate?.(new Error("upstream abort detail"));

    expect(await capturedError(pending)).toBe(reason);
  });

  it("discards a delegate result when the signal aborts before normalization returns", async () => {
    const tools = harness();
    const controller = new AbortController();
    const reason = new Error("cancel after service result");
    tools.searchPapers.mockImplementationOnce(() => {
      controller.abort(reason);
      return Promise.resolve(researchResult());
    });
    const error = await capturedError(
      tools.registry
        .prepareCall(["search_arxiv"], "search_arxiv", { query: "valid query" })
        .execute(context(controller)),
    );

    expect(error).toBe(reason);
  });
});

describe("Unicode tool output truncation", () => {
  it("counts Unicode code points and keeps the ellipsis inside the limit", () => {
    const value = `A${"😀".repeat(5)}Z`;
    const truncated = truncateUnicode(value, 5);
    expect(truncated).toBe("A😀…");
    expect(Array.from(truncated).length).toBeLessThanOrEqual(5);
    expect(truncated.length).toBeLessThanOrEqual(5);
    expect(truncated).not.toContain("�");
  });

  it("rejects invalid limits", () => {
    expect(() => truncateUnicode("value", 0)).toThrow(TypeError);
    expect(() => truncateUnicode("value", 1.5)).toThrow(TypeError);
  });
});
