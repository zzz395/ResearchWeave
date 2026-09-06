import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, FileText, Layers3 } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../../../components/ui/button";
import {
  EmptyState,
  ErrorPanel,
  PageLoading,
  SectionHeader,
} from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { ActivityEventList } from "../../activity/components/activity-event-list";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import { formatResearchDate } from "../../spaces/format-research-date";
import { getOverview } from "../api/overview";
import { overviewQueryKeys } from "../api/query-keys";
import {
  getOverviewActiveWorkPresentation,
  getOverviewRecentSpacePresentation,
} from "../overview-presentation";

export function Component() {
  const overviewQuery = useQuery({
    queryKey: overviewQueryKeys.detail(),
    queryFn: getOverview,
  });

  if (overviewQuery.isPending) return <PageLoading label="Loading workspace overview" />;
  if (overviewQuery.error) {
    const error = overviewQuery.error instanceof ApiClientError ? overviewQuery.error : null;
    return (
      <ContentSection>
        <ErrorPanel
          message={error?.message ?? "Your workspace overview is unavailable right now."}
          onRetry={() => void overviewQuery.refetch()}
          requestId={error?.requestId}
          title="Overview could not be loaded"
        />
      </ContentSection>
    );
  }

  const overview = overviewQuery.data;
  return (
    <ContentSection>
      <PageHeader
        action={
          <Button asChild variant="secondary">
            <Link to="/activity">View all activity<ArrowRight aria-hidden="true" size={16} /></Link>
          </Button>
        }
        description="A bounded view of the Spaces you have touched recently and the work still moving through your workspace."
        kicker="Workspace home"
        title="Overview"
      />

      <div className="rw-workspace-overview-grid">
        <section aria-labelledby="recent-spaces-heading" className="rw-workspace-overview-panel">
          <SectionHeader
            count={`${overview.recentSpaces.length} / 4`}
            headingId="recent-spaces-heading"
            title="Recent Spaces"
          />
          {overview.recentSpaces.length === 0 ? (
            <EmptyState className="rw-workspace-overview-empty">
              <div>
                <Layers3 aria-hidden="true" size={22} />
                <h3>No recent Space activity yet.</h3>
              </div>
            </EmptyState>
          ) : (
            <ol className="rw-recent-space-list">
              {overview.recentSpaces.map((item, index) => {
                const presentation = getOverviewRecentSpacePresentation(item);
                return (
                  <li key={item.space.id}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <Link to={presentation.href}>{item.space.name}</Link>
                      <small>{presentation.activityLabel}</small>
                    </div>
                    <time dateTime={item.lastActivityAt}>{formatResearchDate(item.lastActivityAt)}</time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="active-work-heading" className="rw-workspace-overview-panel">
          <SectionHeader
            count={`${overview.activeWork.length} / 6`}
            headingId="active-work-heading"
            title="Active Work"
          />
          {overview.activeWork.length === 0 ? (
            <EmptyState className="rw-workspace-overview-empty">
              <div>
                <FileText aria-hidden="true" size={22} />
                <h3>No active work right now.</h3>
              </div>
            </EmptyState>
          ) : (
            <ol className="rw-active-work-list">
              {overview.activeWork.map((item) => {
                const presentation = getOverviewActiveWorkPresentation(item);
                const Icon = item.kind === "document" ? FileText : Bot;
                return (
                  <li key={`${item.kind}:${item.kind === "document" ? item.document.id : item.run.id}`}>
                    <span className="rw-active-work-list__icon" aria-hidden="true"><Icon size={17} /></span>
                    <div className="rw-active-work-list__record">
                      <span>{presentation.typeLabel}</span>
                      <Link to={presentation.href}>{presentation.title}</Link>
                      <small>{item.space.name}</small>
                    </div>
                    <div className="rw-active-work-list__state">
                      <strong>{presentation.statusLabel}</strong>
                      {presentation.stageLabel ? <small>{presentation.stageLabel}</small> : null}
                    </div>
                    <time dateTime={item.updatedAt}>{formatResearchDate(item.updatedAt)}</time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <section aria-labelledby="recent-activity-heading" className="rw-workspace-recent-activity">
        <SectionHeader
          action={<Link to="/activity">All activity<ArrowRight aria-hidden="true" size={15} /></Link>}
          count={`${overview.recentActivity.length} / 8`}
          headingId="recent-activity-heading"
          title="Recent Activity"
        />
        {overview.recentActivity.length === 0 ? (
          <EmptyState className="rw-workspace-overview-empty rw-workspace-overview-empty--wide">
            <div>
              <Layers3 aria-hidden="true" size={22} />
              <h3>No recent workspace activity yet.</h3>
            </div>
          </EmptyState>
        ) : (
          <ActivityEventList events={overview.recentActivity} />
        )}
      </section>
    </ContentSection>
  );
}
