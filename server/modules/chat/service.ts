import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  sendChatMessageInputSchema,
  type ChatHistoryQuery,
  type ChatHistoryResponse,
  type ChatMessage,
  type SendChatMessageInput,
} from "../../../shared/contracts/chat";
import type { User } from "../../../shared/contracts/auth";
import { AppError } from "../../middleware/app-error";
import type { SpaceRepository } from "../spaces/repository";
import type { ChatMessageWithSender, ChatRepository } from "./repository";

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

function encodeCursor(record: ChatMessageWithSender): string {
  return Buffer.from(
    JSON.stringify({ createdAt: record.createdAt.toISOString(), id: record.id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const payload = cursorPayloadSchema.parse(decoded);
    return { createdAt: new Date(payload.createdAt), id: payload.id };
  } catch {
    throw new AppError(400, "invalid_chat_cursor", "The chat history cursor is invalid.");
  }
}

function toUser(record: ChatMessageWithSender["sender"]): User {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    createdAt: record.createdAt.toISOString(),
  };
}

function toMessage(record: ChatMessageWithSender): ChatMessage {
  return {
    id: record.id,
    spaceId: record.spaceId,
    sender: toUser(record.sender),
    body: record.body,
    createdAt: record.createdAt.toISOString(),
  };
}

export interface ChatService {
  listMessages(spaceId: string, actorId: string, query: ChatHistoryQuery): Promise<ChatHistoryResponse>;
  sendMessage(spaceId: string, actorId: string, input: SendChatMessageInput): Promise<ChatMessage>;
}

export function createChatService(
  repository: ChatRepository,
  spaces: SpaceRepository,
): ChatService {
  async function requireMembership(spaceId: string, actorId: string): Promise<void> {
    if (!(await spaces.findForMember(spaceId, actorId))) {
      throw new AppError(404, "space_not_found", "Research space was not found.");
    }
  }

  return {
    async listMessages(spaceId, actorId, query) {
      await requireMembership(spaceId, actorId);
      const records = await repository.listBefore(spaceId, decodeCursor(query.cursor), query.limit + 1);
      const hasMore = records.length > query.limit;
      const page = records.slice(0, query.limit);
      const oldest = page.at(-1);
      return {
        messages: page.map(toMessage).reverse(),
        nextCursor: hasMore && oldest ? encodeCursor(oldest) : null,
      };
    },

    async sendMessage(spaceId, actorId, input) {
      await requireMembership(spaceId, actorId);
      const validated = sendChatMessageInputSchema.parse(input);
      const message = await repository.insert({
        id: randomUUID(),
        spaceId,
        senderUserId: actorId,
        body: validated.body,
        createdAt: new Date(),
      });
      if (!message) throw new AppError(404, "space_not_found", "Research space was not found.");
      return toMessage(message);
    },
  };
}
