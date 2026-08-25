import { Router } from "express";
import { z } from "zod";

import {
  chatHistoryQuerySchema,
  chatHistoryResponseSchema,
} from "../../../shared/contracts/chat";
import { requireActor } from "../auth/middleware";
import type { ChatService } from "./service";

const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });

export function createChatHistoryRouter(service: ChatService) {
  const router = Router({ mergeParams: true });

  router.get("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const query = chatHistoryQuerySchema.parse(request.query);
    const history = await service.listMessages(spaceId, requireActor(request).id, query);
    response.status(200).json(chatHistoryResponseSchema.parse(history));
  });

  return router;
}

