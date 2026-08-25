import { z } from "zod";

import { userSchema } from "./auth";

export const chatMessageBodySchema = z
  .string()
  .trim()
  .min(1, "Write a message before sending.")
  .max(4000, "Use no more than 4,000 characters.");

export const sendChatMessageInputSchema = z.object({ body: chatMessageBodySchema });

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  sender: userSchema,
  body: chatMessageBodySchema,
  createdAt: z.string().datetime(),
});

export const chatHistoryQuerySchema = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const chatHistoryResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  nextCursor: z.string().nullable(),
});

export type SendChatMessageInput = z.infer<typeof sendChatMessageInputSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;
export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>;

