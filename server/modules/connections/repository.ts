import { and, desc, eq, inArray, or } from "drizzle-orm";

import type { Database } from "../../db/client";
import { connections, users, type ConnectionRecord, type UserRecord } from "../../db/schema";

export interface NewConnectionRecord {
  id: string;
  userLowId: string;
  userHighId: string;
  requestedByUserId: string;
  status: "pending";
  createdAt: Date;
  respondedAt: null;
}

export interface ConnectionWithOtherUser extends ConnectionRecord {
  otherUser: UserRecord;
}

export interface ConnectionRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(userId: string): Promise<UserRecord | null>;
  listForUser(userId: string): Promise<ConnectionWithOtherUser[]>;
  findForParticipant(connectionId: string, userId: string): Promise<ConnectionRecord | null>;
  createRequest(connection: NewConnectionRecord): Promise<ConnectionRecord>;
  acceptPending(connectionId: string, recipientId: string, respondedAt: Date): Promise<boolean>;
  deletePending(connectionId: string, actorId: string, requestedByActor: boolean): Promise<boolean>;
  deleteAccepted(connectionId: string, actorId: string): Promise<boolean>;
  areAccepted(userAId: string, userBId: string): Promise<boolean>;
}

export class DuplicateConnectionRepositoryError extends Error {
  constructor() {
    super("A connection already exists for this user pair.");
    this.name = "DuplicateConnectionRepositoryError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function participantCondition(userId: string) {
  return or(eq(connections.userLowId, userId), eq(connections.userHighId, userId));
}

export function createDrizzleConnectionRepository(database: Database): ConnectionRepository {
  const db = database.db;

  return {
    async findUserByEmail(email) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return user ?? null;
    },

    async findUserById(userId) {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return user ?? null;
    },

    async listForUser(userId) {
      const records = await db
        .select()
        .from(connections)
        .where(participantCondition(userId))
        .orderBy(desc(connections.createdAt), desc(connections.id));
      const otherIds = records.map((record) =>
        record.userLowId === userId ? record.userHighId : record.userLowId,
      );
      if (otherIds.length === 0) return [];
      const otherUsers = await db.select().from(users).where(inArray(users.id, otherIds));
      const usersById = new Map(otherUsers.map((user) => [user.id, user]));
      return records.flatMap((record) => {
        const otherId = record.userLowId === userId ? record.userHighId : record.userLowId;
        const otherUser = usersById.get(otherId);
        return otherUser ? [{ ...record, otherUser }] : [];
      });
    },

    async findForParticipant(connectionId, userId) {
      const [record] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, connectionId), participantCondition(userId)))
        .limit(1);
      return record ?? null;
    },

    async createRequest(connection) {
      try {
        const [created] = await db.insert(connections).values(connection).returning();
        if (!created) throw new Error("Connection insert returned no record.");
        return created;
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new DuplicateConnectionRepositoryError();
        throw error;
      }
    },

    async acceptPending(connectionId, recipientId, respondedAt) {
      const updated = await db
        .update(connections)
        .set({ status: "accepted", respondedAt })
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.status, "pending"),
            participantCondition(recipientId),
            or(
              and(eq(connections.userLowId, recipientId), eq(connections.requestedByUserId, connections.userHighId)),
              and(eq(connections.userHighId, recipientId), eq(connections.requestedByUserId, connections.userLowId)),
            ),
          ),
        )
        .returning({ id: connections.id });
      return updated.length > 0;
    },

    async deletePending(connectionId, actorId, requestedByActor) {
      const requesterCondition = requestedByActor
        ? eq(connections.requestedByUserId, actorId)
        : or(
            and(eq(connections.userLowId, actorId), eq(connections.requestedByUserId, connections.userHighId)),
            and(eq(connections.userHighId, actorId), eq(connections.requestedByUserId, connections.userLowId)),
          );
      const deleted = await db
        .delete(connections)
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.status, "pending"),
            participantCondition(actorId),
            requesterCondition,
          ),
        )
        .returning({ id: connections.id });
      return deleted.length > 0;
    },

    async deleteAccepted(connectionId, actorId) {
      const deleted = await db
        .delete(connections)
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.status, "accepted"),
            participantCondition(actorId),
          ),
        )
        .returning({ id: connections.id });
      return deleted.length > 0;
    },

    async areAccepted(userAId, userBId) {
      const [userLowId, userHighId] = [userAId, userBId].sort();
      const [record] = await db
        .select({ id: connections.id })
        .from(connections)
        .where(
          and(
            eq(connections.userLowId, userLowId),
            eq(connections.userHighId, userHighId),
            eq(connections.status, "accepted"),
          ),
        )
        .limit(1);
      return Boolean(record);
    },
  };
}

