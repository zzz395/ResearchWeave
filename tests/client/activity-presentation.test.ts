import { describe, expect, it } from "vitest";

import {
  activityEventSchema,
  type ActivityEvent,
  type ActivityKind,
} from "../../shared/contracts/activity";
import { getActivityEventPresentation } from "../../src/features/activity/activity-presentation";

const spaceId = "10000000-0000-4000-8000-000000000001";
const resourceId = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000003";
const agentId = "40000000-0000-4000-8000-000000000004";
const actor = { id: userId, displayName: "Ada Lovelace" };
const space = { id: spaceId, name: "Graph Lab" };

const stableIds: Record<ActivityKind, string> = {
  connection_requested: `connection_requested:${resourceId}`,
  connection_accepted: `connection_accepted:${resourceId}`,
  space_created: `space_created:${spaceId}`,
  member_joined: `member_joined:${spaceId}:${userId}`,
  chat_message_created: `chat_message_created:${resourceId}`,
  paper_saved: `paper_saved:${spaceId}:${resourceId}`,
  document_uploaded: `document_uploaded:${resourceId}`,
  agent_task_created: `agent_task_created:${resourceId}`,
  agent_run_created: `agent_run_created:${resourceId}`,
};

function event(
  kind: ActivityKind,
  category: ActivityEvent["category"],
  subject: unknown,
  target: unknown,
  overrides: Partial<ActivityEvent> = {},
): ActivityEvent {
  return activityEventSchema.parse({
    id: stableIds[kind],
    kind,
    category,
    occurredAt: "2026-09-06T08:00:00.000Z",
    actor,
    space,
    subject,
    target,
    ...overrides,
  });
}

const cases: readonly [ActivityEvent, string][] = [
  [event("connection_requested", "collaboration", {
    type: "connection", connectionId: resourceId, status: "pending", otherUser: actor,
  }, { type: "connection", connectionId: resourceId }, { space: null }), "/connections"],
  [event("connection_accepted", "collaboration", {
    type: "connection", connectionId: resourceId, status: "accepted", otherUser: actor,
  }, { type: "connection", connectionId: resourceId }, { space: null }), "/connections"],
  [event("space_created", "collaboration", {
    type: "space", spaceId, name: space.name,
  }, { type: "space", spaceId }), `/spaces/${spaceId}`],
  [event("member_joined", "collaboration", {
    type: "member", userId, displayName: actor.displayName,
  }, { type: "space_member", spaceId, userId }), `/spaces/${spaceId}/members`],
  [event("chat_message_created", "collaboration", {
    type: "chat_message", messageId: resourceId,
  }, { type: "chat_message", spaceId, messageId: resourceId }), `/spaces/${spaceId}/chat`],
  [event("paper_saved", "research", {
    type: "paper",
    paperId: resourceId,
    title: "Bounded Graph Retrieval",
    canonicalArxivId: "2609.00001",
    versionedArxivId: "2609.00001v2",
  }, { type: "saved_paper", spaceId, paperId: resourceId }), `/research/papers/${resourceId}`],
  [event("document_uploaded", "knowledge", {
    type: "document", documentId: resourceId, originalFilename: "field-notes.pdf", status: "processing",
  }, { type: "document", spaceId, documentId: resourceId }), `/spaces/${spaceId}/knowledge`],
  [event("agent_task_created", "agents", {
    type: "agent_task", taskId: resourceId, agentId, agentName: "Research Agent",
  }, { type: "agent_task", spaceId, taskId: resourceId }), `/agents/tasks/${resourceId}`],
  [event("agent_run_created", "agents", {
    type: "agent_run",
    runId: resourceId,
    taskId: userId,
    agentId,
    agentName: "Research Agent",
    attemptNumber: 2,
    status: "running",
  }, { type: "agent_run", spaceId, taskId: userId, runId: resourceId }), `/agents/runs/${resourceId}`],
];

describe("Activity presentation", () => {
  it.each(cases)("renders an explicit route for $kind", (activityEvent, expectedHref) => {
    const presentation = getActivityEventPresentation(activityEvent);
    expect(presentation.href).toBe(expectedHref);
    expect(presentation.title.length).toBeGreaterThan(0);
    expect(presentation.kindLabel.length).toBeGreaterThan(0);
  });

  it("uses neutral language when the actor is unavailable", () => {
    const activityEvent = event("document_uploaded", "knowledge", {
      type: "document", documentId: resourceId, originalFilename: "notes.txt", status: "queued",
    }, { type: "document", spaceId, documentId: resourceId }, { actor: null });

    expect(getActivityEventPresentation(activityEvent).title).toContain("A workspace member");
  });

  it("degrades a valid but mismatched subject and target shape safely", () => {
    const activityEvent = event("space_created", "collaboration", {
      type: "connection", connectionId: resourceId, status: "pending", otherUser: actor,
    }, { type: "connection", connectionId: resourceId }, { space: null });

    expect(getActivityEventPresentation(activityEvent)).toEqual({
      title: "Ada Lovelace recorded workspace activity",
      detail: "Space created",
      kindLabel: "Space created",
    });
  });
});
