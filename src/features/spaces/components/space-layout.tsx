import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";

import { ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { useRealtime } from "../../../services/realtime/realtime-context";
import { getSpace } from "../api/spaces";
import { getSpaceNavigationDestinations } from "../space-navigation";
import { Breadcrumb, ContentSection, PageHeader } from "./space-page";
import { retainSpaceLayoutSubscription } from "./space-layout-subscription";

export function Component() {
  const { spaceId = "" } = useParams();
  const { subscribeSpace } = useRealtime();
  const spaceQuery = useQuery({
    queryKey: ["spaces", spaceId],
    queryFn: () => getSpace(spaceId),
    enabled: Boolean(spaceId),
  });
  const loadedSpaceId = spaceQuery.data?.id;

  useEffect(() => {
    if (!loadedSpaceId) return;
    return retainSpaceLayoutSubscription(subscribeSpace, loadedSpaceId);
  }, [loadedSpaceId, subscribeSpace]);

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
        {getSpaceNavigationDestinations(space.id, space.role).map((destination) => (
          <NavLink end={destination.end} key={destination.to} to={destination.to}>
            {destination.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={space} />
    </ContentSection>
  );
}
