import { Router } from "express";
import { z } from "zod";

import {
  createSpaceInputSchema,
  researchSpaceListResponseSchema,
  researchSpaceResponseSchema,
  updateSpaceInputSchema,
} from "../../../shared/contracts/spaces";
import { requireActor } from "../auth/middleware";
import type { SpaceService } from "./service";

const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });

export function createSpaceRouter(spaceService: SpaceService) {
  const router = Router();

  router.get("/", async (request, response) => {
    const spaces = await spaceService.listSpaces(requireActor(request).id);
    response.status(200).json(researchSpaceListResponseSchema.parse({ spaces }));
  });

  router.post("/", async (request, response) => {
    const input = createSpaceInputSchema.parse(request.body);
    const space = await spaceService.createSpace(input, requireActor(request).id);
    response.status(201).json(researchSpaceResponseSchema.parse({ space }));
  });

  router.get("/:spaceId", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const space = await spaceService.getSpace(spaceId, requireActor(request).id);
    response.status(200).json(researchSpaceResponseSchema.parse({ space }));
  });

  router.patch("/:spaceId", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const input = updateSpaceInputSchema.parse(request.body);
    const space = await spaceService.updateSpace(spaceId, input, requireActor(request).id);
    response.status(200).json(researchSpaceResponseSchema.parse({ space }));
  });

  router.delete("/:spaceId", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    await spaceService.deleteSpace(spaceId, requireActor(request).id);
    response.status(204).end();
  });

  return router;
}
