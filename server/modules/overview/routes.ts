import { Router } from "express";

import { overviewResponseSchema } from "../../../shared/contracts/overview";
import { requireActor } from "../auth/middleware";
import type { OverviewService } from "./service";

export function createOverviewRouter(service: OverviewService) {
  const router = Router();

  router.get("/", async (request, response) => {
    const result = await service.get(requireActor(request).id);
    response.status(200).json(overviewResponseSchema.parse(result));
  });

  return router;
}
