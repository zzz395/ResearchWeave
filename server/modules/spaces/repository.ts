import { and, desc, eq } from "drizzle-orm";

import type { SpaceRole } from "../../../shared/contracts/spaces";
import type { Database } from "../../db/client";
import {
  researchSpaces,
  spaceMembers,
  type ResearchSpaceRecord,
} from "../../db/schema";

export interface AccessibleSpaceRecord extends ResearchSpaceRecord {
  role: SpaceRole;
}

export interface NewSpaceRecord {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceRepository {
  listForUser(userId: string): Promise<AccessibleSpaceRecord[]>;
  findForMember(spaceId: string, userId: string): Promise<AccessibleSpaceRecord | null>;
  createForOwner(space: NewSpaceRecord): Promise<AccessibleSpaceRecord>;
  updateForOwner(
    spaceId: string,
    ownerId: string,
    changes: Partial<Pick<NewSpaceRecord, "name" | "description" | "updatedAt">>,
  ): Promise<ResearchSpaceRecord | null>;
  deleteForOwner(spaceId: string, ownerId: string): Promise<boolean>;
}

export function createDrizzleSpaceRepository(database: Database): SpaceRepository {
  const db = database.db;

  return {
    async listForUser(userId) {
      const rows = await db
        .select({ space: researchSpaces, role: spaceMembers.role })
        .from(spaceMembers)
        .innerJoin(researchSpaces, eq(researchSpaces.id, spaceMembers.spaceId))
        .where(eq(spaceMembers.userId, userId))
        .orderBy(desc(researchSpaces.updatedAt));
      return rows.map(({ space, role }) => ({ ...space, role }));
    },

    async findForMember(spaceId, userId) {
      const [row] = await db
        .select({ space: researchSpaces, role: spaceMembers.role })
        .from(spaceMembers)
        .innerJoin(researchSpaces, eq(researchSpaces.id, spaceMembers.spaceId))
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
        .limit(1);
      return row ? { ...row.space, role: row.role } : null;
    },

    async createForOwner(space) {
      return db.transaction(async (transaction) => {
        const [created] = await transaction.insert(researchSpaces).values(space).returning();
        if (!created) throw new Error("Space insert returned no record.");
        await transaction.insert(spaceMembers).values({
          spaceId: created.id,
          userId: created.ownerId,
          role: "owner",
          joinedAt: created.createdAt,
        });
        return { ...created, role: "owner" as const };
      });
    },

    async updateForOwner(spaceId, ownerId, changes) {
      const [updated] = await db
        .update(researchSpaces)
        .set(changes)
        .where(and(eq(researchSpaces.id, spaceId), eq(researchSpaces.ownerId, ownerId)))
        .returning();
      return updated ?? null;
    },

    async deleteForOwner(spaceId, ownerId) {
      const deleted = await db
        .delete(researchSpaces)
        .where(and(eq(researchSpaces.id, spaceId), eq(researchSpaces.ownerId, ownerId)))
        .returning({ id: researchSpaces.id });
      return deleted.length > 0;
    },
  };
}
