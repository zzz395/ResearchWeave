import { z } from "zod";

import { userSchema } from "./auth";
import { spaceRoleSchema } from "./spaces";

export const addSpaceMemberInputSchema = z.object({
  userId: z.string().uuid(),
});

export const spaceMemberSchema = z.object({
  user: userSchema,
  role: spaceRoleSchema,
  joinedAt: z.string().datetime(),
});

export const spaceMemberResponseSchema = z.object({ member: spaceMemberSchema });
export const spaceMemberListResponseSchema = z.object({
  members: z.array(spaceMemberSchema),
});

export type AddSpaceMemberInput = z.infer<typeof addSpaceMemberInputSchema>;
export type SpaceMember = z.infer<typeof spaceMemberSchema>;

