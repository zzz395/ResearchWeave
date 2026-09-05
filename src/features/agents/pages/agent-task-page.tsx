import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import type { AgentRun } from "../../../../shared/contracts/agents";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { queryClient } from "../../../app/query-client";
import { ApiClientError } from "../../../services/api/client";
import { REALTIME_ACCESS_REVOKED_EVENT } from "../../../services/realtime/realtime-context";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import { formatResearchDate } from "../../spaces/format-research-date";
import {
  getAgentApiErrorMessage,
  getAgentExecutionErrorMessage,
  isAgentAccessRevocation,
  isAgentRunActive,
  isAgentRunTerminal,
  resolveClientRequestIdentity,
  shouldPollAgentRuns,
  type ClientRequestIdentity,
} from "../agent-presentation";
import {
  cancelAgentRun,
  getAgentTask,
  listAgentDefinitions,
  retryAgentTask,
} from "../api/agents";
import { agentQueryKeys } from "../api/query-keys";
import { AgentStatusBadge } from "../components/agent-status-badge";

function RunAttempt({ run, latest }: { run: AgentRun; latest: boolean }) {
  return (
    <article className="rw-agent-attempt">
      <div className="rw-agent-attempt__rail">
        <span>{String(run.attemptNumber).padStart(2, "0")}</span>
        <i aria-hidden="true" />
      </div>
      <div className="rw-agent-attempt__record">
        <header>
          <div>
            <h3>Run attempt {run.attemptNumber}</h3>
            <small>{latest ? "Latest durable attempt" : "Historical attempt"}</small>
          </div>
          <AgentStatusBadge run={run} />
        </header>
        <dl>
          <div><dt>Created</dt><dd>{formatResearchDate(run.createdAt)}</dd></div>
          <div><dt>Started</dt><dd>{run.startedAt ? formatResearchDate(run.startedAt) : "—"}</dd></div>
          <div><dt>Finished</dt><dd>{run.finishedAt ? formatResearchDate(run.finishedAt) : "—"}</dd></div>
          <div><dt>Steps / tools</dt><dd>{run.stepCount} / {run.toolCallCount}</dd></div>
        </dl>
        <Button asChild variant="secondary">
          <Link to={"/agents/runs/" + run.id}>Inspect run trace<ArrowRight aria-hidden="true" size={16} /></Link>
        </Button>
      </div>
    </article>
  );
}

