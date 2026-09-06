import {
  ACTIVITY_ARXIV_ID_MAX_CHARACTERS,
  ACTIVITY_PAPER_TITLE_MAX_CHARACTERS,
  truncateActivitySummary,
  type ActivityEvent,
} from "../../shared/contracts/activity";
import type { OverviewActiveWork } from "../../shared/contracts/overview";
import type {
  ActivityProjectionRecord,
  ActivityRepository,
} from "../../server/modules/activity/repository";
import type { InMemoryAgentRepository } from "./in-memory-agent-repository";
import type {
  InMemoryAuthRepository,
  InMemoryChatRepository,
  InMemoryConnectionRepository,
  InMemoryDocumentRepository,
  InMemoryMemberRepository,
  InMemoryPaperRepository,
  InMemorySavedPaperRepository,
  InMemorySpaceRepository,
} from "./in-memory-repositories";

type EventDraft = Omit<ActivityEvent, "occurredAt"> & { occurredAt: Date };
type ActiveWorkDraft =
  | (Omit<Extract<OverviewActiveWork, { kind: "document" }>, "updatedAt"> & {
      updatedAt: Date;
      stableKey: string;
    })
  | (Omit<Extract<OverviewActiveWork, { kind: "agent_run" }>, "updatedAt"> & {
      updatedAt: Date;
      stableKey: string;
    });

function compareEvents(left: EventDraft, right: EventDraft): number {
  return right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id);
}

export class InMemoryActivityRepository implements ActivityRepository {
  constructor(private readonly sources: {
    auth: InMemoryAuthRepository;
    spaces: InMemorySpaceRepository;
    connections: InMemoryConnectionRepository;
    members: InMemoryMemberRepository;
    chat: InMemoryChatRepository;
    papers: InMemoryPaperRepository;
    savedPapers: InMemorySavedPaperRepository;
    documents: InMemoryDocumentRepository;
    agents: InMemoryAgentRepository;
  }) {}

  private actor(userId: string | null) {
    const user = userId ? this.sources.auth.users.get(userId) : undefined;
    return user ? { id: user.id, displayName: user.displayName } : null;
  }

  private space(spaceId: string) {
    const space = this.sources.spaces.spaces.get(spaceId);
    return space ? { id: space.id, name: space.name } : null;
  }

  private accessible(spaceId: string, actorId: string) {
    return Boolean(this.space(spaceId)) && this.sources.spaces.hasMembership(spaceId, actorId);
  }

