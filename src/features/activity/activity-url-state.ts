import { z } from "zod";

import {
  activityCategorySchema,
  type ActivityCategory,
} from "../../../shared/contracts/activity";

export interface ActivityUrlState {
  category?: ActivityCategory;
  spaceId?: string;
}

const uuidSchema = z.string().uuid();

export function parseActivitySearchParams(params: URLSearchParams): ActivityUrlState {
  const category = activityCategorySchema.safeParse(params.get("category"));
  const spaceId = uuidSchema.safeParse(params.get("spaceId"));

  return {
    ...(category.success ? { category: category.data } : {}),
    ...(spaceId.success ? { spaceId: spaceId.data } : {}),
  };
}

export function createActivitySearchParams(state: ActivityUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.category) params.set("category", state.category);
  if (state.spaceId && uuidSchema.safeParse(state.spaceId).success) {
    params.set("spaceId", state.spaceId);
  }
  return params;
}
