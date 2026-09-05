import type {
  AgentDefinitionAvailability,
  AgentRun,
} from "../../../../shared/contracts/agents";
import {
  getAgentAvailabilityPresentation,
  getAgentRunStatusPresentation,
  type AgentStatusPresentation,
} from "../agent-presentation";

interface AnnounceableStatusProps {
  announce?: boolean;
  announcementLabel?: string;
}

function StatusBadge({
  announce = false,
  announcementLabel,
  status,
}: AnnounceableStatusProps & { status: AgentStatusPresentation }) {
  return (
    <span
      aria-atomic={announce ? true : undefined}
      aria-live={announce ? "polite" : undefined}
      className={"rw-status-badge rw-status-badge--" + status.tone}
      role={announce ? "status" : undefined}
    >
      {announce && announcementLabel ? (
        <span className="rw-visually-hidden">{announcementLabel}: </span>
      ) : null}
      {status.label}
    </span>
  );
}

export function AgentStatusBadge({
  announce,
  announcementLabel,
  run,
}: AnnounceableStatusProps & { run: AgentRun }) {
  return (
    <StatusBadge
      announce={announce}
      announcementLabel={announcementLabel}
      status={getAgentRunStatusPresentation(run)}
    />
  );
}

export function AgentAvailabilityBadge({
  announce,
  announcementLabel,
  availability,
}: AnnounceableStatusProps & { availability: AgentDefinitionAvailability }) {
  return (
    <StatusBadge
      announce={announce}
      announcementLabel={announcementLabel}
      status={getAgentAvailabilityPresentation(availability)}
    />
  );
}
