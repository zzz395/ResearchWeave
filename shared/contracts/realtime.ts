import { z } from "zod";

import { chatMessageSchema, sendChatMessageInputSchema } from "./chat";

const commandBase = z.object({
  version: z.literal(1),
  requestId: z.string().uuid(),
  spaceId: z.string().uuid(),
});

export const realtimeClientCommandSchema = z.discriminatedUnion("type", [
  commandBase.extend({ type: z.literal("space.subscribe"), payload: z.object({}) }),
  commandBase.extend({ type: z.literal("space.unsubscribe"), payload: z.object({}) }),
  commandBase.extend({ type: z.literal("chat.message.send"), payload: sendChatMessageInputSchema }),
]);

const eventBase = z.object({
  version: z.literal(1),
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  spaceId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
});

export const realtimeServerEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({
    type: z.literal("space.snapshot"),
    spaceId: z.string().uuid(),
    payload: z.object({ presentUserIds: z.array(z.string().uuid()) }),
  }),
  eventBase.extend({
    type: z.literal("presence.updated"),
    spaceId: z.string().uuid(),
    payload: z.object({ presentUserIds: z.array(z.string().uuid()) }),
  }),
  eventBase.extend({
    type: z.literal("chat.message.created"),
    spaceId: z.string().uuid(),
    payload: z.object({ message: chatMessageSchema }),
  }),
  eventBase.extend({
    type: z.literal("space.access.revoked"),
    spaceId: z.string().uuid(),
    payload: z.object({ reason: z.enum(["membership_removed", "space_deleted"]) }),
  }),
  eventBase.extend({
    type: z.literal("ack"),
    payload: z.object({
      commandType: z.enum(["space.subscribe", "space.unsubscribe", "chat.message.send"]),
    }),
  }),
  eventBase.extend({
    type: z.literal("error"),
    payload: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);

export type RealtimeClientCommand = z.infer<typeof realtimeClientCommandSchema>;
export type RealtimeServerEvent = z.infer<typeof realtimeServerEventSchema>;

