import type {
  OverviewActiveWork,
  OverviewRecentSpace,
} from "../../../shared/contracts/overview";
import { getActivityKindLabel } from "../activity/activity-presentation";

export interface OverviewRecentSpacePresentation {
  activityLabel: string;
  href: string;
}

export interface OverviewActiveWorkPresentation {
  title: string;
  typeLabel: string;
  statusLabel: string;
  stageLabel?: string;
  href: string;
}

export function getOverviewRecentSpacePresentation(
  item: OverviewRecentSpace,
): OverviewRecentSpacePresentation {
  return {
    activityLabel: getActivityKindLabel(item.lastActivityKind),
    href: `/spaces/${item.space.id}`,
  };
}

export function getOverviewActiveWorkPresentation(
  item: OverviewActiveWork,
): OverviewActiveWorkPresentation {
  if (item.kind === "document") {
    return {
      title: item.document.originalFilename,
      typeLabel: "Document",
      statusLabel: item.document.status === "queued" ? "Queued" : "Processing",
      ...(item.document.stage ? { stageLabel: capitalize(item.document.stage) } : {}),
      href: `/spaces/${item.space.id}/knowledge`,
    };
  }

  return {
    title: `${item.run.agentName} · run #${item.run.attemptNumber}`,
    typeLabel: "Agent Run",
    statusLabel: item.run.status === "queued" ? "Queued" : "Running",
    href: `/agents/runs/${item.run.id}`,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
