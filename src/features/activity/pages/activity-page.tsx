import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Filter, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import type { ActivityCategory } from "../../../../shared/contracts/activity";
import { Button } from "../../../components/ui/button";
import {
  EmptyState,
  ErrorPanel,
  LoadingLabel,
  QueryState,
  SectionHeader,
} from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import { listSpaces } from "../../spaces/api/spaces";
import {
  createActivitySearchParams,
  parseActivitySearchParams,
  type ActivityUrlState,
} from "../activity-url-state";
import { activityListQueryOptions } from "../api/activity-list-query";
import { ActivityEventList } from "../components/activity-event-list";

const categoryOptions: readonly { label: string; value: ActivityCategory }[] = [
  { label: "Collaboration", value: "collaboration" },
  { label: "Research", value: "research" },
  { label: "Knowledge", value: "knowledge" },
  { label: "Agents", value: "agents" },
];

export function Component() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseActivitySearchParams(searchParams);
  const activityQuery = useInfiniteQuery(activityListQueryOptions(filters));
  const spacesQuery = useQuery({ queryKey: ["spaces"], queryFn: listSpaces });
  const events = activityQuery.data?.pages.flatMap((page) => page.events) ?? [];

  function updateFilters(next: ActivityUrlState) {
    setSearchParams(createActivitySearchParams(next));
  }

  const activityError = activityQuery.error instanceof ApiClientError
    ? activityQuery.error
    : null;
  const unavailableSpace = Boolean(
    filters.spaceId && activityError?.status === 404 && activityError.code === "space_not_found",
  );
  const selectedSpaceIsListed = Boolean(
    filters.spaceId && spacesQuery.data?.some((space) => space.id === filters.spaceId),
  );

  return (
    <ContentSection>
      <PageHeader
        description="Follow the current durable projection of collaboration, research, knowledge, and Agent work across your workspace."
        kicker="Workspace record"
        title="Activity"
      />

      <section aria-labelledby="activity-filters-heading" className="rw-activity-filters">
        <div className="rw-activity-filters__intro">
          <Filter aria-hidden="true" size={18} />
          <div>
            <h2 id="activity-filters-heading">Filter activity</h2>
            <p>Choose a category, a Research Space, or both.</p>
          </div>
        </div>
        <label className="rw-activity-filter-field">
          <span>Category</span>
          <select
            className="rw-input"
            onChange={(event) => {
              const category = categoryOptions.find(
                (option) => option.value === event.currentTarget.value,
              )?.value;
              updateFilters({ ...filters, category });
            }}
            value={filters.category ?? ""}
          >
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="rw-activity-filter-field">
          <span>Space</span>
          <select
            className="rw-input"
            disabled={spacesQuery.isPending}
            onChange={(event) => updateFilters({
              ...filters,
              spaceId: event.currentTarget.value || undefined,
            })}
            value={filters.spaceId ?? ""}
          >
            <option value="">{spacesQuery.isPending ? "Loading Spaces…" : "All Spaces"}</option>
            {filters.spaceId && !selectedSpaceIsListed ? (
              <option value={filters.spaceId}>Selected Space</option>
            ) : null}
            {spacesQuery.data?.map((space) => (
              <option key={space.id} value={space.id}>{space.name}</option>
            ))}
          </select>
          {spacesQuery.error ? (
            <small role="status">Space options are unavailable. Activity remains accessible.</small>
          ) : null}
        </label>
        {filters.category || filters.spaceId ? (
          <Button
            className="rw-activity-filters__reset"
            onClick={() => updateFilters({})}
            type="button"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" size={16} />Clear filters
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="activity-records-heading" className="rw-activity-records">
        <SectionHeader
          count={events.length > 0 ? `${events.length} loaded` : undefined}
          headingId="activity-records-heading"
          title="Activity records"
        />

        {activityQuery.isPending ? (
          <QueryState label="Loading activity" status="loading" />
        ) : unavailableSpace ? (
          <div className="rw-activity-unavailable" role="alert">
            <div>
              <h3>This Space is no longer available.</h3>
              <p>Clear the Space filter to continue with activity you can access.</p>
            </div>
            <Button
              onClick={() => updateFilters({ ...filters, spaceId: undefined })}
              type="button"
              variant="secondary"
            >
              Clear Space filter
            </Button>
          </div>
        ) : activityQuery.error && events.length === 0 ? (
          <ErrorPanel
            message={activityError?.message ?? "Activity is unavailable right now."}
            onRetry={() => void activityQuery.refetch()}
            requestId={activityError?.requestId}
            title="Activity could not be loaded"
          />
        ) : events.length === 0 ? (
          <EmptyState className="rw-activity-empty">
            <div>
              <h3>No activity matches these filters.</h3>
              <p>Try a different category or Research Space.</p>
            </div>
          </EmptyState>
        ) : (
          <ActivityEventList events={events} />
        )}

        {events.length > 0 ? (
          <div className="rw-activity-pagination">
            {activityQuery.isFetchNextPageError ? (
              <QueryState
                label="More activity could not be loaded."
                onRetry={() => void activityQuery.fetchNextPage()}
                status="error"
              />
            ) : activityQuery.isFetchingNextPage ? (
              <span aria-live="polite" role="status"><LoadingLabel>Loading more activity</LoadingLabel></span>
            ) : activityQuery.hasNextPage ? (
              <Button onClick={() => void activityQuery.fetchNextPage()} type="button" variant="secondary">
                Load more
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </ContentSection>
  );
}
