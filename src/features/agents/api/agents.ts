import {
  agentDefinitionListResponseSchema,
  agentRunCreateResponseSchema,
  agentRunResponseSchema,
  agentRunTraceResponseSchema,
  agentTaskCreateResponseSchema,
  agentTaskListResponseSchema,
  agentTaskResponseSchema,
  type AgentDefinition,
  type AgentRunCreateResponse,
  type AgentRunResponse,
  type AgentRunStatus,
  type AgentRunTraceResponse,
  type AgentTaskCreateResponse,
  type AgentTaskListResponse,
  type AgentTaskResponse,
  type CreateAgentTaskInput,
  type RetryAgentTaskInput,
} from "../../../../shared/contracts/agents";
import { apiRequest } from "../../../services/api/client";

export interface AgentTaskListFilters {
  agentId?: string;
  cursor?: string;
  limit?: number;
  status?: AgentRunStatus;
}

export async function listAgentDefinitions(): Promise<AgentDefinition[]> {
  return (
    await apiRequest("/api/v1/agents", agentDefinitionListResponseSchema)
  ).agents;
}

export async function createAgentTask(
  spaceId: string,
  input: CreateAgentTaskInput,
): Promise<AgentTaskCreateResponse> {
  return apiRequest(
    "/api/v1/spaces/" + spaceId + "/agent-tasks",
    agentTaskCreateResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(input),
      acceptedStatuses: [200, 202],
    },
  );
}

export async function listAgentTasks(
  spaceId: string,
  filters: AgentTaskListFilters = {},
): Promise<AgentTaskListResponse> {
  const search = new URLSearchParams();
  if (filters.cursor) search.set("cursor", filters.cursor);
  if (filters.limit !== undefined) search.set("limit", String(filters.limit));
  if (filters.status) search.set("status", filters.status);
  if (filters.agentId) search.set("agentId", filters.agentId);
  const query = search.size > 0 ? "?" + search.toString() : "";
  return apiRequest(
    "/api/v1/spaces/" + spaceId + "/agent-tasks" + query,
    agentTaskListResponseSchema,
  );
}

export async function getAgentTask(taskId: string): Promise<AgentTaskResponse> {
  return apiRequest("/api/v1/agent-tasks/" + taskId, agentTaskResponseSchema);
}

export async function retryAgentTask(
  taskId: string,
  input: RetryAgentTaskInput,
): Promise<AgentRunCreateResponse> {
  return apiRequest(
    "/api/v1/agent-tasks/" + taskId + "/runs",
    agentRunCreateResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(input),
      acceptedStatuses: [200, 202],
    },
  );
}

export async function getAgentRun(runId: string): Promise<AgentRunResponse> {
  return apiRequest("/api/v1/agent-runs/" + runId, agentRunResponseSchema);
}

export async function getAgentRunTrace(runId: string): Promise<AgentRunTraceResponse> {
  return apiRequest(
    "/api/v1/agent-runs/" + runId + "/steps",
    agentRunTraceResponseSchema,
  );
}

export async function cancelAgentRun(runId: string): Promise<AgentRunResponse> {
  return apiRequest(
    "/api/v1/agent-runs/" + runId + "/cancel",
    agentRunResponseSchema,
    { method: "POST", body: JSON.stringify({}) },
  );
}
