export type DocumentStorageErrorCode =
  | "DOCUMENT_STORAGE_UNAVAILABLE"
  | "DOCUMENT_STORAGE_FAILURE";

export class DocumentStorageError extends Error {
  readonly code: DocumentStorageErrorCode;

  constructor(code: DocumentStorageErrorCode, options: { cause?: unknown } = {}) {
    super(
      code === "DOCUMENT_STORAGE_UNAVAILABLE"
        ? "Document storage is unavailable."
        : "Document storage operation failed.",
      { cause: options.cause },
    );
    this.name = "DocumentStorageError";
    this.code = code;
  }
}

export interface DocumentStorage {
  prepareStagingDirectory(): Promise<string>;
  readStaged(stagedPath: string): Promise<Buffer>;
  readSource(storageKey: string): Promise<Uint8Array>;
  promote(stagedPath: string, storageKey: string): Promise<void>;
  cleanupStaged(stagedPath: string): Promise<void>;
  delete(storageKey: string): Promise<void>;
}
