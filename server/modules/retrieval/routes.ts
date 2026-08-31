import { Router } from "express";
import { z } from "zod";

import {
  semanticRetrievalRequestSchema,
  semanticRetrievalResponseSchema,
} from "../../../shared/contracts/retrieval";
import { requireActor } from "../auth/middleware";
import type { SemanticRetrievalService } from "./service";

const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });

export function createSemanticRetrievalRouter(service: SemanticRetrievalService) {
  const router = Router({ mergeParams: true });

  router.post("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const input = semanticRetrievalRequestSchema.parse(request.body);
    const result = await service.retrieve(spaceId, requireActor(request).id, input);
    response.status(200).json(semanticRetrievalResponseSchema.parse(result));
  });

  return router;
}
