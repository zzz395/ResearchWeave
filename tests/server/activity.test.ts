import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import {
  ACTIVITY_PAPER_TITLE_MAX_CHARACTERS,
  activityListResponseSchema,
  activityStableEventKeySchema,
} from "../../shared/contracts/activity";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import type { DocumentRecord, PaperRecord } from "../../server/db/schema";
import { TEST_AGENT_ID } from "../helpers/in-memory-agent-repository";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;

function encodeCursorPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function cursorPayload(stableEventKey: string) {
  return {
    version: 1,
    occurredAt: "2026-09-05T00:00:00.000Z",
    stableEventKey,
    spaceId: null,
    category: null,
  };
}

async function register(agent: ReturnType<typeof request.agent>, email: string, name: string) {
  const response = await agent.post("/api/v1/auth/register").set("Origin", origin).send({
    email,
    displayName: name,
    password: "secure-password",
  }).expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function createSpace(agent: ReturnType<typeof request.agent>, name: string) {
  const response = await agent.post("/api/v1/spaces").set("Origin", origin).send({ name }).expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

function documentFixture(input: {
  id: string;
  spaceId: string;
  uploaderId: string | null;
  filename: string;
  status?: DocumentRecord["status"];
  createdAt: Date;
  updatedAt?: Date;
}): DocumentRecord {
  return {
    id: input.id,
    spaceId: input.spaceId,
    uploadedByUserId: input.uploaderId,
    originalFilename: input.filename,
    mediaType: "text",
    sizeBytes: 10,
    sourceSha256: input.id.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    storageKey: `private/${input.id}`,
    status: input.status ?? "ready",
    stage: null,
    attemptCount: 0,
    lastAttemptAt: null,
    errorCode: null,
    failedAt: null,
    pageCount: null,
    characterCount: null,
    chunkCount: 0,
    extractorVersion: null,
    chunkerVersion: null,
    embeddingModel: null,
    embeddingDimensions: null,
    indexFingerprint: null,
    indexedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

function paperFixture(id: string, title: string, now: Date): PaperRecord {
  return {
    id,
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v1",
    version: 1,
    title,
    abstract: "PRIVATE ABSTRACT",
    authors: ["Researcher"],
    primaryCategory: "cs.AI",
    categories: ["cs.AI"],
    publishedAt: now,
    updatedAt: now,
    comment: null,
    journalRef: null,
    doi: null,
    absUrl: "https://arxiv.org/abs/2609.00001v1",
    pdfUrl: "https://arxiv.org/pdf/2609.00001v1",
    fetchedAt: now,
  };
}

describe("Activity API", () => {
  it("requires authentication", async () => {
    const { app } = createTestApp();
    await request(app).get("/api/v1/activity").expect(401);
  });

  it("enforces current Space access and limits Connection events to participants", async () => {
    const harness = createTestApp();
    const aliceAgent = request.agent(harness.app);
    const bobAgent = request.agent(harness.app);
    const charlieAgent = request.agent(harness.app);
    const alice = await register(aliceAgent, "activity-alice@example.com", "Activity Alice");
    const bob = await register(bobAgent, "activity-bob@example.com", "Activity Bob");
    const charlie = await register(charlieAgent, "activity-charlie@example.com", "Activity Charlie");
    const aliceSpace = await createSpace(aliceAgent, "Alice Research");
    const bobSpace = await createSpace(bobAgent, "Bob Research");
    const now = new Date("2026-09-05T03:00:00.000Z");
    harness.connectionRepository.connections.set("10000000-0000-4000-8000-000000000001", {
      id: "10000000-0000-4000-8000-000000000001",
      userLowId: [alice.id, bob.id].sort()[0],
      userHighId: [alice.id, bob.id].sort()[1],
      requestedByUserId: alice.id,
      status: "pending",
      createdAt: now,
      respondedAt: null,
    });
    harness.connectionRepository.connections.set("10000000-0000-4000-8000-000000000002", {
      id: "10000000-0000-4000-8000-000000000002",
      userLowId: [bob.id, charlie.id].sort()[0],
      userHighId: [bob.id, charlie.id].sort()[1],
      requestedByUserId: bob.id,
      status: "pending",
      createdAt: now,
      respondedAt: null,
    });

    await aliceAgent.get(`/api/v1/activity?spaceId=${bobSpace.id}`).expect(404);
    const response = await aliceAgent.get("/api/v1/activity?limit=50").expect(200);
    const body = activityListResponseSchema.parse(response.body);
    expect(body.events.some((event) => event.space?.id === bobSpace.id)).toBe(false);
    expect(body.events.filter((event) => event.kind === "connection_requested"))
      .toHaveLength(1);
    expect(body.events.some((event) => event.space?.id === aliceSpace.id)).toBe(true);
  });

  it("uses stable reverse-keyset pagination and binds canonical cursors to filters", async () => {
    const harness = createTestApp();
    const agent = request.agent(harness.app);
    const user = await register(agent, "cursor@example.com", "Cursor User");
    const space = await createSpace(agent, "Cursor Space");
    const olderAt = new Date("2026-09-05T01:00:00.000Z");
    const storedSpace = harness.spaceRepository.spaces.get(space.id);
    if (!storedSpace) throw new Error("Expected a stored Space.");
    harness.spaceRepository.spaces.set(space.id, {
      ...storedSpace,
      createdAt: olderAt,
      updatedAt: olderAt,
    });
    harness.memberRepository.joinedAt.set(`${space.id}:${user.id}`, olderAt);
    const tiedAt = new Date("2026-09-05T04:00:00.000Z");
    for (const suffix of ["003", "001", "002"]) {
      harness.chatRepository.messages.push({
        id: `20000000-0000-4000-8000-000000000${suffix}`,
        spaceId: space.id,
        senderUserId: user.id,
        body: `PRIVATE BODY ${suffix}`,
        createdAt: tiedAt,
      });
    }

    const expectedIds = [
      "chat_message_created:20000000-0000-4000-8000-000000000003",
      "chat_message_created:20000000-0000-4000-8000-000000000002",
      "chat_message_created:20000000-0000-4000-8000-000000000001",
      `space_created:${space.id}`,
      `member_joined:${space.id}:${user.id}`,
    ];
    const actualIds: string[] = [];
    let cursor: string | null = null;
    do {
      const cursorParameter = cursor ? `&cursor=${cursor}` : "";
      const page = activityListResponseSchema.parse((await agent
        .get(`/api/v1/activity?spaceId=${space.id}&category=collaboration&limit=2${cursorParameter}`)
        .expect(200)).body);
      actualIds.push(...page.events.map((event) => event.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(actualIds).toEqual(expectedIds);
    expect(new Set(actualIds)).toHaveLength(expectedIds.length);
    expect(cursor).toBeNull();

    const first = activityListResponseSchema.parse((await agent
      .get(`/api/v1/activity?spaceId=${space.id}&category=collaboration&limit=2`)
      .expect(200)).body);
    expect(first.nextCursor).not.toBeNull();

    const wrongCategory = await agent
      .get(`/api/v1/activity?spaceId=${space.id}&category=research&limit=2&cursor=${first.nextCursor}`)
      .expect(400);
    expect(errorEnvelopeSchema.parse(wrongCategory.body).error.code).toBe("invalid_activity_cursor");
    const otherSpace = await createSpace(agent, "Other Cursor Space");
    const wrongSpace = await agent
      .get(`/api/v1/activity?spaceId=${otherSpace.id}&category=collaboration&limit=2&cursor=${first.nextCursor}`)
      .expect(400);
    expect(errorEnvelopeSchema.parse(wrongSpace.body).error.code).toBe("invalid_activity_cursor");
    await agent
      .get(`/api/v1/activity?spaceId=${space.id}&category=collaboration&limit=2&cursor=${first.nextCursor}=`)
      .expect(400);
  });

  it("enforces default, minimum, maximum, and invalid limits", async () => {
    const harness = createTestApp();
    const agent = request.agent(harness.app);
    const user = await register(agent, "limits@example.com", "Limits User");
    const space = await createSpace(agent, "Limits Space");
    for (let index = 0; index < 55; index += 1) {
      harness.chatRepository.messages.push({
        id: `21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        spaceId: space.id,
        senderUserId: user.id,
        body: `Message ${index}`,
        createdAt: new Date(Date.UTC(2026, 8, 5, 5, index)),
      });
    }

    expect(activityListResponseSchema.parse((await agent.get("/api/v1/activity").expect(200)).body).events)
      .toHaveLength(20);
    expect(activityListResponseSchema.parse((await agent.get("/api/v1/activity?limit=1").expect(200)).body).events)
      .toHaveLength(1);
    expect(activityListResponseSchema.parse((await agent.get("/api/v1/activity?limit=50").expect(200)).body).events)
      .toHaveLength(50);
    await agent.get("/api/v1/activity?limit=0").expect(400);
    await agent.get("/api/v1/activity?limit=51").expect(400);
    await agent.get("/api/v1/activity?limit=1.5").expect(400);
  });

  it("rejects malformed and structurally invalid cursors with the Activity cursor error", async () => {
    const harness = createTestApp();
    const agent = request.agent(harness.app);
    await register(agent, "invalid-cursor@example.com", "Invalid Cursor User");
    const invalidCursors = [
      "%%%",
      "Zg==",
      Buffer.from("not JSON", "utf8").toString("base64url"),
      encodeCursorPayload({ version: 1 }),
      encodeCursorPayload(cursorPayload("unknown_event:10000000-0000-4000-8000-000000000001")),
      encodeCursorPayload(cursorPayload("space_created:not-a-uuid")),
      encodeCursorPayload(cursorPayload("member_joined:10000000-0000-4000-8000-000000000001")),
      encodeCursorPayload(cursorPayload("paper_saved:10000000-0000-4000-8000-000000000001:")),
      encodeCursorPayload(cursorPayload("space_created:10000000-0000-4000-8000-000000000001:extra")),
      encodeCursorPayload(cursorPayload("arbitrary")),
      encodeCursorPayload(cursorPayload(`space_created:${"a".repeat(300)}`)),
      encodeCursorPayload(cursorPayload("space_created:\u0001")),
      encodeCursorPayload(cursorPayload("space_created:\u0000")),
    ];
    for (const cursor of invalidCursors) {
      const response = await agent.get(`/api/v1/activity?cursor=${encodeURIComponent(cursor)}`).expect(400);
      expect(errorEnvelopeSchema.parse(response.body).error.code, cursor)
        .toBe("invalid_activity_cursor");
    }
  });

  it("rechecks explicit Space authorization between pages", async () => {
    const harness = createTestApp();
    const ownerAgent = request.agent(harness.app);
    const memberAgent = request.agent(harness.app);
    const owner = await register(ownerAgent, "page-owner@example.com", "Page Owner");
    const member = await register(memberAgent, "page-member@example.com", "Page Member");
    const space = await createSpace(ownerAgent, "Page Revocation Space");
    await harness.memberRepository.add(space.id, member.id, new Date("2026-09-05T01:00:00.000Z"));
    for (let index = 0; index < 3; index += 1) {
      harness.chatRepository.messages.push({
        id: `22000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        spaceId: space.id,
        senderUserId: owner.id,
        body: `Revocation ${index}`,
        createdAt: new Date(Date.UTC(2026, 8, 5, 2, index)),
      });
    }
    const first = activityListResponseSchema.parse((await memberAgent
      .get(`/api/v1/activity?spaceId=${space.id}&limit=1`)
      .expect(200)).body);
    expect(first.nextCursor).not.toBeNull();
    await harness.memberRepository.removeOrdinaryMember(space.id, member.id);
    const revoked = await memberAgent
      .get(`/api/v1/activity?spaceId=${space.id}&limit=1&cursor=${first.nextCursor}`)
      .expect(404);
    expect(errorEnvelopeSchema.parse(revoked.body).error.code).toBe("space_not_found");
  });

  it("projects requested and accepted Connection timestamps exactly once", async () => {
    const harness = createTestApp();
    const aliceAgent = request.agent(harness.app);
    const alice = await register(aliceAgent, "connection-alice@example.com", "Connection Alice");
    const bob = await register(request.agent(harness.app), "connection-bob@example.com", "Connection Bob");
    const charlie = await register(request.agent(harness.app), "connection-charlie@example.com", "Connection Charlie");
    const createdAt = new Date("2026-09-05T08:00:00.000Z");
    const respondedAt = new Date("2026-09-05T08:01:00.000Z");
    const acceptedId = "23000000-0000-4000-8000-000000000001";
    const pendingId = "23000000-0000-4000-8000-000000000002";
    const acceptedPair = [alice.id, bob.id].sort();
    const pendingPair = [alice.id, charlie.id].sort();
    harness.connectionRepository.connections.set(acceptedId, {
      id: acceptedId,
      userLowId: acceptedPair[0],
      userHighId: acceptedPair[1],
      requestedByUserId: alice.id,
      status: "accepted",
      createdAt,
      respondedAt,
    });
    harness.connectionRepository.connections.set(pendingId, {
      id: pendingId,
      userLowId: pendingPair[0],
      userHighId: pendingPair[1],
      requestedByUserId: alice.id,
      status: "pending",
      createdAt,
      respondedAt: null,
    });

    const events = activityListResponseSchema.parse(
      (await aliceAgent.get("/api/v1/activity?category=collaboration&limit=50").expect(200)).body,
    ).events;
    expect(events.filter((event) => event.id === `connection_requested:${acceptedId}`))
      .toHaveLength(1);
    expect(events.find((event) => event.id === `connection_requested:${acceptedId}`)?.occurredAt)
      .toBe(createdAt.toISOString());
    expect(events.filter((event) => event.id === `connection_accepted:${acceptedId}`))
      .toHaveLength(1);
    expect(events.find((event) => event.id === `connection_accepted:${acceptedId}`)?.occurredAt)
      .toBe(respondedAt.toISOString());
    expect(events.filter((event) => event.id === `connection_requested:${pendingId}`))
      .toHaveLength(1);
    expect(events.some((event) => event.id === `connection_accepted:${pendingId}`)).toBe(false);
  });

  it("bounds oversized Paper summaries without changing durable data", async () => {
    const harness = createTestApp();
    const agent = request.agent(harness.app);
    const user = await register(agent, "bounded-paper@example.com", "Bounded Paper User");
    const space = await createSpace(agent, "Bounded Paper Space");
    const oversizedTitle = "T".repeat(1_200);
    const now = new Date("2026-09-05T09:00:00.000Z");
    const paper = paperFixture("24000000-0000-4000-8000-000000000001", oversizedTitle, now);
    harness.paperRepository.papers.set(paper.id, paper);
    harness.savedPaperRepository.savedPapers.set(`${space.id}:${paper.id}`, {
      spaceId: space.id,
      paperId: paper.id,
      savedByUserId: user.id,
      savedAt: now,
    });

    const response = activityListResponseSchema.parse((await agent
      .get(`/api/v1/activity?spaceId=${space.id}&category=research`)
      .expect(200)).body);
    const subject = response.events[0]?.subject;
    expect(subject?.type).toBe("paper");
    if (subject?.type !== "paper") throw new Error("Expected a Paper Activity subject.");
    expect(subject.title).toHaveLength(ACTIVITY_PAPER_TITLE_MAX_CHARACTERS);
    expect(harness.paperRepository.papers.get(paper.id)?.title).toBe(oversizedTitle);
  });

  it("rejects oversized Activity containers and noncanonical next cursors", () => {
    const event = {
      id: "space_created:25000000-0000-4000-8000-000000000001",
      kind: "space_created",
      category: "collaboration",
      occurredAt: "2026-09-05T10:00:00.000Z",
      actor: null,
      space: { id: "25000000-0000-4000-8000-000000000001", name: "Contract Space" },
      subject: { type: "space", spaceId: "25000000-0000-4000-8000-000000000001", name: "Contract Space" },
      target: { type: "space", spaceId: "25000000-0000-4000-8000-000000000001" },
    };
    expect(activityStableEventKeySchema.safeParse(event.id).success).toBe(true);
    expect(activityStableEventKeySchema.safeParse(
      "paper_saved:25000000-0000-4000-8000-000000000001:25000000-0000-4000-8000-000000000002",
    ).success).toBe(true);
    expect(activityListResponseSchema.safeParse({ events: Array(51).fill(event), nextCursor: null }).success)
      .toBe(false);
    expect(activityListResponseSchema.safeParse({ events: [], nextCursor: "Zg==" }).success)
      .toBe(false);
  });

  it("projects only current durable resources and supports null actors", async () => {
    const harness = createTestApp();
    const aliceAgent = request.agent(harness.app);
    const bobAgent = request.agent(harness.app);
    await register(aliceAgent, "projection-alice@example.com", "Projection Alice");
    const bob = await register(bobAgent, "projection-bob@example.com", "Projection Bob");
    const space = await createSpace(aliceAgent, "Projection Space");
    const joinedAt = new Date("2026-09-05T05:00:00.000Z");
    await harness.memberRepository.add(space.id, bob.id, joinedAt);
    const paper = paperFixture("30000000-0000-4000-8000-000000000001", "Current Paper", joinedAt);
    harness.paperRepository.papers.set(paper.id, paper);
    harness.savedPaperRepository.savedPapers.set(`${space.id}:${paper.id}`, {
      spaceId: space.id,
      paperId: paper.id,
      savedByUserId: bob.id,
      savedAt: joinedAt,
    });
    const removedDocument = documentFixture({
      id: "40000000-0000-4000-8000-000000000001",
      spaceId: space.id,
      uploaderId: bob.id,
      filename: "removed.txt",
      createdAt: joinedAt,
    });
    const anonymousDocument = documentFixture({
      id: "40000000-0000-4000-8000-000000000002",
      spaceId: space.id,
      uploaderId: null,
      filename: "retained.txt",
      createdAt: joinedAt,
    });
    harness.documentRepository.documents.set(removedDocument.id, removedDocument);
    harness.documentRepository.documents.set(anonymousDocument.id, anonymousDocument);

    let response = activityListResponseSchema.parse(
      (await aliceAgent.get(`/api/v1/activity?spaceId=${space.id}&limit=50`).expect(200)).body,
    );
    expect(response.events.some((event) => event.id.includes(bob.id))).toBe(true);
    expect(response.events.find((event) => event.id === `document_uploaded:${anonymousDocument.id}`)?.actor)
      .toBeNull();

    await harness.memberRepository.removeOrdinaryMember(space.id, bob.id);
    harness.savedPaperRepository.savedPapers.delete(`${space.id}:${paper.id}`);
    harness.documentRepository.documents.delete(removedDocument.id);
    response = activityListResponseSchema.parse(
      (await aliceAgent.get(`/api/v1/activity?spaceId=${space.id}&limit=50`).expect(200)).body,
    );
    expect(response.events.some((event) => event.kind === "member_joined" && event.id.includes(bob.id)))
      .toBe(false);
    expect(response.events.some((event) => event.kind === "paper_saved")).toBe(false);
    expect(response.events.some((event) => event.id === `document_uploaded:${removedDocument.id}`))
      .toBe(false);
  });

  it("returns safe summaries without source payloads", async () => {
    const harness = createTestApp();
    const agent = request.agent(harness.app);
    const user = await register(agent, "safe@example.com", "Safe User");
    const space = await createSpace(agent, "Safe Space");
    const now = new Date("2026-09-05T06:00:00.000Z");
    harness.chatRepository.messages.push({
      id: "50000000-0000-4000-8000-000000000001",
      spaceId: space.id,
      senderUserId: user.id,
      body: "PRIVATE CHAT BODY",
      createdAt: now,
    });
    const paper = paperFixture("50000000-0000-4000-8000-000000000002", "Safe Paper", now);
    harness.paperRepository.papers.set(paper.id, paper);
    harness.savedPaperRepository.savedPapers.set(`${space.id}:${paper.id}`, {
      spaceId: space.id,
      paperId: paper.id,
      savedByUserId: user.id,
      savedAt: now,
    });
    const document = documentFixture({
      id: "50000000-0000-4000-8000-000000000003",
      spaceId: space.id,
      uploaderId: user.id,
      filename: "safe.txt",
      createdAt: now,
    });
    harness.documentRepository.documents.set(document.id, document);
    await agent.post(`/api/v1/spaces/${space.id}/agent-tasks`).set("Origin", origin).send({
      agentId: TEST_AGENT_ID,
      prompt: "PRIVATE AGENT PROMPT",
      clientRequestId: "50000000-0000-4000-8000-000000000004",
    }).expect(202);
    const createdRun = [...harness.agentRepository.runs.values()][0];
    if (!createdRun) throw new Error("Expected the Agent API to create a Run.");
    harness.agentRepository.runs.set(createdRun.id, {
      ...createdRun,
      finalAnswer: "PRIVATE FINAL ANSWER",
    });

    const response = await agent.get(`/api/v1/activity?spaceId=${space.id}&limit=50`).expect(200);
    activityListResponseSchema.parse(response.body);
    const serialized = JSON.stringify(response.body);
    for (const secret of [
      "PRIVATE CHAT BODY",
      "PRIVATE ABSTRACT",
      "PRIVATE AGENT PROMPT",
      "PRIVATE FINAL ANSWER",
      document.storageKey,
      document.sourceSha256,
      user.email,
    ]) expect(serialized).not.toContain(secret);
  });
});
