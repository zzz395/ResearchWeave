import request from "supertest";
import { describe, expect, it } from "vitest";

import type { ArxivClient } from "../../server/integrations/arxiv/client";
import {
  ArxivIntegrationError,
} from "../../server/integrations/arxiv/errors";
import { authResponseSchema } from "../../shared/contracts/auth";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import {
  persistentResearchPaperResponseSchema,
  persistentResearchPaperSearchResultSchema,
  savedPaperListResponseSchema,
  savedPaperResponseSchema,
  type ResearchPaper,
  type ResearchPaperSearchResult,
} from "../../shared/contracts/research";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;

function paper(
  version: number,
  options: Partial<ResearchPaper> = {},
): ResearchPaper {
  const canonicalArxivId = options.canonicalArxivId ?? "1501.00001";
  return {
    canonicalArxivId,
    versionedArxivId: `${canonicalArxivId}v${version}`,
    version,
    title: `Persistent Research v${version}`,
    abstract: `A real abstract for version ${version}.`,
    authors: ["Ada Researcher", "Lin Scholar"],
    primaryCategory: "cs.AI",
    categories: ["cs.AI", "cs.LG"],
    publishedAt: "2015-01-01T00:00:00.000Z",
    updatedAt: `2025-01-0${version}T00:00:00.000Z`,
    absUrl: `https://arxiv.org/abs/${canonicalArxivId}v${version}`,
    pdfUrl: `https://arxiv.org/pdf/${canonicalArxivId}v${version}`,
    ...options,
  };
}

function searchResult(papers: ResearchPaper[]): ResearchPaperSearchResult {
  return {
    totalResults: papers.length,
    startIndex: 0,
    itemsPerPage: papers.length,
    papers,
  };
}

class FakeArxivClient implements Pick<ArxivClient, "search"> {
  result: ResearchPaperSearchResult = searchResult([]);
  error: Error | undefined;
  readonly calls: unknown[] = [];

  search(input: unknown): Promise<ResearchPaperSearchResult> {
    this.calls.push(input);
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.result);
  }
}

