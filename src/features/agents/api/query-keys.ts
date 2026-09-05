import type { AgentRunStatus } from "../../../../shared/contracts/agents";

interface AgentTaskListKeyInput {
  agentId?: string;
  spaceId: string;
  status?: AgentRunStatus;
}

export const agentQueryKeys = {
  all: ["agents"] as const,
  definitions: () => [...agentQueryKeys.all, "definitions"] as const,
  tasks: () => [...agentQueryKeys.all, "tasks"] as const,
  taskList: ({ spaceId, status, agentId }: AgentTaskListKeyInput) =>
    [...agentQueryKeys.tasks(), "list", spaceId, status ?? "all", agentId ?? "all"] as const,
  task: (taskId: string) => [...agentQueryKeys.tasks(), "detail", taskId] as const,
  runs: () => [...agentQueryKeys.all, "runs"] as const,
  run: (runId: string) => [...agentQueryKeys.runs(), "detail", runId] as const,
  trace: (runId: string) => [...agentQueryKeys.runs(), "trace", runId] as const,
};
