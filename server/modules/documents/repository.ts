import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "../../db/client";
import { documents, spaceMembers, type DocumentRecord } from "../../db/schema";

export type NewDocumentRecord = DocumentRecord;

export interface DocumentCursorRecord {
  createdAt: Date;
  id: string;
}

export type CreateDocumentResult =
  | { status: "created" | "existing"; record: DocumentRecord }
  | { status: "space_not_found" };

export type DocumentListResult =
  | { status: "ok"; records: DocumentRecord[] }
  | { status: "space_not_found" };

export type DocumentDetailResult =
  | { status: "ok"; record: DocumentRecord }
  | { status: "space_not_found" }
  | { status: "document_not_found" };

export type DeleteDocumentResult =
  | { status: "removed"; storageKey: string }
  | { status: "space_not_found" }
  | { status: "document_not_found" }
  | { status: "forbidden" };

export interface DocumentRepository {
  hasMembership(spaceId: string, actorId: string): Promise<boolean>;
  createForMember(record: NewDocumentRecord, actorId: string): Promise<CreateDocumentResult>;
  listForMember(
    spaceId: string,
    actorId: string,
    cursor: DocumentCursorRecord | null,
    limit: number,
  ): Promise<DocumentListResult>;
  findForMember(spaceId: string, documentId: string, actorId: string): Promise<DocumentDetailResult>;
  deleteForMember(
    spaceId: string,
    documentId: string,
    actorId: string,
  ): Promise<DeleteDocumentResult>;
}

export function createDrizzleDocumentRepository(database: Database): DocumentRepository {
  const db = database.db;

  return {
    async hasMembership(spaceId, actorId) {
      const [membership] = await db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actorId)))
        .limit(1);
      return Boolean(membership);
    },

    async createForMember(record, actorId) {
      return db.transaction(async (transaction): Promise<CreateDocumentResult> => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, record.spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const [created] = await transaction
          .insert(documents)
          .values(record)
          .onConflictDoNothing({ target: [documents.spaceId, documents.sourceSha256] })
          .returning();
        if (created) return { status: "created", record: created };

        const [existing] = await transaction
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.spaceId, record.spaceId),
              eq(documents.sourceSha256, record.sourceSha256),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("Document conflict returned no record.");
        return { status: "existing", record: existing };
      });
    },

    async listForMember(spaceId, actorId, cursor, limit) {
      return db.transaction(async (transaction): Promise<DocumentListResult> => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const cursorCondition = cursor
          ? or(
              lt(documents.createdAt, cursor.createdAt),
              and(eq(documents.createdAt, cursor.createdAt), lt(documents.id, cursor.id)),
            )
          : undefined;
        const records = await transaction
          .select()
          .from(documents)
          .where(and(eq(documents.spaceId, spaceId), cursorCondition))
          .orderBy(desc(documents.createdAt), desc(documents.id))
          .limit(limit);
        return { status: "ok", records };
      });
    },

    async findForMember(spaceId, documentId, actorId) {
      return db.transaction(async (transaction): Promise<DocumentDetailResult> => {
        const [membership] = await transaction
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const [record] = await transaction
          .select()
          .from(documents)
          .where(and(eq(documents.spaceId, spaceId), eq(documents.id, documentId)))
          .limit(1);
        return record ? { status: "ok", record } : { status: "document_not_found" };
      });
    },

    async deleteForMember(spaceId, documentId, actorId) {
      return db.transaction(async (transaction): Promise<DeleteDocumentResult> => {
        const [membership] = await transaction
          .select({ role: spaceMembers.role })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1)
          .for("share");
        if (!membership) return { status: "space_not_found" };

        const [record] = await transaction
          .select()
          .from(documents)
          .where(and(eq(documents.spaceId, spaceId), eq(documents.id, documentId)))
          .limit(1)
          .for("update");
        if (!record) return { status: "document_not_found" };
        if (membership.role !== "owner" && record.uploadedByUserId !== actorId) {
          return { status: "forbidden" };
        }
        const removed = await transaction
          .delete(documents)
          .where(and(eq(documents.spaceId, spaceId), eq(documents.id, documentId)))
          .returning({ id: documents.id });
        if (removed.length === 0) throw new Error("Document delete returned no record.");
        return { status: "removed", storageKey: record.storageKey };
      });
    },
  };
}
