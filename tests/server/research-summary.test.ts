import request from "supertest";
import { describe, expect, it } from "vitest";

import type { PaperRecord } from "../../server/db/schema";
import { ResearchSummaryGeneratorError } from "../../server/integrations/research-summary/errors";
import type { ResearchSummaryGenerator } from "../../server/integrations/research-summary/generator";
import {
  CURRENT_SUMMARY_PROMPT_VERSION,
} from "../../server/modules/research/service";
import type { PaperSummarySource } from "../../server/modules/research/summary-fingerprint";
import { authResponseSchema } from "../../shared/contracts/auth";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import {
  nullableResearchPaperSummaryResponseSchema,
  researchPaperSummaryResponseSchema,
  type ResearchSummaryContent,
} from "../../shared/contracts/research";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;
const paperId = "10000000-0000-4000-8000-000000000001";
const unknownPaperId = "10000000-0000-4000-8000-000000000099";

const paper: PaperRecord = {
  id: paperId,
  canonicalArxivId: "2401.00001",
  versionedArxivId: "2401.00001v1",
  version: 1,
  title: "Abstract-grounded summaries",
  abstract: "This abstract explicitly describes a grounded summary method.",
  authors: ["Ada Researcher"],
  primaryCategory: "cs.AI",
  categories: ["cs.AI"],
  publishedAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  comment: null,
  journalRef: null,
  doi: null,
  absUrl: "https://arxiv.org/abs/2401.00001v1",
  pdfUrl: "https://arxiv.org/pdf/2401.00001v1",
  fetchedAt: new Date("2025-01-03T00:00:00.000Z"),
};

const generatedContent: ResearchSummaryContent = {
  overview: "A summary grounded in the supplied abstract.",
  keyContributions: ["It describes an abstract-grounded method."],
  methodHighlights: [],
  findings: [],
  caveats: [],
};

class FakeResearchSummaryGenerator implements ResearchSummaryGenerator {
  readonly model = "fake-summary-model";
  readonly calls: PaperSummarySource[] = [];
  handler: (source: PaperSummarySource) => Promise<ResearchSummaryContent> = () =>
    Promise.resolve(generatedContent);

  generate(source: PaperSummarySource) {
    this.calls.push(source);
    return this.handler(source);
  }
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

async function register(agent: ReturnType<typeof request.agent>, email = "summary@example.com") {
  const response = await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ email, displayName: "Summary Reader", password: "secure-password" })
    .expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function setup(generator?: ResearchSummaryGenerator) {
  const harness = createTestApp(undefined, undefined, generator);
  await harness.paperRepository.upsertMany([paper]);
  const actor = request.agent(harness.app);
  await register(actor);
  return { ...harness, actor, path: `/api/v1/research/papers/${paperId}/summary` };
}