async function register(
  agent: ReturnType<typeof request.agent>,
  email: string,
  displayName: string,
) {
  const response = await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ email, displayName, password: "secure-password" })
    .expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function createSpace(owner: ReturnType<typeof request.agent>) {
  const response = await owner
    .post("/api/v1/spaces")
    .set("Origin", origin)
    .send({ name: "Paper Lab" })
    .expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

async function search(agent: ReturnType<typeof request.agent>) {
  const response = await agent
    .get("/api/v1/research/papers/search")
    .query({ q: "  retrieval   augmented  ", page: 1, pageSize: 10, sort: "updated" })
    .expect(200);
  return persistentResearchPaperSearchResultSchema.parse(response.body);
}

describe("Research paper API", () => {
  it("requires authentication, validates search input, persists real results, and serves detail", async () => {
    const arxiv = new FakeArxivClient();
    arxiv.result = searchResult([paper(2)]);
    const { app, paperRepository } = createTestApp(undefined, arxiv);
    await request(app).get("/api/v1/research/papers/search").query({ q: "research" }).expect(401);

    const actor = request.agent(app);
    await register(actor, "reader@example.com", "Reader");
    await actor.get("/api/v1/research/papers/search").query({ q: "x" }).expect(400);

    const result = await search(actor);
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0]).toMatchObject({
      canonicalArxivId: "1501.00001",
      version: 2,
    });
    expect(arxiv.calls[0]).toEqual({
      q: "retrieval augmented",
      page: 1,
      pageSize: 10,
      sort: "updated",
    });
    expect(paperRepository.papers.size).toBe(1);

    const detail = persistentResearchPaperResponseSchema.parse(
      (await actor.get(`/api/v1/research/papers/${result.papers[0].id}`).expect(200)).body,
    ).paper;
    expect(detail).toEqual(result.papers[0]);
    await actor
      .get("/api/v1/research/papers/00000000-0000-4000-8000-000000000000")
      .expect(404)
      .expect((response) => {
        expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("paper_not_found");
      });
  });

  it("keeps empty search successful and fails explicitly when persistence fails", async () => {
    const arxiv = new FakeArxivClient();
    const { app, paperRepository } = createTestApp(undefined, arxiv);
    const actor = request.agent(app);
    await register(actor, "empty@example.com", "Empty Reader");

    const empty = await search(actor);
    expect(empty.papers).toEqual([]);
    expect(paperRepository.papers.size).toBe(0);

    arxiv.result = searchResult([paper(1)]);
    paperRepository.failNextUpsert = true;
    await actor
      .get("/api/v1/research/papers/search")
      .query({ q: "persistence" })
      .expect(500);
    expect(paperRepository.papers.size).toBe(0);
  });

  it("keeps a stable UUID and applies monotonic canonical-version updates", async () => {
    const arxiv = new FakeArxivClient();
    arxiv.result = searchResult([paper(2)]);
    const { app, paperRepository } = createTestApp(undefined, arxiv);
    const actor = request.agent(app);
    await register(actor, "versions@example.com", "Version Reader");

    const first = (await search(actor)).papers[0];
    arxiv.result = searchResult([paper(3, { comment: "v3 comment" })]);
    const upgraded = (await search(actor)).papers[0];
    expect(upgraded).toMatchObject({ id: first.id, version: 3, comment: "v3 comment" });

    arxiv.result = searchResult([
      paper(2, { title: "Stale title", updatedAt: "2030-01-01T00:00:00.000Z" }),
    ]);
    const afterStale = (await search(actor)).papers[0];
    expect(afterStale).toMatchObject({ id: first.id, version: 3, title: "Persistent Research v3" });

    arxiv.result = searchResult([
      paper(3, {
        title: "Refreshed v3 metadata",
        updatedAt: "2026-01-01T00:00:00.000Z",
        comment: undefined,
      }),
    ]);
    const refreshed = (await search(actor)).papers[0];
    expect(refreshed).toMatchObject({ id: first.id, version: 3, title: "Refreshed v3 metadata" });
    expect(refreshed).not.toHaveProperty("comment");
    expect(paperRepository.papers.size).toBe(1);
  });

  it.each([
    ["ARXIV_QUEUE_FULL", 503, "research_temporarily_unavailable"],
    ["ARXIV_RATE_LIMITED", 503, "research_temporarily_unavailable"],
    ["ARXIV_TIMEOUT", 504, "research_upstream_timeout"],
    ["ARXIV_UPSTREAM_ERROR", 502, "research_upstream_failure"],
    ["ARXIV_RESPONSE_TOO_LARGE", 502, "research_upstream_failure"],
    ["ARXIV_INVALID_RESPONSE", 502, "research_upstream_failure"],
  ] as const)("maps %s to a safe API error", async (code, status, apiCode) => {
    const arxiv = new FakeArxivClient();
    arxiv.error = new ArxivIntegrationError(code, "secret upstream detail");
    const { app } = createTestApp(undefined, arxiv);
    const actor = request.agent(app);
    await register(actor, `${code.toLowerCase()}@example.com`, "Error Reader");

    const response = await actor
      .get("/api/v1/research/papers/search")
      .query({ q: "failure" })
      .expect(status);
    const error = errorEnvelopeSchema.parse(response.body).error;
    expect(error.code).toBe(apiCode);
    expect(JSON.stringify(response.body)).not.toContain("secret upstream detail");
  });
});

