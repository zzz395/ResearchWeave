import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../../../components/ui/button";
import { EmptyState, ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { listSpaces } from "../api/spaces";
import { ContentSection, PageHeader } from "../components/space-page";
import { formatResearchDate } from "../format-research-date";

export function Component() {
  const spacesQuery = useQuery({ queryKey: ["spaces"], queryFn: listSpaces });

  if (spacesQuery.isPending) return <PageLoading label="Loading research spaces" />;
  if (spacesQuery.error) {
    const error = spacesQuery.error instanceof ApiClientError ? spacesQuery.error : null;
    return (
      <ErrorPanel
        message={error?.message ?? "The research spaces list is unavailable."}
        onRetry={() => void spacesQuery.refetch()}
        requestId={error?.requestId}
      />
    );
  }

  return (
    <ContentSection>
      <PageHeader
        action={
          <Button asChild>
            <Link to="/spaces/new"><Plus aria-hidden="true" size={18} />Create research space</Link>
          </Button>
        }
        description="Organize durable collaboration context in spaces you can return to."
        title="Research Spaces"
      />

      {spacesQuery.data.length === 0 ? (
        <EmptyState className="rw-empty-state">
          <div>
            <h2>No research spaces yet.</h2>
            <p>Create your first research space to organize collaboration and research context.</p>
            <Button asChild>
              <Link to="/spaces/new"><Plus aria-hidden="true" size={18} />Create research space</Link>
            </Button>
          </div>
        </EmptyState>
      ) : (
        <section aria-label="Your research spaces" className="rw-space-list">
          <div className="rw-space-list__heading" aria-hidden="true">
            <span>Space</span><span>Role</span><span>Updated</span><span />
          </div>
          {spacesQuery.data.map((space, index) => (
            <Link className="rw-space-row" key={space.id} to={`/spaces/${space.id}`}>
              <span aria-hidden="true" className="rw-space-row__index">{index + 1}</span>
              <span className="rw-space-row__identity">
                <strong>{space.name}</strong>
                <small>{space.description || "No description provided."}</small>
              </span>
              <span><i className="rw-role-badge">{space.role}</i></span>
              <time dateTime={space.updatedAt}>{formatResearchDate(space.updatedAt)}</time>
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          ))}
        </section>
      )}
    </ContentSection>
  );
}