export function Component() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const validTaskId = z.string().uuid().safeParse(taskId).success;
  const retryIdentity = useRef<ClientRequestIdentity | null>(null);
  const taskQuery = useQuery({
    queryKey: agentQueryKeys.task(taskId),
    queryFn: () => getAgentTask(taskId),
    enabled: validTaskId,
    refetchInterval: (query) =>
      shouldPollAgentRuns(query.state.data ? [query.state.data.task.latestRun] : undefined)
        ? 2_000
        : false,
  });
  const definitionsQuery = useQuery({
    queryKey: agentQueryKeys.definitions(),
    queryFn: listAgentDefinitions,
  });
  const cancelMutation = useMutation({
    mutationFn: cancelAgentRun,
    onSuccess: async (response) => {
      queryClient.setQueryData(agentQueryKeys.run(response.run.id), response);
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.task(taskId), exact: true });
    },
  });
  const retryMutation = useMutation({
    mutationFn: ({ targetTaskId, clientRequestId }: {
      targetTaskId: string;
      clientRequestId: string;
    }) => retryAgentTask(targetTaskId, { clientRequestId }),
  });

  useEffect(() => {
    const spaceId = taskQuery.data?.task.spaceId;
    if (!spaceId) return;
    if (!isAgentAccessRevocation(taskQuery.error, taskQuery.data !== undefined)) return;
    queryClient.removeQueries({ queryKey: agentQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["spaces"], exact: true });
    window.dispatchEvent(new CustomEvent(REALTIME_ACCESS_REVOKED_EVENT, {
      detail: { spaceId, reason: "membership_changed" },
    }));
  }, [taskQuery.data, taskQuery.error]);

  if (!validTaskId) {
    return <ContentSection><ErrorPanel message="The task identifier is not valid." title="Agent task not found" /></ContentSection>;
  }
  if (taskQuery.isPending || definitionsQuery.isPending) {
    return <PageLoading label="Loading Agent task" />;
  }
  if (taskQuery.error || !taskQuery.data) {
    const error = taskQuery.error instanceof ApiClientError ? taskQuery.error : null;
    return (
      <ContentSection>
        <Button asChild className="rw-back-link" variant="ghost">
          <Link to="/agents/tasks"><ArrowLeft aria-hidden="true" size={16} />Back to task ledger</Link>
        </Button>
        <ErrorPanel
          message={error?.message ?? "The Agent task could not be loaded."}
          onRetry={() => void taskQuery.refetch()}
          requestId={error?.requestId}
          title="Agent task could not be loaded"
        />
      </ContentSection>
    );
  }

  const { task, runs } = taskQuery.data;
  const latest = task.latestRun;
  const definition = definitionsQuery.data?.find((agent) => agent.id === task.agentId);
  const commandError = (cancelMutation.error ?? retryMutation.error) instanceof ApiClientError
    ? (cancelMutation.error ?? retryMutation.error) as ApiClientError
    : null;

  async function handleRetry() {
    const fingerprint = task.id + "\u0000" + latest.id;
    retryIdentity.current = resolveClientRequestIdentity(retryIdentity.current, fingerprint);
    try {
      const result = await retryMutation.mutateAsync({
        targetTaskId: task.id,
        clientRequestId: retryIdentity.current.id,
      });
      retryIdentity.current = null;
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.task(task.id), exact: true });
      void navigate("/agents/runs/" + result.run.id);
    } catch {
      // Retain the request identity for a safe retry after an uncertain response.
    }
  }

  return (
    <ContentSection>
      <Button asChild className="rw-back-link" variant="ghost">
        <Link to={"/agents/tasks?space=" + task.spaceId}>
          <ArrowLeft aria-hidden="true" size={16} />Back to task ledger
        </Link>
      </Button>
      <PageHeader
        action={
          <div className="rw-action-group">
            {isAgentRunActive(latest) ? (
              <Button
                disabled={cancelMutation.isPending || latest.cancelRequestedAt !== null}
                onClick={() => cancelMutation.mutate(latest.id)}
                variant="secondary"
              >
                {cancelMutation.isPending
                  ? <LoadingLabel>Requesting cancellation</LoadingLabel>
                  : <><Square aria-hidden="true" size={15} />{latest.cancelRequestedAt ? "Cancel requested" : "Cancel latest run"}</>}
              </Button>
            ) : null}
            {isAgentRunTerminal(latest) ? (
              <Button
                disabled={retryMutation.isPending}
                onClick={() => void handleRetry()}
              >
                {retryMutation.isPending
                  ? <LoadingLabel>Creating retry</LoadingLabel>
                  : <><RotateCcw aria-hidden="true" size={16} />Retry task</>}
              </Button>
            ) : null}
          </div>
        }
        description="The prompt is immutable. Every execution attempt below remains available as a separate Run."
        kicker={definition?.name ?? "System Agent"}
        title="Agent task"
      />

      {commandError ? (
        <Alert>
          <strong>Run command could not be completed.</strong>
          <span>{getAgentApiErrorMessage(commandError)}</span>
          {commandError.requestId ? <small>Request ID: {commandError.requestId}</small> : null}
        </Alert>
      ) : null}

      <article className="rw-agent-task-brief">
        <div>
          <p className="rw-page-kicker">Immutable research brief</p>
          <blockquote>{task.prompt}</blockquote>
        </div>
        <dl>
          <div><dt>Created</dt><dd>{formatResearchDate(task.createdAt)}</dd></div>
          <div><dt>Space</dt><dd><Link to={"/spaces/" + task.spaceId}>{task.spaceId.slice(0, 8)}</Link></dd></div>
          <div><dt>Task ID</dt><dd className="rw-mono">{task.id}</dd></div>
          <div>
            <dt>Latest run</dt>
            <dd>
              <AgentStatusBadge
                announce
                announcementLabel="Latest run status"
                run={latest}
              />
            </dd>
          </div>
        </dl>
      </article>

      {latest.status === "completed" && latest.finalResult ? (
        <section className="rw-agent-task-result">
          <div>
            <p className="rw-page-kicker">Latest durable result</p>
            <h2>{latest.finalResult.status === "answered" ? "Grounded answer" : "Insufficient context"}</h2>
          </div>
          <p>{latest.finalResult.answer}</p>
          <Button asChild variant="secondary">
            <Link to={"/agents/runs/" + latest.id}>Inspect evidence and trace<ArrowRight aria-hidden="true" size={16} /></Link>
          </Button>
        </section>
      ) : null}
      {latest.status === "failed" ? (
        <section className="rw-agent-task-failure">
          <div>
            <p className="rw-page-kicker">Latest durable result</p>
            <h2>Run failed safely</h2>
          </div>
          <p>{getAgentExecutionErrorMessage(latest.errorCode)}</p>
          <Button asChild variant="secondary">
            <Link to={"/agents/runs/" + latest.id}>Inspect retained trace<ArrowRight aria-hidden="true" size={16} /></Link>
          </Button>
        </section>
      ) : null}

      <section className="rw-agent-attempts" aria-labelledby="agent-attempts-heading">
        <div className="rw-agent-ledger-heading">
          <div><p className="rw-page-kicker">Attempt history</p><h2 id="agent-attempts-heading">Durable Runs</h2></div>
          <span>{runs.length} total</span>
        </div>
        {runs.map((run) => <RunAttempt key={run.id} latest={run.id === latest.id} run={run} />)}
      </section>
    </ContentSection>
  );
}