  private allEvents(actorId: string): ActivityProjectionRecord[] {
    const events: EventDraft[] = [];
    for (const connection of this.sources.connections.connections.values()) {
      if (connection.userLowId !== actorId && connection.userHighId !== actorId) continue;
      const otherUserId = connection.userLowId === actorId
        ? connection.userHighId
        : connection.userLowId;
      const otherUser = this.actor(otherUserId);
      const requester = this.actor(connection.requestedByUserId);
      if (!otherUser || !requester) continue;
      events.push({
        id: `connection_requested:${connection.id}`,
        kind: "connection_requested",
        category: "collaboration",
        occurredAt: connection.createdAt,
        actor: requester,
        space: null,
        subject: {
          type: "connection",
          connectionId: connection.id,
          status: connection.status,
          otherUser,
        },
        target: { type: "connection", connectionId: connection.id },
      });
      if (connection.status === "accepted" && connection.respondedAt) {
        const responderId = connection.requestedByUserId === connection.userLowId
          ? connection.userHighId
          : connection.userLowId;
        events.push({
          id: `connection_accepted:${connection.id}`,
          kind: "connection_accepted",
          category: "collaboration",
          occurredAt: connection.respondedAt,
          actor: this.actor(responderId),
          space: null,
          subject: {
            type: "connection",
            connectionId: connection.id,
            status: "accepted",
            otherUser,
          },
          target: { type: "connection", connectionId: connection.id },
        });
      }
    }

    for (const spaceRecord of this.sources.spaces.spaces.values()) {
      if (!this.accessible(spaceRecord.id, actorId)) continue;
      const space = { id: spaceRecord.id, name: spaceRecord.name };
      events.push({
        id: `space_created:${spaceRecord.id}`,
        kind: "space_created",
        category: "collaboration",
        occurredAt: spaceRecord.createdAt,
        actor: this.actor(spaceRecord.ownerId),
        space,
        subject: { type: "space", spaceId: spaceRecord.id, name: spaceRecord.name },
        target: { type: "space", spaceId: spaceRecord.id },
      });
      const prefix = `${spaceRecord.id}:`;
      for (const [membershipKey] of this.sources.spaces.memberships) {
        if (!membershipKey.startsWith(prefix)) continue;
        const userId = membershipKey.slice(prefix.length);
        const member = this.actor(userId);
        if (!member) continue;
        events.push({
          id: `member_joined:${spaceRecord.id}:${userId}`,
          kind: "member_joined",
          category: "collaboration",
          occurredAt: this.sources.members.joinedAt.get(membershipKey) ?? spaceRecord.createdAt,
          actor: member,
          space,
          subject: { type: "member", userId, displayName: member.displayName },
          target: { type: "space_member", spaceId: spaceRecord.id, userId },
        });
      }
    }

    for (const message of this.sources.chat.messages) {
      if (!this.accessible(message.spaceId, actorId)) continue;
      const space = this.space(message.spaceId);
      const sender = this.actor(message.senderUserId);
      if (!space || !sender) continue;
      events.push({
        id: `chat_message_created:${message.id}`,
        kind: "chat_message_created",
        category: "collaboration",
        occurredAt: message.createdAt,
        actor: sender,
        space,
        subject: { type: "chat_message", messageId: message.id },
        target: { type: "chat_message", spaceId: message.spaceId, messageId: message.id },
      });
    }

    for (const saved of this.sources.savedPapers.savedPapers.values()) {
      if (!this.accessible(saved.spaceId, actorId)) continue;
      const space = this.space(saved.spaceId);
      const paper = this.sources.papers.papers.get(saved.paperId);
      if (!space || !paper) continue;
      events.push({
        id: `paper_saved:${saved.spaceId}:${saved.paperId}`,
        kind: "paper_saved",
        category: "research",
        occurredAt: saved.savedAt,
        actor: this.actor(saved.savedByUserId),
        space,
        subject: {
          type: "paper",
          paperId: paper.id,
          title: truncateActivitySummary(paper.title, ACTIVITY_PAPER_TITLE_MAX_CHARACTERS),
          canonicalArxivId: truncateActivitySummary(
            paper.canonicalArxivId,
            ACTIVITY_ARXIV_ID_MAX_CHARACTERS,
          ),
          versionedArxivId: truncateActivitySummary(
            paper.versionedArxivId,
            ACTIVITY_ARXIV_ID_MAX_CHARACTERS,
          ),
        },
        target: { type: "saved_paper", spaceId: saved.spaceId, paperId: paper.id },
      });
    }

    for (const document of this.sources.documents.documents.values()) {
      if (!this.accessible(document.spaceId, actorId)) continue;
      const space = this.space(document.spaceId);
      if (!space) continue;
      events.push({
        id: `document_uploaded:${document.id}`,
        kind: "document_uploaded",
        category: "knowledge",
        occurredAt: document.createdAt,
        actor: this.actor(document.uploadedByUserId),
        space,
        subject: {
          type: "document",
          documentId: document.id,
          originalFilename: document.originalFilename,
          status: document.status,
        },
        target: { type: "document", spaceId: document.spaceId, documentId: document.id },
      });
    }

    for (const task of this.sources.agents.tasks.values()) {
      if (!this.accessible(task.spaceId, actorId)) continue;
      const space = this.space(task.spaceId);
      const definition = this.sources.agents.definitions.get(task.agentId)?.definition;
      if (!space || !definition) continue;
      events.push({
        id: `agent_task_created:${task.id}`,
        kind: "agent_task_created",
        category: "agents",
        occurredAt: task.createdAt,
        actor: this.actor(task.createdByUserId),
        space,
        subject: {
          type: "agent_task",
          taskId: task.id,
          agentId: definition.id,
          agentName: definition.name,
        },
        target: { type: "agent_task", spaceId: task.spaceId, taskId: task.id },
      });
    }

    for (const run of this.sources.agents.runs.values()) {
      if (!this.accessible(run.spaceId, actorId)) continue;
      const task = this.sources.agents.tasks.get(run.taskId);
      const definition = task
        ? this.sources.agents.definitions.get(task.agentId)?.definition
        : undefined;
      const space = this.space(run.spaceId);
      if (!task || !definition || !space) continue;
      events.push({
        id: `agent_run_created:${run.id}`,
        kind: "agent_run_created",
        category: "agents",
        occurredAt: run.createdAt,
        actor: this.actor(run.actorUserId),
        space,
        subject: {
          type: "agent_run",
          runId: run.id,
          taskId: run.taskId,
          agentId: definition.id,
          agentName: definition.name,
          attemptNumber: run.attemptNumber,
          status: run.status,
        },
        target: { type: "agent_run", spaceId: run.spaceId, taskId: run.taskId, runId: run.id },
      });
    }
    return events.sort(compareEvents);
  }

