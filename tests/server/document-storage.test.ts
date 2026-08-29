import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalFilesystemDocumentStorage } from "../../server/integrations/document-storage/local-filesystem-storage";
import { DocumentStorageError } from "../../server/integrations/document-storage/storage";

describe("local filesystem document storage", () => {
  let root = "";
  let storage: LocalFilesystemDocumentStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "researchweave-documents-"));
    storage = new LocalFilesystemDocumentStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function stagedFile(content = "durable bytes") {
    const staging = await storage.prepareStagingDirectory();
    const stagedPath = path.join(staging, "server-generated-staging-id");
    await writeFile(stagedPath, content);
    return stagedPath;
  }

  it("creates staging under the configured root and reads bounded staged bytes", async () => {
    const stagedPath = await stagedFile();
    expect(path.relative(root, stagedPath).startsWith(".staging")).toBe(true);
    await expect(storage.readStaged(stagedPath)).resolves.toEqual(Buffer.from("durable bytes"));
  });

  it("promotes by server-controlled key and creates destination directories", async () => {
    const stagedPath = await stagedFile("original");
    const storageKey =
      "spaces/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/source";
    await storage.promote(stagedPath, storageKey);
    await expect(readFile(path.join(root, ...storageKey.split("/")), "utf8")).resolves.toBe(
      "original",
    );
    await expect(readFile(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(storage.readSource(storageKey)).resolves.toEqual(Buffer.from("original"));
  });

  it("does not accept an original filename when determining the final destination", async () => {
    const stagedPath = await stagedFile("safe");
    const storageKey =
      "spaces/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/source";
    await storage.promote(stagedPath, storageKey);
    expect(storageKey).not.toContain("../../server.ts");
    await expect(readFile(path.join(root, ...storageKey.split("/")), "utf8")).resolves.toBe("safe");
  });

  it("deletes stored files idempotently", async () => {
    const stagedPath = await stagedFile();
    const storageKey =
      "spaces/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/source";
    await storage.promote(stagedPath, storageKey);
    await storage.delete(storageKey);
    await expect(storage.delete(storageKey)).resolves.toBeUndefined();
  });

  it.each(["../escape", "/absolute/source", "C:/absolute/source", "spaces\\escape\\source"])(
    "rejects unsafe storage key %s",
    async (storageKey) => {
      const stagedPath = await stagedFile();
      await expect(storage.promote(stagedPath, storageKey)).rejects.toBeInstanceOf(
        DocumentStorageError,
      );
      await expect(storage.readSource(storageKey)).rejects.toBeInstanceOf(DocumentStorageError);
    },
  );

  it("reports a missing durable source explicitly", async () => {
    await expect(storage.readSource("spaces/space/document/source")).rejects.toBeInstanceOf(
      DocumentStorageError,
    );
  });

  it("rejects staged paths outside the configured staging root", async () => {
    const outside = path.join(root, "outside");
    await writeFile(outside, "outside");
    await expect(storage.readStaged(outside)).rejects.toBeInstanceOf(DocumentStorageError);
    await expect(storage.cleanupStaged(outside)).rejects.toBeInstanceOf(DocumentStorageError);
  });

  it("reports promotion failure instead of pretending success", async () => {
    const staging = await storage.prepareStagingDirectory();
    const missing = path.join(staging, "missing");
    await expect(storage.promote(missing, "spaces/space/document/source")).rejects.toBeInstanceOf(
      DocumentStorageError,
    );
  });
});
