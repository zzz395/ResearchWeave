import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { spaceMembers, users, type SpaceMemberRecord, type UserRecord } from "../../db/schema";

export interface MemberWithUser extends SpaceMemberRecord {
  user: UserRecord;
}

export interface MemberRepository {
  list(spaceId: string): Promise<MemberWithUser[]>;
  find(spaceId: string, userId: string): Promise<MemberWithUser | null>;
  add(spaceId: string, userId: string, joinedAt: Date): Promise<MemberWithUser | null>;
  removeOrdinaryMember(spaceId: string, userId: string): Promise<boolean>;
}

export function createDrizzleMemberRepository(database: Database): MemberRepository {
  const db = database.db;

  return {
    async list(spaceId) {
      const rows = await db
        .select({ membership: spaceMembers, user: users })
        .from(spaceMembers)
        .innerJoin(users, eq(users.id, spaceMembers.userId))
        .where(eq(spaceMembers.spaceId, spaceId))
        .orderBy(asc(spaceMembers.joinedAt), asc(users.displayName));
      return rows.map(({ membership, user }) => ({ ...membership, user }));
    },

    async find(spaceId, userId) {
      const [row] = await db
        .select({ membership: spaceMembers, user: users })
        .from(spaceMembers)
        .innerJoin(users, eq(users.id, spaceMembers.userId))
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
        .limit(1);
      return row ? { ...row.membership, user: row.user } : null;
    },

    async add(spaceId, userId, joinedAt) {
      const [membership] = await db
        .insert(spaceMembers)
        .values({ spaceId, userId, role: "member", joinedAt })
        .onConflictDoNothing()
        .returning();
      if (!membership) return null;
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new Error("New member user record was not found.");
      return { ...membership, user };
    },

    async removeOrdinaryMember(spaceId, userId) {
      const deleted = await db
        .delete(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, spaceId),
            eq(spaceMembers.userId, userId),
            eq(spaceMembers.role, "member"),
          ),
        )
        .returning({ userId: spaceMembers.userId });
      return deleted.length > 0;
    },
  };
}

