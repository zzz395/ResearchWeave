import { Router } from "express";

import {
  activityListQuerySchema,
  activityListResponseSchema,
} from "../../../shared/contracts/activity";
import { requireActor } from "../auth/middleware";
import type { ActivityService } from "./service";

export function createActivityRouter(service: ActivityService) {
  const router = Router();

  router.get("/", async (request, response) => {
    const query = activityListQuerySchema.parse(request.query);
    const result = await service.list(requireActor(request).id, query);
    response.status(200).json(activityListResponseSchema.parse(result));
  });

  return router;
}
