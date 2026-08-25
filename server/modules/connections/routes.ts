import { Router } from "express";
import { z } from "zod";

import {
  connectionActionInputSchema,
  connectionListResponseSchema,
  connectionResponseSchema,
  createConnectionRequestInputSchema,
} from "../../../shared/contracts/connections";
import { requireActor } from "../auth/middleware";
import type { ConnectionService } from "./service";

const paramsSchema = z.object({ connectionId: z.string().uuid() });

export function createConnectionRouter(service: ConnectionService) {
  const router = Router();

  router.get("/", async (request, response) => {
    const connections = await service.listConnections(requireActor(request).id);
    response.status(200).json(connectionListResponseSchema.parse({ connections }));
  });

  router.post("/requests", async (request, response) => {
    const input = createConnectionRequestInputSchema.parse(request.body);
    const connection = await service.requestConnection(requireActor(request).id, input);
    response.status(201).json(connectionResponseSchema.parse({ connection }));
  });

  router.patch("/:connectionId", async (request, response) => {
    const { connectionId } = paramsSchema.parse(request.params);
    const input = connectionActionInputSchema.parse(request.body);
    const connection = await service.actOnConnection(requireActor(request).id, connectionId, input);
    if (!connection) {
      response.status(204).end();
      return;
    }
    response.status(200).json(connectionResponseSchema.parse({ connection }));
  });

  router.delete("/:connectionId", async (request, response) => {
    const { connectionId } = paramsSchema.parse(request.params);
    await service.removeConnection(requireActor(request).id, connectionId);
    response.status(204).end();
  });

  return router;
}