  listForActor: ActivityRepository["listForActor"] = (actorId, query) => {
    if (query.spaceId && !this.accessible(query.spaceId, actorId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    const records = this.allEvents(actorId)
      .filter((event) => !query.spaceId || event.space?.id === query.spaceId)
      .filter((event) => !query.category || event.category === query.category)
      .filter((event) => !query.cursor ||
        event.occurredAt < query.cursor.occurredAt ||
        (event.occurredAt.getTime() === query.cursor.occurredAt.getTime() &&
          event.id < query.cursor.stableEventKey))
      .slice(0, query.limit);
    return Promise.resolve({ status: "ok", records });
  };

  getOverviewForActor: ActivityRepository["getOverviewForActor"] = (actorId) => {
    const events = this.allEvents(actorId);
    const latestBySpace = new Map<string, ActivityProjectionRecord>();
    for (const event of events) {
      if (event.space && !latestBySpace.has(event.space.id)) latestBySpace.set(event.space.id, event);
    }
    const recentSpaces = [...latestBySpace.values()].slice(0, 4).map((event) => ({
      space: event.space!,
      lastActivityAt: event.occurredAt,
      lastActivityKind: event.kind,
    }));

    const activeWork: ActiveWorkDraft[] = [];
    for (const document of this.sources.documents.documents.values()) {
      if (!this.accessible(document.spaceId, actorId) ||
          (document.status !== "queued" && document.status !== "processing")) continue;
      const space = this.space(document.spaceId)!;
      activeWork.push({
        kind: "document",
        space,
        updatedAt: document.updatedAt,
        stableKey: `document:${document.id}`,
        document: {
          id: document.id,
          originalFilename: document.originalFilename,
          status: document.status,
          stage: document.stage,
        },
      });
    }
    for (const run of this.sources.agents.runs.values()) {
      if (!this.accessible(run.spaceId, actorId) ||
          (run.status !== "queued" && run.status !== "running")) continue;
      const task = this.sources.agents.tasks.get(run.taskId);
      const definition = task
        ? this.sources.agents.definitions.get(task.agentId)?.definition
        : undefined;
      if (!task || !definition) continue;
      activeWork.push({
        kind: "agent_run",
        space: this.space(run.spaceId)!,
        updatedAt: run.updatedAt,
        stableKey: `agent_run:${run.id}`,
        run: {
          id: run.id,
          taskId: run.taskId,
          agentId: definition.id,
          agentName: definition.name,
          attemptNumber: run.attemptNumber,
          status: run.status,
        },
      });
    }
    activeWork.sort((left, right) =>
      right.updatedAt.getTime() - left.updatedAt.getTime() || right.stableKey.localeCompare(left.stableKey));

    return Promise.resolve({
      recentSpaces,
      activeWork: activeWork.slice(0, 6).map(({ stableKey, ...item }) => {
        if (stableKey.length === 0) throw new Error("Active work stable key is empty.");
        return item;
      }),
      recentActivity: events.slice(0, 8),
    });
  };
}
