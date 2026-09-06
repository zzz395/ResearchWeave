import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import {
  paperComparisonRequestSchema,
  paperComparisonResponseSchema,
} from "../../../shared/contracts/paper-comparison";
import { parseResponse } from "../../middleware/response-validation";
import { requireActor } from "../auth/middleware";
import type { PaperComparisonService } from "./service";

const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });

export const PAPER_COMPARISON_RATE_LIMIT = 10;
export const PAPER_COMPARISON_RATE_WINDOW_MS = 15 * 60 * 1000;

export function createPaperComparisonRouter(service: PaperComparisonService) {
  const router = Router({ mergeParams: true });
  const comparisonRateLimit = rateLimit({
    windowMs: PAPER_COMPARISON_RATE_WINDOW_MS,
    limit: PAPER_COMPARISON_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => requireActor(request).id,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          code: "comparison_rate_limited",
          message: "Too many paper comparison requests. Try again later.",
          requestId: String(response.locals.requestId ?? "unknown"),
        },
      });
    },
  });

  router.post("/", comparisonRateLimit, async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const input = paperComparisonRequestSchema.parse(request.body);
    const comparison = await service.compare(spaceId, requireActor(request).id, input);
    response.status(200).json(parseResponse(paperComparisonResponseSchema, comparison));
  });

  return router;
}
