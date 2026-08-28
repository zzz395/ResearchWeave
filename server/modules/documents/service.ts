import { randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import type {
  Document,
  DocumentListQuery,
  DocumentListResponse,
} from "../../../shared/contracts/documents";
import type { DocumentRecord } from "../../db/schema";
import {
  DocumentStorageError,
  type DocumentStorage,
} from "../../integrations/document-storage/storage";
import {
  DocumentSourceValidationError,
  validateDocumentSource,
} from "../../integrations/document-upload/source-validation";
import { AppError } from "../../middleware/app-error";
import type {
  DocumentCursorRecord,
  DocumentRepository,
  NewDocumentRecord,
} from "./repository";

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
}).strict();

const canonicalBase64UrlSchema = /^[A-Za-z0-9_-]+$/u;

export interface StagedDocumentUpload {
  path: string;
  originalname: string;
}

export interface UploadDocumentResult {
  document: Document;
  created: boolean;
}

export interface DocumentService {
  authorizeUpload(spaceId: string, actorId: string): Promise<void>;
  uploadDocument(
    spaceId: string,
    actorId: string,
    file: StagedDocumentUpload | undefined,
  ): Promise<UploadDocumentResult>;
  listDocuments(
    spaceId: string,
    actorId: string,
    query: DocumentListQuery,
  ): Promise<DocumentListResponse>;
  getDocument(spaceId: string, documentId: string, actorId: string): Promise<Document>;
  deleteDocument(spaceId: string, documentId: string, actorId: string): Promise<void>;
}

export function documentStorageErrorToAppError(error: DocumentStorageError): AppError {
  return error.code === "DOCUMENT_STORAGE_UNAVAILABLE"
    ? new AppError(503, "document_storage_unavailable", "Document storage is unavailable.")
    : new AppError(500, "document_storage_failure", "Document storage operation failed.");
}