describe("Research paper summary API", () => {
  it("requires authentication for GET and PUT", async () => {
    const { app } = createTestApp();
    await request(app).get(`/api/v1/research/papers/${paperId}/summary`).expect(401);
    await request(app)
      .put(`/api/v1/research/papers/${paperId}/summary`)
      .set("Origin", origin)
      .send({})
      .expect(401);
  });

  it("returns paper_not_found for unknown internal UUIDs", async () => {
    const generator = new FakeResearchSummaryGenerator();
    const { actor } = await setup(generator);
    const path = `/api/v1/research/papers/${unknownPaperId}/summary`;
    for (const response of [
      await actor.get(path).expect(404),
      await actor.put(path).set("Origin", origin).send({}).expect(404),
    ]) {
      expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("paper_not_found");
    }
    expect(generator.calls).toHaveLength(0);
  });

  it("returns null before generation, creates once, and reuses a fresh summary without writes", async () => {
    const generator = new FakeResearchSummaryGenerator();
    const { actor, path, summaryRepository } = await setup(generator);

    const before = nullableResearchPaperSummaryResponseSchema.parse(
      (await actor.get(path).expect(200)).body,
    );
    expect(before.summary).toBeNull();
    expect(generator.calls).toHaveLength(0);

    const created = researchPaperSummaryResponseSchema.parse(
      (await actor.put(path).set("Origin", origin).send({}).expect(201)).body,
    ).summary;
    expect(created).toMatchObject({
      paperId,
      ...generatedContent,
      sourceVersion: 1,
      model: generator.model,
      promptVersion: CURRENT_SUMMARY_PROMPT_VERSION,
    });
    expect(generator.calls).toHaveLength(1);

    const after = nullableResearchPaperSummaryResponseSchema.parse(
      (await actor.get(path).expect(200)).body,
    ).summary;
    expect(after).toEqual(created);

    const persistedBefore = summaryRepository.summaries.get(paperId);
    const repeated = researchPaperSummaryResponseSchema.parse(
      (await actor.put(path).set("Origin", origin).send({}).expect(200)).body,
    ).summary;
    expect(repeated).toEqual(created);
    expect(summaryRepository.summaries.get(paperId)).toBe(persistedBefore);
    expect(generator.calls).toHaveLength(1);
  });

  it("strictly rejects client-controlled generation fields", async () => {
    const generator = new FakeResearchSummaryGenerator();
    const { actor, path } = await setup(generator);
    await actor
      .put(path)
      .set("Origin", origin)
      .send({ model: "client-model", prompt: "invent", temperature: 1 })
      .expect(400);
    expect(generator.calls).toHaveLength(0);
  });

  it("treats source and prompt changes as stale and regenerates current content", async () => {
    const generator = new FakeResearchSummaryGenerator();
    const { actor, path, paperRepository, summaryRepository } = await setup(generator);
    await actor.put(path).set("Origin", origin).send({}).expect(201);

    paperRepository.papers.set(paperId, {
      ...paper,
      abstract: "A newer abstract is now the only grounding source.",
      updatedAt: new Date("2025-02-01T00:00:00.000Z"),
    });
    expect(nullableResearchPaperSummaryResponseSchema.parse(
      (await actor.get(path).expect(200)).body,
    ).summary).toBeNull();
    await actor.put(path).set("Origin", origin).send({}).expect(201);
    expect(generator.calls).toHaveLength(2);
    expect(generator.calls[1]?.abstract).toContain("newer abstract");

    const current = summaryRepository.summaries.get(paperId);
    if (!current) throw new Error("Expected a persisted summary fixture.");
    summaryRepository.summaries.set(paperId, { ...current, promptVersion: "old-prompt" });
    expect(nullableResearchPaperSummaryResponseSchema.parse(
      (await actor.get(path).expect(200)).body,
    ).summary).toBeNull();
    await actor.put(path).set("Origin", origin).send({}).expect(201);
    expect(generator.calls).toHaveLength(3);
  });

  it("keeps GET available but returns 503 for generation when LLM config is unavailable", async () => {
    const { actor, path } = await setup();
    expect(nullableResearchPaperSummaryResponseSchema.parse(
      (await actor.get(path).expect(200)).body,
    ).summary).toBeNull();
    const response = await actor.put(path).set("Origin", origin).send({}).expect(503);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("summary_unavailable");
  });

  it.each([
    ["SUMMARY_UPSTREAM_TIMEOUT", 504, "summary_upstream_timeout"],
    ["SUMMARY_UPSTREAM_FAILURE", 502, "summary_upstream_failure"],
    ["SUMMARY_INVALID_RESPONSE", 502, "summary_invalid_response"],
  ] as const)("maps %s without exposing generator details", async (code, status, apiCode) => {
    const generator = new FakeResearchSummaryGenerator();
    generator.handler = () => Promise.reject(
      new ResearchSummaryGeneratorError(code, "secret provider detail"),
    );
    const { actor, path, summaryRepository } = await setup(generator);
    const response = await actor.put(path).set("Origin", origin).send({}).expect(status);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(apiCode);
    expect(JSON.stringify(response.body)).not.toContain("secret provider detail");
    expect(summaryRepository.summaries.size).toBe(0);
  });

  it("rejects invalid fake generator output without replacing persistence", async () => {
    const generator = new FakeResearchSummaryGenerator();
    generator.handler = () => Promise.resolve({
      ...generatedContent,
      overview: "",
    });
    const { actor, path, summaryRepository } = await setup(generator);
    const response = await actor.put(path).set("Origin", origin).send({}).expect(502);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("summary_invalid_response");
    expect(summaryRepository.summaries.size).toBe(0);
  });

  it("coalesces concurrent PUT generation for the same paper source", async () => {
    const generator = new FakeResearchSummaryGenerator();
    const reached = deferred();
    const release = deferred();
    generator.handler = async () => {
      reached.resolve();
      await release.promise;
      return generatedContent;
    };
    const { actor, path } = await setup(generator);
    const first = actor.put(path).set("Origin", origin).send({}).then((response) => response);
    const second = actor.put(path).set("Origin", origin).send({}).then((response) => response);
    await reached.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const summaries = responses.map(
      (response) => researchPaperSummaryResponseSchema.parse(response.body).summary,
    );
    expect(summaries[1]).toEqual(summaries[0]);
    expect(generator.calls).toHaveLength(1);
  });

  it("retries once with a newer paper source and never persists the old result", async () => {
    const generator = new FakeResearchSummaryGenerator();
    const reached = deferred();
    const release = deferred();
    generator.handler = async () => {
      if (generator.calls.length === 1) {
        reached.resolve();
        await release.promise;
      }
      return generatedContent;
    };
    const { actor, path, paperRepository, summaryRepository } = await setup(generator);
    const responsePromise = actor.put(path).set("Origin", origin).send({}).then((response) => response);
    await reached.promise;
    paperRepository.papers.set(paperId, {
      ...paper,
      abstract: "Source B abstract.",
      updatedAt: new Date("2025-02-01T00:00:00.000Z"),
    });
    release.resolve();
    await expect(responsePromise).resolves.toMatchObject({ status: 201 });
    expect(generator.calls.map((source) => source.abstract)).toEqual([
      paper.abstract,
      "Source B abstract.",
    ]);
    expect(summaryRepository.summaries.get(paperId)?.sourceUpdatedAt).toEqual(
      new Date("2025-02-01T00:00:00.000Z"),
    );
  });

  it("returns 409 and persists nothing when the source changes during the retry", async () => {
    const generator = new FakeResearchSummaryGenerator();
    const reached = [deferred(), deferred()];
    const release = [deferred(), deferred()];
    generator.handler = async () => {
      const index = generator.calls.length - 1;
      reached[index]?.resolve();
      await release[index]?.promise;
      return generatedContent;
    };
    const { actor, path, paperRepository, summaryRepository } = await setup(generator);
    const responsePromise = actor.put(path).set("Origin", origin).send({}).then((response) => response);

    await reached[0].promise;
    paperRepository.papers.set(paperId, {
      ...paper,
      abstract: "Source B abstract.",
      updatedAt: new Date("2025-02-01T00:00:00.000Z"),
    });
    release[0].resolve();

    await reached[1].promise;
    paperRepository.papers.set(paperId, {
      ...paper,
      abstract: "Source C abstract.",
      updatedAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    release[1].resolve();

    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("summary_source_changed");
    expect(generator.calls).toHaveLength(2);
    expect(summaryRepository.summaries.size).toBe(0);
  });
});
