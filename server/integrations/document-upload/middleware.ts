import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";
import multer from "multer";
import type { Logger } from "pino";

import type { DocumentStorage } from "../document-storage/storage";
import { DocumentStorageError } from "../document-storage/storage";
import { AppError } from "../../middleware/app-error";
import { documentStorageErrorToAppError } from "../../modules/documents/service";

export const MAX_DOCUMENT_FILE_BYTES = 20 * 1024 * 1024;

const UNAVAILABLE_STAGING_ERROR_CODES = new Set([
  "EACCES",
  "EDQUOT",
  "EMFILE",
  "ENOENT",
  "ENFILE",
  "ENOSPC",
  "EPERM",
  "EROFS",
]);
const SAFE_SYSTEM_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

export interface DocumentUploadMiddlewareOptions {
  storageEngine?: multer.StorageEngine;
}

function systemFilesystemErrorCode(error: unknown): string | null {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !SAFE_SYSTEM_ERROR_CODE.test(error.code)
  ) {
    return null;
  }
  if (UNAVAILABLE_STAGING_ERROR_CODES.has(error.code)) return error.code;
  const hasSystemSignal =
    ("errno" in error && (typeof error.errno === "number" || typeof error.errno === "string")) ||
    ("syscall" in error && typeof error.syscall === "string");
  return hasSystemSignal ? error.code : null;
}

function multerStorageErrors(error: unknown): unknown[] {
  if (typeof error !== "object" || error === null || !("storageErrors" in error)) return [];
  return Array.isArray(error.storageErrors) ? error.storageErrors : [];
}

function mapUploadError(error: unknown): Error {
  if (error instanceof DocumentStorageError) return documentStorageErrorToAppError(error);
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return new AppError(413, "document_too_large", "The document exceeds the 20 MiB limit.");
    }
    return new AppError(400, "document_invalid_file", "The multipart document upload is invalid.");
  }
  const filesystemCode = systemFilesystemErrorCode(error);
  if (filesystemCode) {
    return documentStorageErrorToAppError(
      new DocumentStorageError(
        UNAVAILABLE_STAGING_ERROR_CODES.has(filesystemCode)
          ? "DOCUMENT_STORAGE_UNAVAILABLE"
          : "DOCUMENT_STORAGE_FAILURE",
        { cause: error },
      ),
    );
  }
  return error instanceof Error ? error : new Error("Document upload failed.");
}

export function createDocumentUploadMiddleware(
  storage: DocumentStorage,
  logger: Pick<Logger, "warn">,
  options: DocumentUploadMiddlewareOptions = {},
): RequestHandler {
  const parser = multer({
    storage:
      options.storageEngine ??
      multer.diskStorage({
        destination: (_request, _file, callback) => {
          void storage
            .prepareStagingDirectory()
            .then((directory) => callback(null, directory))
            .catch((error: unknown) => callback(error as Error, ""));
        },
        filename: (_request, _file, callback) => callback(null, randomUUID()),
      }),
    limits: {
      fileSize: MAX_DOCUMENT_FILE_BYTES,
      files: 1,
      fields: 0,
      // Busboy emits partsLimit when the count reaches the configured value,
      // so 2 is the strict upper bound that permits exactly one file part.
      parts: 2,
      fieldNestingDepth: 0,
    },
    preservePath: false,
  }).single("file");

  return (request, response, next) => {
    parser(request, response, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      const cleanupErrors = multerStorageErrors(error);
      if (cleanupErrors.length > 0) {
        logger.warn(
          {
            requestId: String(response.locals.requestId ?? "unknown"),
            reason: "multipart_cleanup_failure",
            cleanupErrorCount: cleanupErrors.length,
            cleanupErrorCodes: cleanupErrors
              .map(systemFilesystemErrorCode)
              .filter((code): code is string => code !== null),
          },
          "document upload staging cleanup failed",
        );
        next(mapUploadError(error));
        return;
      }
      const stagedPath = request.file?.path;
      if (!stagedPath) {
        next(mapUploadError(error));
        return;
      }
      void storage
        .cleanupStaged(stagedPath)
        .catch((cleanupError: unknown) => {
          logger.warn(
            {
              reason: "multipart_failure",
              errorType: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
            },
            "document staging cleanup failed",
          );
        })
        .finally(() => next(mapUploadError(error)));
    });
  };
}