function toDocument(record: DocumentRecord): Document {
  return {
    id: record.id,
    spaceId: record.spaceId,
    uploadedByUserId: record.uploadedByUserId,
    originalFilename: record.originalFilename,
    mediaType: record.mediaType,
    sizeBytes: record.sizeBytes,
    status: record.status,
    stage: record.stage,
    attemptCount: record.attemptCount,
    lastAttemptAt: record.lastAttemptAt?.toISOString() ?? null,
    errorCode: record.errorCode,
    failedAt: record.failedAt?.toISOString() ?? null,
    pageCount: record.pageCount,
    characterCount: record.characterCount,
    chunkCount: record.chunkCount,
    extractorVersion: record.extractorVersion,
    chunkerVersion: record.chunkerVersion,
    embeddingModel: record.embeddingModel,
    embeddingDimensions: record.embeddingDimensions,
    indexFingerprint: record.indexFingerprint,
    indexedAt: record.indexedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function encodeCursor(record: DocumentRecord): string {
  return Buffer.from(
    JSON.stringify({ createdAt: record.createdAt.toISOString(), id: record.id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string | undefined): DocumentCursorRecord | null {
  if (!cursor) return null;
  try {
    if (!canonicalBase64UrlSchema.test(cursor) || cursor.length % 4 === 1) throw new Error();
    const decodedBytes = Buffer.from(cursor, "base64url");
    if (decodedBytes.toString("base64url") !== cursor) throw new Error();
    const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(decodedBytes);
    const decoded: unknown = JSON.parse(decodedText);
    const payload = cursorPayloadSchema.parse(decoded);
    return { createdAt: new Date(payload.createdAt), id: payload.id };
  } catch {
    throw new AppError(400, "invalid_document_cursor", "The document list cursor is invalid.");
  }
}

function storageKeyFor(spaceId: string, documentId: string): string {
  return `spaces/${spaceId}/${documentId}/source`;
}

function mapSourceValidationError(error: DocumentSourceValidationError): AppError {
  return error.code === "DOCUMENT_UNSUPPORTED_TYPE"
    ? new AppError(415, "document_unsupported_type", "This document type is not supported.")
    : new AppError(400, "document_invalid_file", "The uploaded document is invalid.");
}

export function createDocumentService(
  repository: DocumentRepository,
  storage: DocumentStorage,
  logger: Pick<Logger, "warn">,
): DocumentService {
  async function bestEffortCleanupStaged(stagedPath: string, reason: string): Promise<void> {
    try {
      await storage.cleanupStaged(stagedPath);
    } catch (error: unknown) {
      logger.warn(
        { reason, errorType: error instanceof Error ? error.name : "UnknownError" },
        "document staging cleanup failed",
      );
    }
  }

  async function bestEffortDelete(storageKey: string, reason: string): Promise<void> {
    try {
      await storage.delete(storageKey);
    } catch (error: unknown) {
      logger.warn(
        { reason, errorType: error instanceof Error ? error.name : "UnknownError" },
        "document file cleanup failed",
      );
    }
  }

  return {
    async authorizeUpload(spaceId, actorId) {
      if (!(await repository.hasMembership(spaceId, actorId))) {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
    },

    async uploadDocument(spaceId, actorId, file) {
      if (!file) {
        throw new AppError(400, "document_file_required", "A document file is required.");
      }

      let stagedOwned = true;
      let finalOwned = false;
      let storageKey: string | undefined;
      try {
        const bytes = await storage.readStaged(file.path);
        const source = validateDocumentSource(file.originalname, bytes);
        const documentId = randomUUID();
        storageKey = storageKeyFor(spaceId, documentId);
        const now = new Date();
        const record: NewDocumentRecord = {
          id: documentId,
          spaceId,
          uploadedByUserId: actorId,
          originalFilename: source.originalFilename,
          mediaType: source.mediaType,
          sizeBytes: source.sizeBytes,
          sourceSha256: source.sourceSha256,
          storageKey,
          status: "queued",
          stage: null,
          attemptCount: 0,
          lastAttemptAt: null,
          errorCode: null,
          failedAt: null,
          pageCount: null,
          characterCount: null,
          chunkCount: 0,
          extractorVersion: null,
          chunkerVersion: null,
          embeddingModel: null,
          embeddingDimensions: null,
          indexFingerprint: null,
          indexedAt: null,
          createdAt: now,
          updatedAt: now,
        };

        await storage.promote(file.path, storageKey);
        stagedOwned = false;
        finalOwned = true;

        const result = await repository.createForMember(record, actorId);
        if (result.status === "created") {
          finalOwned = false;
          return { document: toDocument(result.record), created: true };
        }

        await bestEffortDelete(storageKey, "duplicate_or_authorization_cleanup");
        finalOwned = false;
        if (result.status === "space_not_found") {
          throw new AppError(404, "space_not_found", "Research space was not found.");
        }
        return { document: toDocument(result.record), created: false };
      } catch (error: unknown) {
        if (stagedOwned) await bestEffortCleanupStaged(file.path, "upload_failure");
        if (finalOwned && storageKey) await bestEffortDelete(storageKey, "persistence_failure");
        if (error instanceof DocumentSourceValidationError) throw mapSourceValidationError(error);
        if (error instanceof DocumentStorageError) throw documentStorageErrorToAppError(error);
        throw error;
      }
    },

    async listDocuments(spaceId, actorId, query) {
      const result = await repository.listForMember(
        spaceId,
        actorId,
        decodeCursor(query.cursor),
        query.limit + 1,
      );
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      const hasMore = result.records.length > query.limit;
      const page = result.records.slice(0, query.limit);
      const last = page.at(-1);
      return {
        documents: page.map(toDocument),
        nextCursor: hasMore && last ? encodeCursor(last) : null,
      };
    },

    async getDocument(spaceId, documentId, actorId) {
      const result = await repository.findForMember(spaceId, documentId, actorId);
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      if (result.status === "document_not_found") {
        throw new AppError(404, "document_not_found", "Document was not found.");
      }
      return toDocument(result.record);
    },

    async deleteDocument(spaceId, documentId, actorId) {
      const result = await repository.deleteForMember(spaceId, documentId, actorId);
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      if (result.status === "document_not_found") {
        throw new AppError(404, "document_not_found", "Document was not found.");
      }
      if (result.status === "forbidden") {
        throw new AppError(
          403,
          "document_delete_forbidden",
          "Only the original uploader or the space owner can delete this document.",
        );
      }
      await bestEffortDelete(result.storageKey, "document_deleted");
    },
  };
}
