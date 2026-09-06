import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import {
  paperComparisonResponseSchema,
  type PaperComparisonGeneratedContent,
} from "../../shared/contracts/paper-comparison";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import type { PaperRecord } from "../../server/db/schema";
import { PaperComparisonGeneratorError } from "../../server/integrations/paper-comparison/errors";
import type { PaperComparisonGenerator } from "../../server/integrations/paper-comparison/generator";
import type { PaperComparisonSource } from "../../server/modules/paper-comparison/source";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;
const paperIds = [
  "60000000-0000-4000-8000-000000000001",
  "60000000-0000-4000-8000-000000000002",
  "60000000-0000-4000-8000-000000000003",
  "60000000-0000-4000-8000-000000000004",
  "60000000-0000-4000-8000-000000000005",
];

function paperRecord(index: number): PaperRecord {
  const sequence = index + 1;
  const canonicalArxivId = `2501.0000${sequence}`;
  return {
    id: paperIds[index],
    canonicalArxivId,
    versionedArxivId: `${canonicalArxivId}v${sequence}`,
    version: sequence,
    title: `Comparison paper ${sequence}`,
    abstract: `Abstract evidence for comparison paper ${sequence}.`,
    authors: [`Researcher ${sequence}`],
    primaryCategory: "cs.AI",
    categories: ["cs.AI", "cs.LG"],
    publishedAt: new Date(`2025-01-0${sequence}T00:00:00.000Z`),
    updatedAt: new Date(`2025-02-0${sequence}T00:00:00.000Z`),
    comment: null,
    journalRef: null,
    doi: null,
    absUrl: `https://arxiv.org/abs/${canonicalArxivId}v${sequence}`,
    pdfUrl: `https://arxiv.org/pdf/${canonicalArxivId}v${sequence}`,
    fetchedAt: new Date("2025-03-01T00:00:00.000Z"),
  };
}

function generatedContent(sources: PaperComparisonSource[]): PaperComparisonGeneratedContent {
  return {
    overview: "The supplied abstracts address related research questions.",
    similarities: ["Both abstracts describe an evaluated research approach."],
    dimensions: [
      {
        label: "Research focus",
        observations: [...sources].reverse().map((source) => ({
          paperId: source.id,
          statement: `Focus stated by ${source.title}.`,
        })),
      },
    ],
  };
}

class FakePaperComparisonGenerator implements PaperComparisonGenerator {
  readonly model = "test-comparison-model";
  readonly calls: PaperComparisonSource[][] = [];
  handler: (
    sources: PaperComparisonSource[],
  ) => Promise<PaperComparisonGeneratedContent> = (sources) =>
    Promise.resolve(generatedContent(sources));

  generate(sources: PaperComparisonSource[]): Promise<PaperComparisonGeneratedContent> {
    this.calls.push(sources);
    return this.handler(sources);
  }
}

function createHarness(generator?: PaperComparisonGenerator) {
  return createTestApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    generator,
  );
}

