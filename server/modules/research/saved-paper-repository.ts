import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import {
  papers,
  savedPapers,
  spaceMembers,
  type PaperRecord,
  type SavedPaperRecord,
} from "../../db/schema";

export interface SavedPaperWithPaper extends SavedPaperRecord {
  paper: PaperRecord;
}

export type SavedPaperListResult =
  | { status: "ok"; records: SavedPaperWithPaper[] }
  | { status: "space_not_found" };

export type SavePaperResult =
  | { status: "created" | "existing"; record: SavedPaperWithPaper }
  | { status: "space_not_found" }
  | { status: "paper_not_found" };

export type RemoveSavedPaperResult =
  | { status: "removed" }
  | { status: "space_not_found" | "saved_paper_not_found" | "forbidden" };

export interface SavedPaperRepository {
  listForMember(spaceId: string, actorId: string): Promise<SavedPaperListResult>;
  saveForMember(input: {
    spaceId: string;
    paperId: string;
    actorId: string;
    savedAt: Date;
  }): Promise<SavePaperResult>;
  removeForMember(
    spaceId: string,
    paperId: string,
    actorId: string,
  ): Promise<RemoveSavedPaperResult>;
}

export function createDrizzleSavedPaperRepository(database: Database): SavedPaperRepository {
  const db = database.db;

  return {
    async listForMember(spaceId, actorId) {
      return db.transaction(async (transaction): Promise<SavedPaperListResult> => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const rows = await transaction
          .select({ savedPaper: savedPapers, paper: papers })
          .from(savedPapers)
          .innerJoin(papers, eq(papers.id, savedPapers.paperId))
          .where(eq(savedPapers.spaceId, spaceId))
          .orderBy(desc(savedPapers.savedAt), desc(savedPapers.paperId));
        return {
          status: "ok",
          records: rows.map(({ savedPaper, paper }) => ({ ...savedPaper, paper })),
        };
      });
    },

    async saveForMember({ spaceId, paperId, actorId, savedAt }) {
      return db.transaction(async (transaction): Promise<SavePaperResult> => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const [paper] = await transaction
          .select()
          .from(papers)
          .where(eq(papers.id, paperId))
          .limit(1);
        if (!paper) return { status: "paper_not_found" };

        const [created] = await transaction
          .insert(savedPapers)
          .values({ spaceId, paperId, savedByUserId: actorId, savedAt })
          .onConflictDoNothing()
          .returning();
        if (created) return { status: "created", record: { ...created, paper } };

        const [existing] = await transaction
          .select()
          .from(savedPapers)
          .where(and(eq(savedPapers.spaceId, spaceId), eq(savedPapers.paperId, paperId)))
          .limit(1);
        if (!existing) throw new Error("Saved paper conflict returned no record.");
        return { status: "existing", record: { ...existing, paper } };
      });
    },

    async removeForMember(spaceId, paperId, actorId) {
      return db.transaction(async (transaction): Promise<RemoveSavedPaperResult> => {
        const [membership] = await transaction
          .select({ role: spaceMembers.role })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const [savedPaper] = await transaction
          .select()
          .from(savedPapers)
          .where(and(eq(savedPapers.spaceId, spaceId), eq(savedPapers.paperId, paperId)))
          .limit(1)
          .for("update");
        if (!savedPaper) return { status: "saved_paper_not_found" };
        if (membership.role !== "owner" && savedPaper.savedByUserId !== actorId) {
          return { status: "forbidden" };
        }

        const deleted = await transaction
          .delete(savedPapers)
          .where(and(eq(savedPapers.spaceId, spaceId), eq(savedPapers.paperId, paperId)))
          .returning({ paperId: savedPapers.paperId });
        if (deleted.length === 0) throw new Error("Saved paper delete returned no record.");
        return { status: "removed" };
      });
    },
  };
}
