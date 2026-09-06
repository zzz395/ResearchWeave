import {
  overviewResponseSchema,
  type OverviewResponse,
} from "../../../shared/contracts/overview";
import type { ActivityRepository } from "../activity/repository";
import { toActivityEvent } from "../activity/service";

export interface OverviewService {
  get(actorId: string): Promise<OverviewResponse>;
}

export function createOverviewService(repository: ActivityRepository): OverviewService {
  return {
    async get(actorId) {
      const projection = await repository.getOverviewForActor(actorId);
      return overviewResponseSchema.parse({
        recentSpaces: projection.recentSpaces.map((item) => ({
          ...item,
          lastActivityAt: item.lastActivityAt.toISOString(),
        })),
        activeWork: projection.activeWork.map((item) => ({
          ...item,
          updatedAt: item.updatedAt.toISOString(),
        })),
        recentActivity: projection.recentActivity.map(toActivityEvent),
      });
    },
  };
}
