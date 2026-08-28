import { Router } from "express";
import { z } from "zod";

import {
  persistentResearchPaperResponseSchema,
  persistentResearchPaperSearchResultSchema,
  nullableResearchPaperSummaryResponseSchema,
  researchPaperSummaryResponseSchema,
  researchSearchQuerySchema,
  savedPaperListResponseSchema,
  savedPaperResponseSchema,
} from "../../../shared/contracts/research";
import { requireActor } from "../auth/middleware";
import type { ResearchService } from "./service";

const paperParamsSchema = z.object({ paperId: z.string().uuid() });
const savedPaperParamsSchema = z.object({
  spaceId: z.string().uuid(),
  paperId: z.string().uuid(),
});
const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });
const emptyBodySchema = z.object({}).strict();

export function createResearchRouter(service: ResearchService) {
  const router = Router();

  router.get("/papers/search", async (request, response) => {
    const query = researchSearchQuerySchema.parse(request.query);
    const result = await service.searchPapers(query);
    response.status(200).json(persistentResearchPaperSearchResultSchema.parse(result));
  });

  router.get("/papers/:paperId", async (request, response) => {
    const { paperId } = paperParamsSchema.parse(request.params);
    const paper = await service.getPaper(paperId);
    response.status(200).json(persistentResearchPaperResponseSchema.parse({ paper }));
  });

  router.get("/papers/:paperId/summary", async (request, response) => {
    const { paperId } = paperParamsSchema.parse(request.params);
    const summary = await service.getPaperSummary(paperId);
    response.status(200).json(nullableResearchPaperSummaryResponseSchema.parse({ summary }));
  });

  router.put("/papers/:paperId/summary", async (request, response) => {
    const { paperId } = paperParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    const result = await service.ensurePaperSummary(paperId);
    response
      .status(result.created ? 201 : 200)
      .json(researchPaperSummaryResponseSchema.parse({ summary: result.summary }));
  });

  return router;
}

export function createSavedPaperRouter(service: ResearchService) {
  const router = Router({ mergeParams: true });

  router.get("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const savedPapers = await service.listSavedPapers(spaceId, requireActor(request).id);
    response.status(200).json(savedPaperListResponseSchema.parse({ savedPapers }));
  });

  router.put("/:paperId", async (request, response) => {
    const { spaceId, paperId } = savedPaperParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    const result = await service.savePaper(spaceId, paperId, requireActor(request).id);
    response
      .status(result.created ? 201 : 200)
      .json(savedPaperResponseSchema.parse({ savedPaper: result.savedPaper }));
  });

  router.delete("/:paperId", async (request, response) => {
    const { spaceId, paperId } = savedPaperParamsSchema.parse(request.params);
    await service.removeSavedPaper(spaceId, paperId, requireActor(request).id);
    response.status(204).end();
  });

  return router;
}
