import { infiniteQueryOptions } from "@tanstack/react-query";

import { listActivity } from "./activity";
import { activityQueryKeys, type ActivityListFilters } from "./query-keys";

export const ACTIVITY_PAGE_SIZE = 20;

export function activityListQueryOptions(filters: ActivityListFilters) {
  return infiniteQueryOptions({
    queryKey: activityQueryKeys.list(filters, ACTIVITY_PAGE_SIZE),
    queryFn: ({ pageParam }) => listActivity({
      ...filters,
      cursor: pageParam,
      limit: ACTIVITY_PAGE_SIZE,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
