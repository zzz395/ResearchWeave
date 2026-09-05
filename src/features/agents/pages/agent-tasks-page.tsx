import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Filter, ListChecks } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import type { AgentRunStatus } from "../../../../shared/contracts/agents";
import { Button } from "../../../components/ui/button";
import { EmptyState, ErrorPanel, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { queryClient } from "../../../app/query-client";
import { ApiClientError } from "../../../services/api/client";
import { REALTIME_ACCESS_REVOKED_EVENT } from "../../../services/realtime/realtime-context";
import { listSpaces } from "../../spaces/api/spaces";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import { formatResearchDate } from "../../spaces/format-research-date";
import {
  createAgentTaskSearchParams,
  isAgentAccessRevocation,
  parseAgentTaskSearchParams,
  shouldPollAgentDefinitions,
  shouldPollAgentRuns,
} from "../agent-presentation";
import { listAgentDefinitions, listAgentTasks } from "../api/agents";
import { agentQueryKeys } from "../api/query-keys";
import { AgentStatusBadge } from "../components/agent-status-badge";
import { NewAgentTaskDialog } from "../components/new-agent-task-dialog";

const PAGE_SIZE = 20;
const statuses: readonly AgentRunStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];

export function Component() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = parseAgentTaskSearchParams(searchParams);
  const spacesQuery = useQuery({ queryKey: ["spaces"], queryFn: listSpaces });
  const definitionsQuery = useQuery({
    queryKey: agentQueryKeys.definitions(),
    queryFn: listAgentDefinitions,
    refetchInterval: (query) =>
      shouldPollAgentDefinitions(query.state.data) ? 2_000 : false,
  });
  const selectedSpace = spacesQuery.data?.find((space) => space.id === urlState.spaceId);
  const tasksQuery = useInfiniteQuery({
    queryKey: agentQueryKeys.taskList({
      spaceId: urlState.spaceId ?? "",
      status: urlState.status,
      agentId: urlState.agentId,
    }),
    queryFn: ({ pageParam }) =>
      listAgentTasks(urlState.spaceId ?? "", {
        cursor: pageParam,
        limit: PAGE_SIZE,
        status: urlState.status,
        agentId: urlState.agentId,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: selectedSpace !== undefined,
    refetchInterval: (query) => {
      const runs = query.state.data?.pages.flatMap((page) =>
        page.tasks.map((task) => task.latestRun)
      );
      return shouldPollAgentRuns(runs) ? 2_000 : false;
    },
  });
  const tasks = useMemo(
    () => tasksQuery.data?.pages.flatMap((page) => page.tasks) ?? [],
    [tasksQuery.data],
  );

  useEffect(() => {
    if (!urlState.spaceId) return;
    if (!isAgentAccessRevocation(tasksQuery.error, tasksQuery.data !== undefined)) return;
    queryClient.removeQueries({ queryKey: agentQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["spaces"], exact: true });
    window.dispatchEvent(new CustomEvent(REALTIME_ACCESS_REVOKED_EVENT, {
      detail: { spaceId: urlState.spaceId, reason: "membership_changed" },
    }));
  }, [tasksQuery.data, tasksQuery.error, urlState.spaceId]);

  if (spacesQuery.isPending || definitionsQuery.isPending) {
    return <PageLoading label="Loading Agent tasks" />;
  }
  if (spacesQuery.error || definitionsQuery.error) {
    const sourceError = spacesQuery.error ?? definitionsQuery.error;
    const error = sourceError instanceof ApiClientError ? sourceError : null;
    return (
      <ContentSection>
        <ErrorPanel
          message={error?.message ?? "Agent task controls could not be loaded."}
          onRetry={() => {
            void spacesQuery.refetch();
            void definitionsQuery.refetch();
          }}
          requestId={error?.requestId}
          title="Agent tasks could not be loaded"
        />
      </ContentSection>
    );
  }

  const spaces = spacesQuery.data;
  const agents = definitionsQuery.data;
  const initialAgentId = agents.some((agent) => agent.id === urlState.agentId)
    ? urlState.agentId
    : undefined;

  function updateFilters(next: {
    agentId?: string;
    spaceId?: string;
    status?: AgentRunStatus;
  }) {
    setSearchParams(createAgentTaskSearchParams(next));
  }

  return (
    <ContentSection>
      <PageHeader
        action={
          <NewAgentTaskDialog
            agents={agents}
            initialAgentId={initialAgentId}
            initialSpaceId={selectedSpace?.id}
            spaces={spaces}
          />
        }
        description="Each Task keeps its immutable prompt while every retry becomes a separately inspectable durable Run."
        kicker="Execution ledger"
        title="Agent tasks"
      />

      <section className="rw-agent-filters" aria-label="Agent task filters">
        <div className="rw-agent-filters__label">
          <Filter aria-hidden="true" size={16} />
          <span>Ledger scope</span>
        </div>
        <div className="rw-field">
          <div className="rw-field__label-row"><label htmlFor="agent-space-filter">Research Space</label></div>
          <select
            className="rw-input rw-select"
            id="agent-space-filter"
            onChange={(event) => updateFilters({
              ...urlState,
              spaceId: event.target.value || undefined,
            })}
            value={selectedSpace?.id ?? ""}
          >
            <option value="">Choose a Space</option>
            {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
          </select>
        </div>
        <div className="rw-field">
          <div className="rw-field__label-row"><label htmlFor="agent-definition-filter">Agent</label></div>
          <select
            className="rw-input rw-select"
            id="agent-definition-filter"
            onChange={(event) => updateFilters({
              ...urlState,
              agentId: event.target.value || undefined,
            })}
            value={initialAgentId ?? ""}
          >
            <option value="">All Agents</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </div>
        <div className="rw-field">
          <div className="rw-field__label-row"><label htmlFor="agent-status-filter">Latest status</label></div>
          <select
            className="rw-input rw-select"
            id="agent-status-filter"
            onChange={(event) => updateFilters({
              ...urlState,
              status: (event.target.value || undefined) as AgentRunStatus | undefined,
            })}
            value={urlState.status ?? ""}
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status[0]?.toUpperCase()}{status.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {spaces.length === 0 ? (
        <EmptyState className="rw-agent-empty">
          <ListChecks aria-hidden="true" size={30} />
          <div>
            <h2>Create a Research Space first</h2>
            <p>Agent Tasks always belong to an explicit Space and inherit its authorization boundary.</p>
            <Button asChild><Link to="/spaces/new">Create a Space</Link></Button>
          </div>
        </EmptyState>
      ) : !selectedSpace ? (
        <section className="rw-agent-ledger-intro">
          <Bot aria-hidden="true" size={30} />
          <div>
            <p className="rw-page-kicker">Select the authority boundary</p>
            <h2>Choose a Research Space to inspect its durable Agent work.</h2>
            <p>No cross-Space aggregation is performed. Task visibility follows current Space membership.</p>
          </div>
        </section>
      ) : tasksQuery.isPending ? (
        <PageLoading label={"Loading tasks for " + selectedSpace.name} />
      ) : tasksQuery.error && tasksQuery.data === undefined ? (
        <ErrorPanel
          message={tasksQuery.error instanceof ApiClientError
            ? tasksQuery.error.message
            : "Agent tasks could not be loaded."}
          onRetry={() => void tasksQuery.refetch()}
          requestId={tasksQuery.error instanceof ApiClientError
            ? tasksQuery.error.requestId
            : undefined}
          title="Task ledger could not be loaded"
        />
      ) : tasks.length === 0 ? (
        <EmptyState className="rw-agent-empty">
          <ListChecks aria-hidden="true" size={30} />
          <div>
            <h2>No tasks match this ledger view</h2>
            <p>Start a durable research task or broaden the Agent and status filters.</p>
          </div>
        </EmptyState>
      ) : (
        <section aria-busy={tasksQuery.isFetching} aria-label={"Agent tasks in " + selectedSpace.name}>
          <div className="rw-agent-ledger-heading">
            <div>
              <p className="rw-page-kicker">{selectedSpace.name}</p>
              <h2>Durable task records</h2>
            </div>
            <span>{tasks.length} loaded</span>
          </div>
          <div className="rw-agent-task-list">
            {tasks.map((task) => {
              const agent = agents.find((candidate) => candidate.id === task.agentId);
              return (
                <article className="rw-agent-task-row" key={task.id}>
                  <div className="rw-agent-task-row__attempt">
                    <span>Attempt</span>
                    <strong>{String(task.latestRun.attemptNumber).padStart(2, "0")}</strong>
                  </div>
                  <div className="rw-agent-task-row__content">
                    <div>
                      <span>{agent?.name ?? "System Agent"}</span>
                      <time dateTime={task.createdAt}>{formatResearchDate(task.createdAt)}</time>
                    </div>
                    <h3><Link to={"/agents/tasks/" + task.id}>{task.prompt}</Link></h3>
                    <small className="rw-mono">Task {task.id.slice(0, 8)} · Run {task.latestRun.id.slice(0, 8)}</small>
                  </div>
                  <div className="rw-agent-task-row__status">
                    <AgentStatusBadge
                      announce
                      announcementLabel={"Task " + task.id.slice(0, 8) + " latest run status"}
                      run={task.latestRun}
                    />
                    <span>{task.latestRun.stepCount} steps · {task.latestRun.toolCallCount} tools</span>
                  </div>
                  <Button asChild variant="ghost">
                    <Link aria-label={"Open task: " + task.prompt} to={"/agents/tasks/" + task.id}>
                      <ArrowRight aria-hidden="true" size={17} />
                    </Link>
                  </Button>
                </article>
              );
            })}
          </div>
          {tasksQuery.hasNextPage ? (
            <div className="rw-agent-load-more">
              <Button
                disabled={tasksQuery.isFetchingNextPage}
                onClick={() => void tasksQuery.fetchNextPage()}
                variant="secondary"
              >
                {tasksQuery.isFetchingNextPage
                  ? <LoadingLabel>Loading tasks</LoadingLabel>
                  : "Load more tasks"}
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </ContentSection>
  );
}
