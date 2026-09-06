import type { ActivityCategory } from "../../../../shared/contracts/activity";

export interface ActivityListFilters {
  category?: ActivityCategory;
  spaceId?: string;
}

export const activityQueryKeys = {
  list(filters: ActivityListFilters, limit: number) {
    return ["activity", "list", {
      category: filters.category,
      spaceId: filters.spaceId,
      limit,
    }] as const;
  },
};
