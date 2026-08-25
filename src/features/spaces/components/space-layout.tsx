import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams } from "react-router-dom";

import { ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { getSpace } from "../api/spaces";
import { Breadcrumb, ContentSection, PageHeader } from "./space-page";

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
        description={space.description || "No description has been added to this research space."}
        kicker={`Research space · ${space.role}`}
        title={space.name}
      />
      <nav aria-label="Research space views" className="rw-space-tabs">
        <NavLink end to={`/spaces/${space.id}`}>Overview</NavLink>
        <NavLink to={`/spaces/${space.id}/chat`}>Chat</NavLink>
        <NavLink to={`/spaces/${space.id}/members`}>Members</NavLink>
        {space.role === "owner" ? <NavLink to={`/spaces/${space.id}/settings`}>Settings</NavLink> : null}
      </nav>
      <Outlet context={space} />
    </ContentSection>
  );
}
