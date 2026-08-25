import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Button } from "../../../components/ui/button";
import { ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { getSpace } from "../api/spaces";
import { Breadcrumb, ContentSection, PageHeader } from "../components/space-page";
import { formatResearchDate } from "../format-research-date";

export function Component() {
  const { spaceId = "" } = useParams();
  const spaceQuery = useQuery({
    queryKey: ["spaces", spaceId],
    queryFn: () => getSpace(spaceId),
    enabled: Boolean(spaceId),
  });
  if (spaceQuery.isPending) return <PageLoading label="Loading research space" />;
  if (spaceQuery.error || !spaceQuery.data) {
    const error = spaceQuery.error instanceof ApiClientError ? spaceQuery.error : null;
    return (
      <ErrorPanel
        message={error?.message ?? "This research space could not be loaded."}
        onRetry={() => void spaceQuery.refetch()}
        requestId={error?.requestId}
        title={error?.status === 404 ? "Research space not found" : undefined}
      />
    );
  }
  const space = spaceQuery.data;
  return (
    <ContentSection>
      <Breadcrumb current={space.name} />
      <PageHeader
        action={space.role === "owner" ? (
          <Button asChild variant="secondary">
            <Link to={`/spaces/${space.id}/settings`}><Settings aria-hidden="true" size={18} />Space settings</Link>
          </Button>
        ) : undefined}
        description={space.description || "No description has been added to this research space."}
        kicker={`Research space · ${space.role}`}
        title={space.name}
      />
      <section className="rw-record-panel">
        <div className="rw-record-panel__heading">
          <p className="rw-page-kicker">Space record</p>
          <span className="rw-role-badge">{space.role}</span>
        </div>
        <dl className="rw-definition-grid">
          <div><dt>Your role</dt><dd>{space.role === "owner" ? "Owner" : "Member"}</dd></div>
          <div><dt>Created</dt><dd><time dateTime={space.createdAt}>{formatResearchDate(space.createdAt)}</time></dd></div>
          <div><dt>Last updated</dt><dd><time dateTime={space.updatedAt}>{formatResearchDate(space.updatedAt)}</time></dd></div>
          <div><dt>Space ID</dt><dd className="rw-mono">{space.id}</dd></div>
        </dl>
      </section>
    </ContentSection>
  );
}
