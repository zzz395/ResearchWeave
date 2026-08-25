import { Router } from "express";
import { z } from "zod";

import {
  addSpaceMemberInputSchema,
  spaceMemberListResponseSchema,
  spaceMemberResponseSchema,
} from "../../../shared/contracts/members";
import { requireActor } from "../auth/middleware";
import type { MemberService } from "./service";

const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });
const memberParamsSchema = z.object({
  spaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

export function createMemberRouter(service: MemberService) {
  const router = Router({ mergeParams: true });

  router.get("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const members = await service.listMembers(spaceId, requireActor(request).id);
    response.status(200).json(spaceMemberListResponseSchema.parse({ members }));
  });

  router.post("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const input = addSpaceMemberInputSchema.parse(request.body);
    const member = await service.addMember(spaceId, requireActor(request).id, input);
    response.status(201).json(spaceMemberResponseSchema.parse({ member }));
  });

  router.delete("/:userId", async (request, response) => {
    const { spaceId, userId } = memberParamsSchema.parse(request.params);
    await service.removeMember(spaceId, requireActor(request).id, userId);
    response.status(204).end();
  });

  return router;
}

