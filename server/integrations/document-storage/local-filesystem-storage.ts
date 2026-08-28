import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  DocumentStorageError,
  type DocumentStorage,
  type DocumentStorageErrorCode,
} from "./storage";

const UNAVAILABLE_FILESYSTEM_CODES = new Set(["EACCES", "EMFILE", "ENFILE", "ENOSPC", "EROFS"]);

function filesystemErrorCode(error: unknown): DocumentStorageErrorCode {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && UNAVAILABLE_FILESYSTEM_CODES.has(code)
    ? "DOCUMENT_STORAGE_UNAVAILABLE"
    : "DOCUMENT_STORAGE_FAILURE";
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export class LocalFilesystemDocumentStorage implements DocumentStorage {
  private readonly root: string;
  private readonly stagingRoot: string;

  constructor(storageRoot: string) {
    this.root = path.resolve(storageRoot);
    this.stagingRoot = path.join(this.root, ".staging");
  }

  async prepareStagingDirectory(): Promise<string> {
    return this.run(async () => {
      await mkdir(this.stagingRoot, { recursive: true });
      return this.stagingRoot;
    });
  }

  async readStaged(stagedPath: string): Promise<Buffer> {
    const resolved = this.resolveStagedPath(stagedPath);
    return this.run(() => readFile(resolved));
  }

  async promote(stagedPath: string, storageKey: string): Promise<void> {
    const staged = this.resolveStagedPath(stagedPath);
    const destination = this.resolveStorageKey(storageKey);
    await this.run(async () => {
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(staged, destination);
    });
  }

  async cleanupStaged(stagedPath: string): Promise<void> {
    const resolved = this.resolveStagedPath(stagedPath);
    await this.run(() => rm(resolved, { force: true }));
  }

  async delete(storageKey: string): Promise<void> {
    const resolved = this.resolveStorageKey(storageKey);
    await this.run(() => rm(resolved, { force: true }));
  }

  private resolveStagedPath(stagedPath: string): string {
    const resolved = path.resolve(stagedPath);
    if (!isWithin(this.stagingRoot, resolved) || resolved === this.stagingRoot) {
      throw new DocumentStorageError("DOCUMENT_STORAGE_FAILURE");
    }
    return resolved;
  }

  private resolveStorageKey(storageKey: string): string {
    if (
      !storageKey ||
      storageKey.includes("\\") ||
      storageKey.startsWith("/") ||
      /^[A-Za-z]:/u.test(storageKey)
    ) {
      throw new DocumentStorageError("DOCUMENT_STORAGE_FAILURE");
    }
    const segments = storageKey.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new DocumentStorageError("DOCUMENT_STORAGE_FAILURE");
    }
    const resolved = path.resolve(this.root, ...segments);
    if (!isWithin(this.root, resolved) || isWithin(this.stagingRoot, resolved)) {
      throw new DocumentStorageError("DOCUMENT_STORAGE_FAILURE");
    }
    return resolved;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof DocumentStorageError) throw error;
      throw new DocumentStorageError(filesystemErrorCode(error), { cause: error });
    }
  }
}