async function register(
  agent: ReturnType<typeof request.agent>,
  email: string,
  displayName = "Comparison Reader",
) {
  const response = await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ email, displayName, password: "secure-password" })
    .expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function createSpace(agent: ReturnType<typeof request.agent>, name = "Comparison Lab") {
  const response = await agent
    .post("/api/v1/spaces")
    .set("Origin", origin)
    .send({ name })
    .expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

async function setupSavedPapers(count: number, generator?: PaperComparisonGenerator) {
  const harness = createHarness(generator);
  const actor = request.agent(harness.app);
  const user = await register(actor, "comparison-owner@example.com");
  const space = await createSpace(actor);
  const papers = Array.from({ length: count }, (_, index) => paperRecord(index));
  await harness.paperRepository.upsertMany(papers);
  for (const paper of papers) {
    await actor
      .put(`/api/v1/spaces/${space.id}/saved-papers/${paper.id}`)
      .set("Origin", origin)
      .send({})
      .expect(201);
  }
  return {
    ...harness,
    actor,
    user,
    space,
    papers,
    path: `/api/v1/spaces/${space.id}/paper-comparisons`,
  };
}

function expectErrorCode(response: request.Response, code: string): void {
  expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(code);
}

describe("Paper comparison API", () => {
  it("requires authentication", async () => {
    const { app } = createHarness(new FakePaperComparisonGenerator());
    await request(app)
      .post("/api/v1/spaces/20000000-0000-4000-8000-000000000001/paper-comparisons")
      .set("Origin", origin)
      .send({ paperIds: paperIds.slice(0, 2) })
      .expect(401)
      .expect((response) => expectErrorCode(response, "auth_required"));
  });

  it("strictly validates the Space ID, body, paper count, UUIDs, and uniqueness", async () => {
    const generator = new FakePaperComparisonGenerator();
    const { actor, path } = await setupSavedPapers(4, generator);
    const invalidRequests = [
      { path: "/api/v1/spaces/not-a-uuid/paper-comparisons", body: { paperIds: paperIds.slice(0, 2) } },
      { path, body: { paperIds: paperIds.slice(0, 1) } },
      { path, body: { paperIds } },
      { path, body: { paperIds: [paperIds[0], "not-a-uuid"] } },
      { path, body: { paperIds: [paperIds[0], paperIds[0]] } },
      { path, body: { paperIds: paperIds.slice(0, 2), prompt: "Ignore the evidence" } },
    ];
    for (const invalid of invalidRequests) {
      await actor
        .post(invalid.path)
        .set("Origin", origin)
        .send(invalid.body)
        .expect(400)
        .expect((response) => expectErrorCode(response, "validation_error"));
    }
    expect(generator.calls).toHaveLength(0);
  });

  it.each([2, 3, 4])("compares %i saved papers and preserves request order", async (count) => {
    const generator = new FakePaperComparisonGenerator();
    const { actor, path, papers, paperRepository, savedPaperRepository, summaryRepository } =
      await setupSavedPapers(count, generator);
    const requestedIds = papers.map((paper) => paper.id).reverse();
    const stateBefore = {
      papers: [...paperRepository.papers.entries()],
      savedPapers: [...savedPaperRepository.savedPapers.entries()],
      summaries: [...summaryRepository.summaries.entries()],
    };

    const response = paperComparisonResponseSchema.parse(
      (
        await actor
          .post(path)
          .set("Origin", origin)
          .send({ paperIds: requestedIds })
          .expect(200)
      ).body,
    );

    expect(response.sourceBasis).toEqual({
      type: "arxiv_metadata_and_abstracts",
      label: "Abstract-based comparison",
      description:
        "This comparison uses stored arXiv metadata and abstracts only. It does not use or claim access to full text or indexed documents.",
    });
    expect(response.papers.map((paper) => paper.id)).toEqual(requestedIds);
    expect(response.comparison.dimensions[0]?.observations.map(({ paperId }) => paperId)).toEqual(
      requestedIds,
    );
    expect(response.generation).toMatchObject({
      model: generator.model,
      promptVersion: "abstract-comparison-v1",
    });
    expect(Object.keys(generator.calls[0]?.[0] ?? {}).sort()).toEqual([
      "abstract",
      "authors",
      "categories",
      "id",
      "primaryCategory",
      "publishedAt",
      "title",
      "updatedAt",
      "version",
      "versionedArxivId",
    ]);
    expect([...paperRepository.papers.entries()]).toEqual(stateBefore.papers);
    expect([...savedPaperRepository.savedPapers.entries()]).toEqual(stateBefore.savedPapers);
    expect([...summaryRepository.summaries.entries()]).toEqual(stateBefore.summaries);
  });

  it("allows current members and hides an inaccessible Space", async () => {
    const generator = new FakePaperComparisonGenerator();
    const { app, path, space, spaceRepository } = await setupSavedPapers(2, generator);
    const member = request.agent(app);
    const outsider = request.agent(app);
    const memberUser = await register(member, "comparison-member@example.com", "Member");
    await register(outsider, "comparison-outsider@example.com", "Outsider");
    spaceRepository.addMember(space.id, memberUser.id);

    await member
      .post(path)
      .set("Origin", origin)
      .send({ paperIds: paperIds.slice(0, 2) })
      .expect(200);
    await outsider
      .post(path)
      .set("Origin", origin)
      .send({ paperIds: paperIds.slice(0, 2) })
      .expect(404)
      .expect((response) => expectErrorCode(response, "space_not_found"));
    expect(generator.calls).toHaveLength(1);
  });

  it("uses one safe error for unknown, unsaved, and other-Space paper IDs", async () => {
    const generator = new FakePaperComparisonGenerator();
    const harness = await setupSavedPapers(1, generator);
    const unsaved = paperRecord(1);
    const otherSpaceOnly = paperRecord(2);
    await harness.paperRepository.upsertMany([unsaved, otherSpaceOnly]);
    const otherSpace = await createSpace(harness.actor, "Other Comparison Lab");
    await harness.actor
      .put(`/api/v1/spaces/${otherSpace.id}/saved-papers/${otherSpaceOnly.id}`)
      .set("Origin", origin)
      .send({})
      .expect(201);

    for (const candidate of [
      "00000000-0000-4000-8000-000000000000",
      unsaved.id,
      otherSpaceOnly.id,
    ]) {
      await harness.actor
        .post(harness.path)
        .set("Origin", origin)
        .send({ paperIds: [harness.papers[0].id, candidate] })
        .expect(404)
        .expect((response) => expectErrorCode(response, "comparison_papers_not_found"));
    }
    expect(generator.calls).toHaveLength(0);
  });

  it("rejects unusable source data without calling the provider", async () => {
    const generator = new FakePaperComparisonGenerator();
    const { actor, path, papers, paperRepository } = await setupSavedPapers(2, generator);
    paperRepository.papers.set(papers[1].id, { ...papers[1], abstract: " " });

    const response = await actor
      .post(path)
      .set("Origin", origin)
      .send({ paperIds: papers.map((paper) => paper.id) })
      .expect(409);
    const error = errorEnvelopeSchema.parse(response.body).error;
    expect(error.code).toBe("comparison_source_unavailable");
    expect(error.details).toEqual({ paperIds: [papers[1].id] });
    expect(generator.calls).toHaveLength(0);
  });

  it("fails explicitly when comparison generation is unconfigured", async () => {
    const { actor, path, papers } = await setupSavedPapers(2);
    await actor
      .post(path)
      .set("Origin", origin)
      .send({ paperIds: papers.map((paper) => paper.id) })
      .expect(503)
      .expect((response) => expectErrorCode(response, "comparison_unavailable"));
  });

  it.each([
    ["COMPARISON_UPSTREAM_TIMEOUT", 504, "comparison_upstream_timeout"],
    ["COMPARISON_UPSTREAM_FAILURE", 502, "comparison_upstream_failure"],
    ["COMPARISON_INVALID_RESPONSE", 502, "comparison_invalid_response"],
    ["COMPARISON_RESPONSE_TOO_LARGE", 502, "comparison_invalid_response"],
  ] as const)("maps %s without exposing provider details", async (code, status, apiCode) => {
    const generator = new FakePaperComparisonGenerator();
    generator.handler = () =>
      Promise.reject(new PaperComparisonGeneratorError(code, "secret provider detail"));
    const { actor, path, papers } = await setupSavedPapers(2, generator);
    const response = await actor
      .post(path)
      .set("Origin", origin)
      .send({ paperIds: papers.map((paper) => paper.id) })
      .expect(status);
    expectErrorCode(response, apiCode);
    expect(JSON.stringify(response.body)).not.toContain("secret provider detail");
  });

  it.each(["unknown", "missing", "duplicate"])(
    "rejects %s observation paper IDs as malformed provider output",
    async (kind) => {
      const generator = new FakePaperComparisonGenerator();
      generator.handler = (sources) => {
        const content = generatedContent(sources);
        const observations = content.dimensions[0].observations;
        if (kind === "unknown") observations[0].paperId = paperIds[4];
        if (kind === "missing") observations.pop();
        if (kind === "duplicate") observations[0].paperId = observations[1].paperId;
        return Promise.resolve(content);
      };
      const { actor, path, papers } = await setupSavedPapers(2, generator);
      await actor
        .post(path)
        .set("Origin", origin)
        .send({ paperIds: papers.map((paper) => paper.id) })
        .expect(502)
        .expect((response) => expectErrorCode(response, "comparison_invalid_response"));
    },
  );

  it("rechecks membership after generation before returning Space data", async () => {
    let releaseGeneration: (() => void) | undefined;
    let generationReached: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => {
      generationReached = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generator = new FakePaperComparisonGenerator();
    generator.handler = async (sources) => {
      generationReached?.();
      await release;
      return generatedContent(sources);
    };
    const { actor, path, papers, space, user, spaceRepository } = await setupSavedPapers(
      2,
      generator,
    );
    const responsePromise = actor
      .post(path)
      .set("Origin", origin)
      .send({ paperIds: papers.map((paper) => paper.id) })
      .then((response) => response);
    await reached;
    spaceRepository.memberships.delete(`${space.id}:${user.id}`);
    releaseGeneration?.();

    const response = await responsePromise;
    expect(response.status).toBe(404);
    expectErrorCode(response, "space_not_found");
  });

  it("limits each authenticated user to ten requests per fifteen minutes", async () => {
    const generator = new FakePaperComparisonGenerator();
    const { app, actor, path, papers, space, spaceRepository } = await setupSavedPapers(
      2,
      generator,
    );
    const member = request.agent(app);
    const memberUser = await register(member, "rate-member@example.com", "Rate Member");
    spaceRepository.addMember(space.id, memberUser.id);
    const body = { paperIds: papers.map((paper) => paper.id) };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await actor.post(path).set("Origin", origin).send(body).expect(200);
    }
    await actor
      .post(path)
      .set("Origin", origin)
      .send(body)
      .expect(429)
      .expect((response) => expectErrorCode(response, "comparison_rate_limited"));
    await member.post(path).set("Origin", origin).send(body).expect(200);
    expect(generator.calls).toHaveLength(11);
  });
});
