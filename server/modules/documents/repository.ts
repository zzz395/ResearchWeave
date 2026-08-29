import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "../../db/client";
import {
  documentChunks,
  documents,
  spaceMembers,
  type DocumentRecord,
} from "../../db/schema";
import type { DocumentMediaType, DocumentStage } from "../../../shared/contracts/documents";
import type { DocumentChunkDraft } from "./document-chunker";

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

export interface DocumentIndexingClaim {
  documentId: string;
  mediaType: DocumentMediaType;
  storageKey: string;
  sourceSha256: string;
  attemptNumber: number;
}

export interface DocumentIndexChunk extends DocumentChunkDraft {
  embedding: number[];
}

export interface ActivateDocumentIndexInput {
  documentId: string;
  attemptNumber: number;
  pageCount: number | null;
  characterCount: number;
  extractorVersion: string;
  chunkerVersion: string;
  embeddingModel: string;
  embeddingDimensions: number;
  indexFingerprint: string;
  chunks: DocumentIndexChunk[];
}

export type ActivateDocumentIndexResult = { status: "activated" | "stale" };

export type QueueDocumentReindexResult =
  | { status: "accepted"; record: DocumentRecord }
  | { status: "space_not_found" }
  | { status: "document_not_found" }
  | { status: "forbidden" };

export function hasActiveDocumentIndex(record: Pick<DocumentRecord, "indexedAt">): boolean {
  return record.indexedAt !== null;
}

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
  queueReindexForMember(
    spaceId: string,
    documentId: string,
    actorId: string,
  ): Promise<QueueDocumentReindexResult>;
  recoverProcessingDocuments(now: Date): Promise<number>;
  claimNextQueuedDocument(now: Date): Promise<DocumentIndexingClaim | null>;
  updateProcessingStage(
    documentId: string,
    attemptNumber: number,
    stage: DocumentStage,
    now: Date,
  ): Promise<boolean>;
  markIndexingFailed(
    documentId: string,
    attemptNumber: number,
    stage: DocumentStage,
    errorCode: string,
    now: Date,
  ): Promise<boolean>;
  activateDocumentIndex(
    input: ActivateDocumentIndexInput,
    now: Date,
  ): Promise<ActivateDocumentIndexResult>;
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

    async queueReindexForMember(spaceId, documentId, actorId) {
      return db.transaction(async (transaction): Promise<QueueDocumentReindexResult> => {
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
        if (record.status === "queued" || record.status === "processing") {
          return { status: "accepted", record };
        }

        const now = new Date();
        const [queued] = await transaction
          .update(documents)
          .set({
            status: "queued",
            stage: null,
            errorCode: null,
            failedAt: null,
            updatedAt: now,
          })
          .where(and(eq(documents.id, documentId), eq(documents.spaceId, spaceId)))
          .returning();
        if (!queued) throw new Error("Document reindex update returned no record.");
        return { status: "accepted", record: queued };
      });
    },

    async recoverProcessingDocuments(now) {
      const recovered = await db
        .update(documents)
        .set({ status: "queued", stage: null, updatedAt: now })
        .where(eq(documents.status, "processing"))
        .returning({ id: documents.id });
      return recovered.length;
    },

    async claimNextQueuedDocument(now) {
      return db.transaction(async (transaction): Promise<DocumentIndexingClaim | null> => {
        const [record] = await transaction
          .select()
          .from(documents)
          .where(eq(documents.status, "queued"))
          .orderBy(asc(documents.updatedAt), asc(documents.id))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!record) return null;

        const attemptNumber = record.attemptCount + 1;
        const [claimed] = await transaction
          .update(documents)
          .set({
            status: "processing",
            stage: "extracting",
            attemptCount: attemptNumber,
            lastAttemptAt: now,
            errorCode: null,
            failedAt: null,
            updatedAt: now,
          })
          .where(and(eq(documents.id, record.id), eq(documents.status, "queued")))
          .returning({ id: documents.id });
        if (!claimed) return null;
        return {
          documentId: record.id,
          mediaType: record.mediaType,
          storageKey: record.storageKey,
          sourceSha256: record.sourceSha256,
          attemptNumber,
        };
      });
    },

    async updateProcessingStage(documentId, attemptNumber, stage, now) {
      const updated = await db
        .update(documents)
        .set({ stage, updatedAt: now })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.status, "processing"),
            eq(documents.attemptCount, attemptNumber),
          ),
        )
        .returning({ id: documents.id });
      return updated.length === 1;
    },

    async markIndexingFailed(documentId, attemptNumber, stage, errorCode, now) {
      const updated = await db
        .update(documents)
        .set({ status: "failed", stage, errorCode, failedAt: now, updatedAt: now })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.status, "processing"),
            eq(documents.attemptCount, attemptNumber),
          ),
        )
        .returning({ id: documents.id });
      return updated.length === 1;
    },

    async activateDocumentIndex(input, now) {
      return db.transaction(async (transaction): Promise<ActivateDocumentIndexResult> => {
        const [record] = await transaction
          .select({ status: documents.status, attemptCount: documents.attemptCount })
          .from(documents)
          .where(eq(documents.id, input.documentId))
          .limit(1)
          .for("update");
        if (
          !record ||
          record.status !== "processing" ||
          record.attemptCount !== input.attemptNumber
        ) {
          return { status: "stale" };
        }

        await transaction
          .delete(documentChunks)
          .where(eq(documentChunks.documentId, input.documentId));
        for (let offset = 0; offset < input.chunks.length; offset += 100) {
          const batch = input.chunks.slice(offset, offset + 100).map((chunk) => ({
            id: randomUUID(),
            documentId: input.documentId,
            ordinal: chunk.ordinal,
            content: chunk.content,
            contentHash: chunk.contentHash,
            pageNumber: chunk.pageNumber,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            embedding: chunk.embedding,
          }));
          if (batch.length > 0) await transaction.insert(documentChunks).values(batch);
        }

        const updated = await transaction
          .update(documents)
          .set({
            status: "ready",
            stage: null,
            errorCode: null,
            failedAt: null,
            pageCount: input.pageCount,
            characterCount: input.characterCount,
            chunkCount: input.chunks.length,
            extractorVersion: input.extractorVersion,
            chunkerVersion: input.chunkerVersion,
            embeddingModel: input.embeddingModel,
            embeddingDimensions: input.embeddingDimensions,
            indexFingerprint: input.indexFingerprint,
            indexedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(documents.id, input.documentId),
              eq(documents.status, "processing"),
              eq(documents.attemptCount, input.attemptNumber),
            ),
          )
          .returning({ id: documents.id });
        if (updated.length !== 1) {
          throw new Error("Document activation update returned no record.");
        }
        return { status: "activated" };
      });
    },
  };
}
