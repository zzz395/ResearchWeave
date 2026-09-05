import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, RotateCcw, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import type { AgentEvidence, AgentRun, AgentStep } from "../../../../shared/contracts/agents";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { queryClient } from "../../../app/query-client";
import { ApiClientError } from "../../../services/api/client";
import { REALTIME_ACCESS_REVOKED_EVENT } from "../../../services/realtime/realtime-context";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import { formatResearchDate } from "../../spaces/format-research-date";
import {
  getAgentApiErrorMessage,
  getAgentEvidenceLink,
  getAgentExecutionErrorMessage,
  getAgentToolLabel,
  isAgentAccessRevocation,
  isAgentRunActive,
  isAgentRunTerminal,
  resolveClientRequestIdentity,
  shouldPollAgentRuns,
  type ClientRequestIdentity,
} from "../agent-presentation";
import {
  cancelAgentRun,
  getAgentRun,
  getAgentRunTrace,
  getAgentTask,
  retryAgentTask,
} from "../api/agents";
import { agentQueryKeys } from "../api/query-keys";
import { AgentStatusBadge } from "../components/agent-status-badge";

function renderFinalAnswer(answer: string): ReactNode[] {
  return answer.split(/(\[E(?:[1-9]|[12][0-9]|3[0-2])\])/gu).map((part, index) => {
    const match = /^\[(E\d+)\]$/u.exec(part);
    return match?.[1]
      ? <a className="rw-inline-citation" href={"#evidence-" + match[1]} key={part + index}>{part}</a>
      : part;
  });
}

function stepHeading(step: AgentStep): string {
  if (step.kind === "tool_call") return getAgentToolLabel(step.toolName);
  if (step.kind === "final_answer") return "Final answer committed";
  return "Decision rejected";
}

function stepTone(step: AgentStep): string {
  if (step.status === "completed") return "success";
  if (step.status === "failed") return "danger";
  if (step.status === "running") return "active";
  return "neutral";
}

function EvidenceSource({ evidence, spaceId }: { evidence: AgentEvidence; spaceId: string }) {
  const link = getAgentEvidenceLink(evidence, spaceId);
  const title = evidence.kind === "arxiv_abstract"
    ? evidence.title
    : evidence.originalFilename;
  return (
    <article className="rw-agent-evidence" id={"evidence-" + evidence.evidenceId}>
      <header>
        <span>{evidence.evidenceId}</span>
        <div>
          <p>
            {evidence.finalOrdinal === null ? "Observed evidence" : "Final citation " + evidence.finalOrdinal}
            {" · "}
            {evidence.kind === "arxiv_abstract" ? "arXiv abstract" : "Knowledge chunk"}
          </p>
          <h3>{title}</h3>
        </div>
        {link ? (
          link.external ? (
            <a href={link.href} rel="noreferrer" target="_blank">
              Open source<ArrowUpRight aria-hidden="true" size={14} />
            </a>
          ) : (
            <Link to={link.href}>Open source<ArrowUpRight aria-hidden="true" size={14} /></Link>
          )
        ) : <small>Snapshot only</small>}
      </header>
      <blockquote>{evidence.excerpt}</blockquote>
      <dl>
        {evidence.kind === "arxiv_abstract" ? (
          <>
            <div><dt>arXiv</dt><dd>{evidence.versionedArxivId}</dd></div>
            <div><dt>Source version</dt><dd>{evidence.sourceVersion}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Chunk</dt><dd>{evidence.ordinal}</dd></div>
            <div><dt>Page</dt><dd>{evidence.pageNumber ?? "—"}</dd></div>
          </>
        )}
        <div><dt>Availability</dt><dd>{evidence.available ? "Live source available" : "Durable snapshot retained"}</dd></div>
      </dl>
    </article>
  );
}

