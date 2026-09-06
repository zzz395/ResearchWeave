import type {
  ActivityCategory,
  ActivityEvent,
  ActivityKind,
} from "../../../shared/contracts/activity";

export interface ActivityEventPresentation {
  title: string;
  detail: string;
  href?: string;
  kindLabel: string;
}

const kindLabels: Record<ActivityKind, string> = {
  connection_requested: "Connection requested",
  connection_accepted: "Connection accepted",
  space_created: "Space created",
  member_joined: "Member joined",
  chat_message_created: "Chat message created",
  paper_saved: "Paper saved",
  document_uploaded: "Document uploaded",
  agent_task_created: "Agent task created",
  agent_run_created: "Agent run created",
};

const categoryLabels: Record<ActivityCategory, string> = {
  collaboration: "Collaboration",
  research: "Research",
  knowledge: "Knowledge",
  agents: "Agents",
};

export function getActivityKindLabel(kind: ActivityKind): string {
  return kindLabels[kind];
}

export function getActivityCategoryLabel(category: ActivityCategory): string {
  return categoryLabels[category];
}

function actorName(event: ActivityEvent): string {
  return event.actor?.displayName ?? "A workspace member";
}

function spaceDetail(event: ActivityEvent): string {
  return event.space ? `In ${event.space.name}` : "In your workspace";
}

function genericPresentation(event: ActivityEvent): ActivityEventPresentation {
  return {
    title: `${actorName(event)} recorded workspace activity`,
    detail: event.space ? `${kindLabels[event.kind]} · ${event.space.name}` : kindLabels[event.kind],
    ...(event.space ? { href: `/spaces/${event.space.id}` } : {}),
    kindLabel: kindLabels[event.kind],
  };
}

export function getActivityEventPresentation(
  event: ActivityEvent,
): ActivityEventPresentation {
  const kindLabel = kindLabels[event.kind];

  switch (event.kind) {
    case "connection_requested":
      if (event.subject.type === "connection" && event.target.type === "connection") {
        return {
          title: `${actorName(event)} sent a connection request`,
          detail: `Connection with ${event.subject.otherUser.displayName}`,
          href: "/connections",
          kindLabel,
        };
      }
      break;
    case "connection_accepted":
      if (event.subject.type === "connection" && event.target.type === "connection") {
        return {
          title: `${actorName(event)} accepted a connection`,
          detail: `Connection with ${event.subject.otherUser.displayName}`,
          href: "/connections",
          kindLabel,
        };
      }
      break;
    case "space_created":
      if (event.subject.type === "space" && event.target.type === "space") {
        return {
          title: `${actorName(event)} created ${event.subject.name}`,
          detail: "A new Research Space is available",
          href: `/spaces/${event.target.spaceId}`,
          kindLabel,
        };
      }
      break;
    case "member_joined":
      if (event.subject.type === "member" && event.target.type === "space_member") {
        return {
          title: `${actorName(event)} joined ${event.space?.name ?? "a Research Space"}`,
          detail: "Space membership added",
          href: `/spaces/${event.target.spaceId}/members`,
          kindLabel,
        };
      }
      break;
    case "chat_message_created":
      if (event.subject.type === "chat_message" && event.target.type === "chat_message") {
        return {
          title: `${actorName(event)} added a chat message`,
          detail: spaceDetail(event),
          href: `/spaces/${event.target.spaceId}/chat`,
          kindLabel,
        };
      }
      break;
    case "paper_saved":
      if (event.subject.type === "paper" && event.target.type === "saved_paper") {
        return {
          title: `${actorName(event)} saved “${event.subject.title}”`,
          detail: `${event.subject.versionedArxivId} · ${event.space?.name ?? "Research Space"}`,
          href: `/research/papers/${event.subject.paperId}`,
          kindLabel,
        };
      }
      break;
    case "document_uploaded":
      if (event.subject.type === "document" && event.target.type === "document") {
        return {
          title: `${actorName(event)} uploaded ${event.subject.originalFilename}`,
          detail: `${event.space?.name ?? "Research Space"} · ${capitalize(event.subject.status)}`,
          href: `/spaces/${event.target.spaceId}/knowledge`,
          kindLabel,
        };
      }
      break;
    case "agent_task_created":
      if (event.subject.type === "agent_task" && event.target.type === "agent_task") {
        return {
          title: `${actorName(event)} created a task for ${event.subject.agentName}`,
          detail: spaceDetail(event),
          href: `/agents/tasks/${event.target.taskId}`,
          kindLabel,
        };
      }
      break;
    case "agent_run_created":
      if (event.subject.type === "agent_run" && event.target.type === "agent_run") {
        return {
          title: `${actorName(event)} started ${event.subject.agentName} run #${event.subject.attemptNumber}`,
          detail: `${event.space?.name ?? "Research Space"} · ${capitalize(event.subject.status)}`,
          href: `/agents/runs/${event.target.runId}`,
          kindLabel,
        };
      }
      break;
  }

  return genericPresentation(event);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