describe("Saved Papers API", () => {
  it("enforces membership, idempotent attribution, and saver/owner removal policy", async () => {
    const arxiv = new FakeArxivClient();
    arxiv.result = searchResult([paper(2)]);
    const { app, spaceRepository } = createTestApp(undefined, arxiv);
    const owner = request.agent(app);
    const saver = request.agent(app);
    const otherMember = request.agent(app);
    const outsider = request.agent(app);
    await register(owner, "owner-papers@example.com", "Owner Papers");
    const saverUser = await register(saver, "saver@example.com", "Saver");
    const otherUser = await register(otherMember, "other@example.com", "Other Member");
    await register(outsider, "outsider@example.com", "Outsider");
    const space = await createSpace(owner);
    spaceRepository.addMember(space.id, saverUser.id);
    spaceRepository.addMember(space.id, otherUser.id);
    const paperId = (await search(owner)).papers[0].id;
    const path = `/api/v1/spaces/${space.id}/saved-papers/${paperId}`;

    await outsider.get(`/api/v1/spaces/${space.id}/saved-papers`).expect(404);
    await outsider.put(path).set("Origin", origin).send({}).expect(404);
    await outsider.delete(path).set("Origin", origin).expect(404);

    const created = savedPaperResponseSchema.parse(
      (await saver.put(path).set("Origin", origin).send({}).expect(201)).body,
    ).savedPaper;
    expect(created.savedByUserId).toBe(saverUser.id);

    const repeated = savedPaperResponseSchema.parse(
      (await saver.put(path).set("Origin", origin).send({}).expect(200)).body,
    ).savedPaper;
    expect(repeated).toEqual(created);

    const list = savedPaperListResponseSchema.parse(
      (await otherMember.get(`/api/v1/spaces/${space.id}/saved-papers`).expect(200)).body,
    ).savedPapers;
    expect(list).toEqual([created]);

    await otherMember.delete(path).set("Origin", origin).expect(403);
    await owner.delete(path).set("Origin", origin).expect(204);
    await saver.delete(path).set("Origin", origin).expect(404);

    await saver.put(path).set("Origin", origin).send({}).expect(201);
    await saver.delete(path).set("Origin", origin).expect(204);
  });

  it("rejects unknown papers and client-supplied metadata", async () => {
    const arxiv = new FakeArxivClient();
    arxiv.result = searchResult([paper(1)]);
    const { app } = createTestApp(undefined, arxiv);
    const owner = request.agent(app);
    await register(owner, "strict-owner@example.com", "Strict Owner");
    const space = await createSpace(owner);
    const paperId = (await search(owner)).papers[0].id;

    await owner
      .put(`/api/v1/spaces/${space.id}/saved-papers/00000000-0000-4000-8000-000000000000`)
      .set("Origin", origin)
      .send({})
      .expect(404)
      .expect((response) => {
        expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("paper_not_found");
      });
    await owner
      .put(`/api/v1/spaces/${space.id}/saved-papers/${paperId}`)
      .set("Origin", origin)
      .send({ title: "Client-authored fake metadata", savedByUserId: crypto.randomUUID() })
      .expect(400);
  });

  it("orders saved papers newest-first and restricts null-attribution removal to the owner", async () => {
    const arxiv = new FakeArxivClient();
    arxiv.result = searchResult([
      paper(1),
      paper(1, {
        canonicalArxivId: "2501.12345",
        versionedArxivId: "2501.12345v1",
        title: "Second Persistent Paper",
        absUrl: "https://arxiv.org/abs/2501.12345v1",
        pdfUrl: "https://arxiv.org/pdf/2501.12345v1",
      }),
    ]);
    const { app, spaceRepository, savedPaperRepository } = createTestApp(undefined, arxiv);
    const owner = request.agent(app);
    const member = request.agent(app);
    await register(owner, "ordering-owner@example.com", "Ordering Owner");
    const memberUser = await register(member, "ordering-member@example.com", "Ordering Member");
    const space = await createSpace(owner);
    spaceRepository.addMember(space.id, memberUser.id);
    const [firstPaper, secondPaper] = (await search(owner)).papers;
    const firstPath = `/api/v1/spaces/${space.id}/saved-papers/${firstPaper.id}`;
    const secondPath = `/api/v1/spaces/${space.id}/saved-papers/${secondPaper.id}`;
    await owner.put(firstPath).set("Origin", origin).send({}).expect(201);
    await owner.put(secondPath).set("Origin", origin).send({}).expect(201);

    const firstKey = `${space.id}:${firstPaper.id}`;
    const secondKey = `${space.id}:${secondPaper.id}`;
    const firstSaved = savedPaperRepository.savedPapers.get(firstKey);
    const secondSaved = savedPaperRepository.savedPapers.get(secondKey);
    if (!firstSaved || !secondSaved) throw new Error("Expected both saved paper fixtures.");
    savedPaperRepository.savedPapers.set(firstKey, {
      ...firstSaved,
      savedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    savedPaperRepository.savedPapers.set(secondKey, {
      ...secondSaved,
      savedByUserId: null,
      savedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const list = savedPaperListResponseSchema.parse(
      (await member.get(`/api/v1/spaces/${space.id}/saved-papers`).expect(200)).body,
    ).savedPapers;
    expect(list.map((saved) => saved.paper.id)).toEqual([secondPaper.id, firstPaper.id]);
    expect(list[0].savedByUserId).toBeNull();
    await member.delete(secondPath).set("Origin", origin).expect(403);
    await owner.delete(secondPath).set("Origin", origin).expect(204);
  });
});
