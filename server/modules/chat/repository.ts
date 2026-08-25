import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "../../db/client";
import {
  chatMessages,
  spaceMembers,
  users,
  type ChatMessageRecord,
  type UserRecord,
} from "../../db/schema";

export interface NewChatMessageRecord {
  id: string;
  spaceId: string;
  senderUserId: string;
  body: string;
  createdAt: Date;
}

export interface ChatCursorRecord {
  createdAt: Date;
  id: string;
}

export interface ChatMessageWithSender extends ChatMessageRecord {
  sender: UserRecord;
}

export interface ChatRepository {
  insert(message: NewChatMessageRecord): Promise<ChatMessageWithSender | null>;
  listBefore(
    spaceId: string,
    cursor: ChatCursorRecord | null,
    limit: number,
  ): Promise<ChatMessageWithSender[]>;
}

export function createDrizzleChatRepository(database: Database): ChatRepository {
  const db = database.db;

  return {
    async insert(message) {
      return db.transaction(async (transaction) => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.spaceId, message.spaceId),
              eq(spaceMembers.userId, message.senderUserId),
            ),
          )
          .limit(1)
          .for("share");
        if (!membership) return null;
        const [created] = await transaction.insert(chatMessages).values(message).returning();
        if (!created) throw new Error("Chat message insert returned no record.");
        const [sender] = await transaction
          .select()
          .from(users)
          .where(eq(users.id, created.senderUserId))
          .limit(1);
        if (!sender) throw new Error("Chat message sender was not found.");
        return { ...created, sender };
      });
    },

    async listBefore(spaceId, cursor, limit) {
      const cursorCondition = cursor
        ? or(
            lt(chatMessages.createdAt, cursor.createdAt),
            and(eq(chatMessages.createdAt, cursor.createdAt), lt(chatMessages.id, cursor.id)),
          )
        : undefined;
      const rows = await db
        .select({ message: chatMessages, sender: users })
        .from(chatMessages)
        .innerJoin(users, eq(users.id, chatMessages.senderUserId))
        .where(and(eq(chatMessages.spaceId, spaceId), cursorCondition))
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(limit);
      return rows.map(({ message, sender }) => ({ ...message, sender }));
    },
  };
}
