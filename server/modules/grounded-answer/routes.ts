import { Router } from "express";
import { z } from "zod";

import {
  askKnowledgeRequestSchema,
  groundedAnswerResponseSchema,
} from "../../../shared/contracts/grounded-answer";
import { requireActor } from "../auth/middleware";
import type { GroundedAnswerService } from "./service";

const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });

export function createGroundedAnswerRouter(service: GroundedAnswerService) {
  const router = Router({ mergeParams: true });

  router.post("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const input = askKnowledgeRequestSchema.parse(request.body);
    const result = await service.answer(spaceId, requireActor(request).id, input);
    response.status(200).json(groundedAnswerResponseSchema.parse(result));
  });

  return router;
}
