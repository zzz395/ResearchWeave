import {
  agentCommandErrorCodeSchema,
  agentRunStatusSchema,
  type AgentCommandErrorCode,
  type AgentDefinitionAvailability,
  type AgentErrorCode,
  type AgentEvidence,
  type AgentRun,
  type AgentRunStatus,
  type AgentToolName,
} from "../../../shared/contracts/agents";
import { ApiClientError } from "../../services/api/client";

export type AgentStatusTone = "neutral" | "active" | "success" | "danger";

export interface AgentStatusPresentation {
  label: string;
  tone: AgentStatusTone;
}

export interface AgentTaskUrlState {
  agentId?: string;
  spaceId?: string;
  status?: AgentRunStatus;
}

export interface ClientRequestIdentity {
  fingerprint: string;
  id: string;
}

export interface AgentEvidenceLink {
  external: boolean;
  href: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const statusPresentations: Record<AgentRunStatus, AgentStatusPresentation> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "active" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const toolLabels: Record<AgentToolName, string> = {
  search_arxiv: "Search arXiv",
  search_knowledge_base: "Search Knowledge Base",
  ask_knowledge: "Ask Knowledge",
};

const executionErrorMessages: Record<AgentErrorCode, string> = {
  agent_space_access_revoked: "Space access changed while this run was executing.",
  agent_provider_timeout: "The decision provider timed out.",
  agent_provider_unavailable: "The decision provider was unavailable.",
  agent_provider_rejected: "The decision provider rejected the request.",
  agent_provider_invalid_response: "The decision provider returned an invalid response.",
  agent_tool_not_allowed: "The requested tool is not allowed for this Agent.",
  agent_tool_invalid_arguments: "A tool call used invalid arguments.",
  agent_tool_invalid_response: "A tool returned an invalid response.",
  agent_tool_timeout: "A tool call timed out.",
  agent_step_limit_exceeded: "The run reached its step limit.",
  agent_tool_call_limit_exceeded: "The run reached its tool-call limit.",
  agent_context_limit_exceeded: "The run reached its context limit.",
  agent_wall_time_exceeded: "The run reached its wall-time limit.",
  agent_observation_too_large: "A tool observation exceeded the safe size limit.",
  agent_evidence_limit_exceeded: "The run reached its evidence limit.",
  agent_invalid_final_answer: "The final answer did not satisfy the evidence contract.",
  agent_persistence_failed: "The run could not safely persist its progress.",
  knowledge_not_indexed: "No active indexed knowledge was available.",
  knowledge_embedding_incompatible: "The active knowledge index is incompatible.",
  retrieval_embedding_unconfigured: "Knowledge retrieval is not configured.",
  retrieval_embedding_unavailable: "Knowledge retrieval was unavailable.",
  retrieval_embedding_rejected: "Knowledge retrieval rejected the request.",
  retrieval_embedding_invalid_response: "Knowledge retrieval returned an invalid response.",
  research_temporarily_unavailable: "Research search was temporarily unavailable.",
  research_upstream_failure: "Research search failed upstream.",
  research_upstream_timeout: "Research search timed out upstream.",
  answer_generation_unavailable: "Grounded answer generation is unavailable.",
  answer_invalid_response: "Grounded answer generation returned an invalid response.",
  answer_upstream_failure: "Grounded answer generation failed upstream.",
  answer_upstream_timeout: "Grounded answer generation timed out upstream.",
};

const commandErrorMessages: Record<AgentCommandErrorCode, string> = {
  agent_not_found: "This Agent definition could not be found.",
  agent_task_not_found: "This Agent task could not be found.",
  agent_run_not_found: "This Agent run could not be found.",
  agent_runtime_unavailable: "The Agent runtime is not ready. Try again when it becomes available.",
  agent_disabled: "This Agent is currently disabled.",
  agent_idempotency_conflict: "This request identifier is already associated with different input.",
  agent_retry_not_allowed: "Only the latest terminal run can be retried.",
  agent_run_terminal: "This run has already reached a terminal state.",
  invalid_agent_task_cursor: "The task list cursor is no longer valid.",
  space_not_found: "This Research Space could not be found.",
};

export function getAgentRunStatusPresentation(run: AgentRun): AgentStatusPresentation {
  if (run.status === "running" && run.cancelRequestedAt !== null) {
    return { label: "Cancel requested", tone: "active" };
  }
  return statusPresentations[run.status];
}

export function isAgentRunActive(run: Pick<AgentRun, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

export function isAgentRunTerminal(run: Pick<AgentRun, "status">): boolean {
  return !isAgentRunActive(run);
}

export function shouldPollAgentDefinitions(
  definitions: readonly { availability: AgentDefinitionAvailability }[] | undefined,
): boolean {
  return definitions?.some(
    ({ availability }) =>
      !availability.available && availability.reason === "runtime_unavailable",
  ) ?? false;
}

export function shouldPollAgentRuns(
  runs: readonly Pick<AgentRun, "status">[] | undefined,
): boolean {
  return runs?.some(isAgentRunActive) ?? false;
}

export function getAgentAvailabilityPresentation(
  availability: AgentDefinitionAvailability,
): AgentStatusPresentation & { detail: string } {
  if (availability.available) {
    return {
      label: "Ready",
      tone: "success",
      detail: "The runtime completed its initial claim probe and can accept work.",
    };
  }
  if (availability.reason === "provider_unconfigured") {
    return {
      label: "Provider not configured",
      tone: "neutral",
      detail: "Configure the complete LLM environment to enable Agent execution.",
    };
  }
  if (availability.reason === "agent_disabled") {
    return {
      label: "Disabled",
      tone: "neutral",
      detail: "This system-managed Agent is not accepting new work.",
    };
  }
  return {
    label: "Runtime unavailable",
    tone: "active",
    detail: "The configured runtime is starting or temporarily unavailable.",
  };
}

export function getAgentToolLabel(tool: AgentToolName): string {
  return toolLabels[tool];
}

export function getAgentExecutionErrorMessage(code: AgentErrorCode): string {
  return executionErrorMessages[code];
}

export function getAgentCommandErrorMessage(code: AgentCommandErrorCode): string {
  return commandErrorMessages[code];
}

export function getAgentApiErrorMessage(error: ApiClientError): string {
  const commandCode = agentCommandErrorCodeSchema.safeParse(error.code);
  return commandCode.success
    ? getAgentCommandErrorMessage(commandCode.data)
    : error.message;
}

export function parseAgentTaskSearchParams(search: URLSearchParams): AgentTaskUrlState {
  const spaceId = search.get("space") ?? undefined;
  const agentId = search.get("agent") ?? undefined;
  const parsedStatus = agentRunStatusSchema.safeParse(search.get("status"));
  return {
    ...(spaceId && UUID_PATTERN.test(spaceId) ? { spaceId } : {}),
    ...(agentId && UUID_PATTERN.test(agentId) ? { agentId } : {}),
    ...(parsedStatus.success ? { status: parsedStatus.data } : {}),
  };
}

export function createAgentTaskSearchParams(state: AgentTaskUrlState): URLSearchParams {
  const search = new URLSearchParams();
  if (state.spaceId) search.set("space", state.spaceId);
  if (state.agentId) search.set("agent", state.agentId);
  if (state.status) search.set("status", state.status);
  return search;
}

export function resolveClientRequestIdentity(
  current: ClientRequestIdentity | null,
  fingerprint: string,
  createId: () => string = () => crypto.randomUUID(),
): ClientRequestIdentity {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, id: createId() };
}

export function getAgentEvidenceLink(
  evidence: AgentEvidence,
  spaceId: string,
): AgentEvidenceLink | null {
  if (evidence.kind === "arxiv_abstract") {
    return evidence.paperId
      ? { external: false, href: "/research/papers/" + evidence.paperId }
      : { external: true, href: evidence.url };
  }
  if (!evidence.available) return null;
  return evidence.documentId
    ? {
        external: false,
        href:
          "/spaces/" +
          spaceId +
          "/knowledge?document=" +
          encodeURIComponent(evidence.documentId),
      }
    : null;
}

export function isAgentAccessRevocation(
  error: unknown,
  hadSuccessfulData: boolean,
): error is ApiClientError {
  if (!hadSuccessfulData || !(error instanceof ApiClientError) || error.status !== 404) {
    return false;
  }
  return error.code === "space_not_found"
    || error.code === "agent_task_not_found"
    || error.code === "agent_run_not_found";
}
