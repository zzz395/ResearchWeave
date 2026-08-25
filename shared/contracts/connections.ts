import { z } from "zod";

import { emailSchema, userSchema } from "./auth";

export const connectionStatusSchema = z.enum(["pending", "accepted"]);

export const createConnectionRequestInputSchema = z.object({
  email: emailSchema,
});

export const connectionActionInputSchema = z.object({
  action: z.enum(["accept", "reject", "cancel"]),
});

export const connectionSchema = z.object({
  id: z.string().uuid(),
  status: connectionStatusSchema,
  requestedByUserId: z.string().uuid(),
  otherUser: userSchema,
  createdAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable(),
});

export const connectionResponseSchema = z.object({ connection: connectionSchema });
export const connectionListResponseSchema = z.object({
  connections: z.array(connectionSchema),
});

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
export type CreateConnectionRequestInput = z.infer<typeof createConnectionRequestInputSchema>;
export type ConnectionActionInput = z.infer<typeof connectionActionInputSchema>;
export type Connection = z.infer<typeof connectionSchema>;