export function Component() {
  const { runId = "" } = useParams();
  const navigate = useNavigate();
  const validRunId = z.string().uuid().safeParse(runId).success;
  const retryIdentity = useRef<ClientRequestIdentity | null>(null);
  const runQuery = useQuery({
    queryKey: agentQueryKeys.run(runId),
    queryFn: () => getAgentRun(runId),
    enabled: validRunId,
    refetchInterval: (query) =>
      shouldPollAgentRuns(query.state.data ? [query.state.data.run] : undefined)
        ? 2_000
        : false,
  });
  const run = runQuery.data?.run;
  const traceQuery = useQuery({
    queryKey: agentQueryKeys.trace(runId),
    queryFn: () => getAgentRunTrace(runId),
    enabled: validRunId,
    refetchInterval: () => run && isAgentRunActive(run) ? 2_000 : false,
  });
  const taskQuery = useQuery({
    queryKey: agentQueryKeys.task(run?.taskId ?? ""),
    queryFn: () => getAgentTask(run?.taskId ?? ""),
    enabled: run !== undefined,
    refetchInterval: () => run && isAgentRunActive(run) ? 2_000 : false,
  });
  const cancelMutation = useMutation({
    mutationFn: cancelAgentRun,
    onSuccess: (response) => {
      queryClient.setQueryData(agentQueryKeys.run(response.run.id), response);
      void queryClient.invalidateQueries({ queryKey: agentQueryKeys.task(response.run.taskId), exact: true });
    },
  });
  const retryMutation = useMutation({
    mutationFn: ({ taskId, clientRequestId }: { taskId: string; clientRequestId: string }) =>
      retryAgentTask(taskId, { clientRequestId }),
  });

  useEffect(() => {
    const spaceId = runQuery.data?.run.spaceId;
    if (!spaceId) return;
    const revoked = isAgentAccessRevocation(runQuery.error, runQuery.data !== undefined)
      || isAgentAccessRevocation(traceQuery.error, traceQuery.data !== undefined)
      || isAgentAccessRevocation(taskQuery.error, taskQuery.data !== undefined);
    if (!revoked) return;
    queryClient.removeQueries({ queryKey: agentQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["spaces"], exact: true });
    window.dispatchEvent(new CustomEvent(REALTIME_ACCESS_REVOKED_EVENT, {
      detail: { spaceId, reason: "membership_changed" },
    }));
  }, [
    runQuery.data,
    runQuery.error,
    taskQuery.data,
    taskQuery.error,
    traceQuery.data,
    traceQuery.error,
  ]);

  if (!validRunId) {
    return <ContentSection><ErrorPanel message="The run identifier is not valid." title="Agent run not found" /></ContentSection>;
  }
  if (runQuery.isPending) return <PageLoading label="Loading Agent run" />;
  if (runQuery.error || !run) {
    const error = runQuery.error instanceof ApiClientError ? runQuery.error : null;
    return (
      <ContentSection>
        <Button asChild className="rw-back-link" variant="ghost">
          <Link to="/agents/tasks"><ArrowLeft aria-hidden="true" size={16} />Back to task ledger</Link>
        </Button>
        <ErrorPanel
          message={error?.message ?? "The Agent run could not be loaded."}
          onRetry={() => void runQuery.refetch()}
          requestId={error?.requestId}
          title="Agent run could not be loaded"
        />
      </ContentSection>
    );
  }

  const task = taskQuery.data?.task;
  const isLatest = task?.latestRun.id === run.id;
  const commandError = (cancelMutation.error ?? retryMutation.error) instanceof ApiClientError
    ? (cancelMutation.error ?? retryMutation.error) as ApiClientError
    : null;

  async function handleRetry(targetRun: AgentRun) {
    const fingerprint = targetRun.taskId + "\u0000" + targetRun.id;
    retryIdentity.current = resolveClientRequestIdentity(retryIdentity.current, fingerprint);
    try {
      const result = await retryMutation.mutateAsync({
        taskId: targetRun.taskId,
        clientRequestId: retryIdentity.current.id,
      });
      retryIdentity.current = null;
      void navigate("/agents/runs/" + result.run.id);
    } catch {
      // Retain the id for an idempotent replay.
    }
  }

  const trace = traceQuery.data;
  const orderedEvidence = [...(trace?.evidence ?? [])].sort((left, right) => {
    if (left.finalOrdinal !== null && right.finalOrdinal !== null) {
      return left.finalOrdinal - right.finalOrdinal;
    }
    if (left.finalOrdinal !== null) return -1;
    if (right.finalOrdinal !== null) return 1;
    return left.createdAt.localeCompare(right.createdAt);
  });

  return (
    <ContentSection>
      <Button asChild className="rw-back-link" variant="ghost">
        <Link to={"/agents/tasks/" + run.taskId}>
          <ArrowLeft aria-hidden="true" size={16} />Back to task
        </Link>
      </Button>
      <PageHeader
        action={
          <div className="rw-action-group">
            {isLatest && isAgentRunActive(run) ? (
              <Button
                disabled={cancelMutation.isPending || run.cancelRequestedAt !== null}
                onClick={() => cancelMutation.mutate(run.id)}
                variant="secondary"
              >
                {cancelMutation.isPending
                  ? <LoadingLabel>Requesting cancellation</LoadingLabel>
                  : <><Square aria-hidden="true" size={15} />{run.cancelRequestedAt ? "Cancel requested" : "Cancel run"}</>}
              </Button>
            ) : null}
            {isLatest && isAgentRunTerminal(run) ? (
              <Button disabled={retryMutation.isPending} onClick={() => void handleRetry(run)}>
                {retryMutation.isPending
                  ? <LoadingLabel>Creating retry</LoadingLabel>
                  : <><RotateCcw aria-hidden="true" size={16} />Retry task</>}
              </Button>
            ) : null}
          </div>
        }
        description="A safe, durable account of orchestration decisions, tool observations and grounded evidence."
        kicker={"Run attempt " + run.attemptNumber}
        title="Execution trace"
      />

      {commandError ? (
        <Alert>
          <strong>Run command could not be completed.</strong><span>{getAgentApiErrorMessage(commandError)}</span>
          {commandError.requestId ? <small>Request ID: {commandError.requestId}</small> : null}
        </Alert>
      ) : null}

      <section className="rw-agent-run-overview" aria-live="polite">
        <div className="rw-agent-run-overview__status">
          <p className="rw-page-kicker">Durable state</p>
          <AgentStatusBadge run={run} />
          {run.errorCode ? <p>{getAgentExecutionErrorMessage(run.errorCode)}</p> : null}
        </div>
        <dl>
          <div><dt>Run ID</dt><dd className="rw-mono">{run.id}</dd></div>
          <div><dt>Provider model</dt><dd className="rw-mono">{run.configuration.providerModel}</dd></div>
          <div><dt>Created</dt><dd>{formatResearchDate(run.createdAt)}</dd></div>
          <div><dt>Started</dt><dd>{run.startedAt ? formatResearchDate(run.startedAt) : "—"}</dd></div>
          <div><dt>Finished</dt><dd>{run.finishedAt ? formatResearchDate(run.finishedAt) : "—"}</dd></div>
          <div><dt>Context</dt><dd>{run.contextBytes.toLocaleString()} bytes</dd></div>
          <div><dt>Steps</dt><dd>{run.stepCount} / {run.configuration.limits.maxSteps}</dd></div>
          <div><dt>Tool calls</dt><dd>{run.toolCallCount} / {run.configuration.limits.maxToolCalls}</dd></div>
        </dl>
      </section>

      {run.status === "completed" && run.finalResult ? (
        <section className="rw-agent-final-answer" aria-labelledby="agent-final-answer-heading">
          <div>
            <p className="rw-page-kicker">Committed result</p>
            <h2 id="agent-final-answer-heading">
              {run.finalResult.status === "answered" ? "Grounded answer" : "Insufficient context"}
            </h2>
          </div>
          <p>{renderFinalAnswer(run.finalResult.answer)}</p>
        </section>
      ) : null}

      <section className="rw-agent-trace" aria-labelledby="agent-trace-heading">
        <div className="rw-agent-ledger-heading">
          <div><p className="rw-page-kicker">Ordered record</p><h2 id="agent-trace-heading">Execution steps</h2></div>
          <span>{trace?.steps.length ?? run.stepCount} recorded</span>
        </div>
        {traceQuery.isPending ? <PageLoading label="Loading execution steps" /> : null}
        {traceQuery.error ? (
          <ErrorPanel
            message={traceQuery.error instanceof ApiClientError
              ? traceQuery.error.message
              : "The execution trace could not be loaded."}
            onRetry={() => void traceQuery.refetch()}
            requestId={traceQuery.error instanceof ApiClientError
              ? traceQuery.error.requestId
              : undefined}
            title="Execution steps could not be loaded"
          />
        ) : null}
        {trace && trace.steps.length === 0 ? (
          <div className="rw-agent-trace-empty">No execution steps have been committed yet.</div>
        ) : (
          <ol className="rw-agent-step-list">
            {trace?.steps.map((step) => (
              <li key={step.id}>
                <div className="rw-agent-step__sequence">{String(step.sequence).padStart(2, "0")}</div>
                <article className="rw-agent-step">
                  <header>
                    <div>
                      <p>{step.kind.replace("_", " ")}</p>
                      <h3>{stepHeading(step)}</h3>
                    </div>
                    <span className={"rw-status-badge rw-status-badge--" + stepTone(step)}>
                      {step.status}
                    </span>
                  </header>
                  <dl>
                    <div><dt>Execution</dt><dd>{step.executionCount}</dd></div>
                    <div><dt>Duration</dt><dd>{step.durationMs === null ? "—" : step.durationMs + " ms"}</dd></div>
                    <div><dt>Started</dt><dd>{formatResearchDate(step.startedAt)}</dd></div>
                  </dl>
                  {step.kind === "tool_call" ? (
                    <div className="rw-agent-step__payloads">
                      <div><h4>Safe arguments</h4><pre>{JSON.stringify(step.safeArguments, null, 2)}</pre></div>
                      {step.observation ? <div><h4>Observation</h4><pre>{JSON.stringify(step.observation, null, 2)}</pre></div> : null}
                    </div>
                  ) : null}
                  {step.errorCode ? <p className="rw-agent-step__error">{getAgentExecutionErrorMessage(step.errorCode)}</p> : null}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      {orderedEvidence.length > 0 ? (
        <section className="rw-agent-evidence-list" aria-labelledby="agent-evidence-heading">
          <div className="rw-agent-ledger-heading">
            <div><p className="rw-page-kicker">Server-validated provenance</p><h2 id="agent-evidence-heading">Evidence snapshots</h2></div>
            <span>{orderedEvidence.length} retained</span>
          </div>
          {orderedEvidence.map((evidence) => (
            <EvidenceSource evidence={evidence} key={evidence.id} spaceId={run.spaceId} />
          ))}
        </section>
      ) : null}
    </ContentSection>
  );
}
