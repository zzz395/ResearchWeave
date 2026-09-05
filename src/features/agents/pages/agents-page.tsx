import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Clock3, Gauge, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../../../components/ui/button";
import { EmptyState, ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import {
  getAgentAvailabilityPresentation,
  getAgentToolLabel,
  shouldPollAgentDefinitions,
} from "../agent-presentation";
import { listAgentDefinitions } from "../api/agents";
import { agentQueryKeys } from "../api/query-keys";
import { AgentAvailabilityBadge } from "../components/agent-status-badge";

function formatBytes(bytes: number): string {
  return bytes >= 1_024
    ? (bytes / 1_024).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " KB"
    : bytes.toLocaleString() + " B";
}

export function Component() {
  const definitionsQuery = useQuery({
    queryKey: agentQueryKeys.definitions(),
    queryFn: listAgentDefinitions,
    refetchInterval: (query) =>
      shouldPollAgentDefinitions(query.state.data) ? 2_000 : false,
  });

  if (definitionsQuery.isPending) return <PageLoading label="Loading Agents" />;
  if (definitionsQuery.error) {
    const error = definitionsQuery.error instanceof ApiClientError
      ? definitionsQuery.error
      : null;
    return (
      <ContentSection>
        <ErrorPanel
          message={error?.message ?? "Agent definitions could not be loaded."}
          onRetry={() => void definitionsQuery.refetch()}
          requestId={error?.requestId}
          title="Agents could not be loaded"
        />
      </ContentSection>
    );
  }

  const agents = definitionsQuery.data;
  return (
    <ContentSection>
      <PageHeader
        action={
          <Button asChild variant="secondary">
            <Link to="/agents/tasks">Open task ledger<ArrowRight aria-hidden="true" size={16} /></Link>
          </Button>
        }
        description="System-managed research Agents work through a fixed tool allowlist and publish durable, inspectable execution traces."
        kicker="Agent runtime"
        title="Agents"
      />

      {agents.length === 0 ? (
        <EmptyState className="rw-agent-empty">
          <Bot aria-hidden="true" size={30} />
          <div>
            <h2>No Agent definitions are available</h2>
            <p>Agent definitions are provisioned by the application and cannot be created from this interface.</p>
          </div>
        </EmptyState>
      ) : (
        <div className="rw-agent-catalogue">
          {agents.map((agent, index) => {
            const availability = getAgentAvailabilityPresentation(agent.availability);
            return (
              <article className="rw-agent-definition" key={agent.id}>
                <header>
                  <div className="rw-agent-definition__index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <p className="rw-page-kicker">System-managed · revision {agent.revision}</p>
                    <h2>{agent.name}</h2>
                    <p>{agent.purpose}</p>
                  </div>
                  <AgentAvailabilityBadge
                    announce
                    announcementLabel={agent.name + " readiness"}
                    availability={agent.availability}
                  />
                </header>

                <div className="rw-agent-definition__body">
                  <section aria-labelledby={"agent-tools-" + agent.id}>
                    <div className="rw-agent-subheading">
                      <Wrench aria-hidden="true" size={16} />
                      <h3 id={"agent-tools-" + agent.id}>Approved tools</h3>
                    </div>
                    <ul className="rw-agent-tool-list">
                      {agent.tools.map((tool) => <li key={tool}>{getAgentToolLabel(tool)}</li>)}
                    </ul>
                  </section>
                  <section aria-labelledby={"agent-limits-" + agent.id}>
                    <div className="rw-agent-subheading">
                      <Gauge aria-hidden="true" size={16} />
                      <h3 id={"agent-limits-" + agent.id}>Execution envelope</h3>
                    </div>
                    <dl className="rw-agent-limit-grid">
                      <div><dt>Steps</dt><dd>{agent.limits.maxSteps}</dd></div>
                      <div><dt>Tool calls</dt><dd>{agent.limits.maxToolCalls}</dd></div>
                      <div><dt>Wall time</dt><dd>{agent.limits.wallTimeSeconds}s</dd></div>
                      <div><dt>Evidence</dt><dd>{agent.limits.maxEvidence}</dd></div>
                      <div><dt>Provider timeout</dt><dd>{agent.limits.providerDecisionTimeoutSeconds}s</dd></div>
                      <div><dt>Tool timeout</dt><dd>{agent.limits.toolTimeoutSeconds}s</dd></div>
                      <div><dt>Provider attempts</dt><dd>{agent.limits.providerAttempts}</dd></div>
                      <div><dt>Answer limit</dt><dd>{agent.limits.finalAnswerMaxCharacters.toLocaleString()}</dd></div>
                      <div><dt>Provider response</dt><dd>{formatBytes(agent.limits.providerResponseMaxBytes)}</dd></div>
                      <div><dt>Observation</dt><dd>{formatBytes(agent.limits.observationMaxBytes)}</dd></div>
                      <div><dt>Context</dt><dd>{formatBytes(agent.limits.contextMaxBytes)}</dd></div>
                    </dl>
                  </section>
                </div>

                <footer>
                  <div className="rw-agent-availability-note">
                    <Clock3 aria-hidden="true" size={15} />
                    <span>{availability.detail}</span>
                  </div>
                  {agent.availability.available ? (
                    <Button asChild>
                      <Link to={"/agents/tasks?agent=" + agent.id}>
                        Start task<ArrowRight aria-hidden="true" size={16} />
                      </Link>
                    </Button>
                  ) : (
                    <Button disabled>Agent unavailable</Button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </ContentSection>
  );
}
