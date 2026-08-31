import { and, asc, eq, isNotNull } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";

import type { Database } from "../../db/client";
import { documentChunks, documents, spaceMembers } from "../../db/schema";
import { DOCUMENT_EMBEDDING_DIMENSIONS } from "../documents/document-embedding-generator";

export interface SemanticRetrievalRecord {
  documentId: string;
  originalFilename: string;
  ordinal: number;
  content: string;
  contentHash: string;
  pageNumber: number | null;
  startOffset: number;
  endOffset: number;
  cosineDistance: number;
}

export interface SemanticRetrievalRepositoryInput {
  spaceId: string;
  actorId: string;
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
  limit: number;
}

export type SemanticRetrievalRepositoryResult =
  | { status: "ok"; records: SemanticRetrievalRecord[] }
  | { status: "space_not_found" }
  | { status: "knowledge_not_indexed" }
  | { status: "knowledge_embedding_incompatible" };

export interface SemanticRetrievalRepository {
  hasMembership(spaceId: string, actorId: string): Promise<boolean>;
  searchForMember(
    input: SemanticRetrievalRepositoryInput,
  ): Promise<SemanticRetrievalRepositoryResult>;
}

export function createDrizzleSemanticRetrievalRepository(
  database: Database,
): SemanticRetrievalRepository {
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

    async searchForMember(input) {
      return db.transaction(
        async (transaction): Promise<SemanticRetrievalRepositoryResult> => {
          const [membership] = await transaction
            .select({ userId: spaceMembers.userId })
            .from(spaceMembers)
            .where(
              and(
                eq(spaceMembers.spaceId, input.spaceId),
                eq(spaceMembers.userId, input.actorId),
              ),
            )
            .limit(1)
            .for("share");
          if (!membership) return { status: "space_not_found" };

          const activeIndexes = await transaction
            .select({
              embeddingModel: documents.embeddingModel,
              embeddingDimensions: documents.embeddingDimensions,
            })
            .from(documents)
            .where(and(eq(documents.spaceId, input.spaceId), isNotNull(documents.indexedAt)));
          if (activeIndexes.length === 0) return { status: "knowledge_not_indexed" };
          if (
            activeIndexes.some(
              (index) =>
                index.embeddingModel !== input.embeddingModel ||
                index.embeddingDimensions !== input.embeddingDimensions,
            ) ||
            input.embeddingDimensions !== DOCUMENT_EMBEDDING_DIMENSIONS
          ) {
            return { status: "knowledge_embedding_incompatible" };
          }

          const distance = cosineDistance(documentChunks.embedding, input.embedding).mapWith(Number);
          const records = await transaction
            .select({
              documentId: documents.id,
              originalFilename: documents.originalFilename,
              ordinal: documentChunks.ordinal,
              content: documentChunks.content,
              contentHash: documentChunks.contentHash,
              pageNumber: documentChunks.pageNumber,
              startOffset: documentChunks.startOffset,
              endOffset: documentChunks.endOffset,
              cosineDistance: distance,
            })
            .from(documentChunks)
            .innerJoin(documents, eq(documents.id, documentChunks.documentId))
            .where(
              and(
                eq(documents.spaceId, input.spaceId),
                isNotNull(documents.indexedAt),
                eq(documents.embeddingModel, input.embeddingModel),
                eq(documents.embeddingDimensions, input.embeddingDimensions),
              ),
            )
            .orderBy(
              asc(distance),
              asc(documents.id),
              asc(documentChunks.ordinal),
              asc(documentChunks.id),
            )
            .limit(input.limit);
          return { status: "ok", records };
        },
        { isolationLevel: "repeatable read" },
      );
    },
  };
}
