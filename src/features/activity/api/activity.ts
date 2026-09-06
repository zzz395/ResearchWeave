import {
  activityListResponseSchema,
  type ActivityListQuery,
  type ActivityListResponse,
} from "../../../../shared/contracts/activity";
import { apiRequest } from "../../../services/api/client";

export async function listActivity(
  query: Pick<ActivityListQuery, "category" | "cursor" | "limit" | "spaceId">,
): Promise<ActivityListResponse> {
  const search = new URLSearchParams({ limit: String(query.limit) });
  if (query.category) search.set("category", query.category);
  if (query.spaceId) search.set("spaceId", query.spaceId);
  if (query.cursor) search.set("cursor", query.cursor);

  return apiRequest(`/api/v1/activity?${search.toString()}`, activityListResponseSchema);
}
