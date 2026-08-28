import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import multer from "multer";
import pino, { type Logger } from "pino";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import {
  documentListResponseSchema,
  documentResponseSchema,
  documentUploadResponseSchema,
} from "../../shared/contracts/documents";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { researchSpaceResponseSchema } from "../../shared/contracts/spaces";
import { LocalFilesystemDocumentStorage } from "../../server/integrations/document-storage/local-filesystem-storage";
import {
  DocumentStorageError,
  type DocumentStorage,
} from "../../server/integrations/document-storage/storage";
import {
  MAX_DOCUMENT_FILE_BYTES,
  type DocumentUploadMiddlewareOptions,
} from "../../server/integrations/document-upload/middleware";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const origin = testEnvironment.CLIENT_ORIGIN;
const temporaryRoots: string[] = [];

class ObservedDocumentStorage implements DocumentStorage {
  readonly deletedKeys: string[] = [];
  readonly cleanedStagedPaths: string[] = [];
  prepareCalls = 0;
  failPrepare = false;
  failPromote = false;
  failDelete = false;
  failCleanupStaged = false;

  constructor(private readonly delegate: DocumentStorage) {}

  prepareStagingDirectory(): Promise<string> {
    this.prepareCalls += 1;
    if (this.failPrepare) {
      return Promise.reject(new DocumentStorageError("DOCUMENT_STORAGE_UNAVAILABLE"));
    }
    return this.delegate.prepareStagingDirectory();
  }

  readStaged(stagedPath: string): Promise<Buffer> {
    return this.delegate.readStaged(stagedPath);
  }

  promote(stagedPath: string, storageKey: string): Promise<void> {
    if (this.failPromote) {
      return Promise.reject(new DocumentStorageError("DOCUMENT_STORAGE_FAILURE"));
    }
    return this.delegate.promote(stagedPath, storageKey);
  }

  cleanupStaged(stagedPath: string): Promise<void> {
    this.cleanedStagedPaths.push(stagedPath);
    if (this.failCleanupStaged) {
      return Promise.reject(new DocumentStorageError("DOCUMENT_STORAGE_FAILURE"));
    }
    return this.delegate.cleanupStaged(stagedPath);
  }

  delete(storageKey: string): Promise<void> {
    this.deletedKeys.push(storageKey);
    if (this.failDelete) {
      return Promise.reject(new DocumentStorageError("DOCUMENT_STORAGE_FAILURE"));
    }
    return this.delegate.delete(storageKey);
  }
}

const SECRET_STAGING_PATH = "C:\\private\\document-staging\\secret-upload";

function filesystemError(code: string, syscall: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`simulated ${syscall} failure at ${SECRET_STAGING_PATH}`), {
    code,
    errno: -1,
    syscall,
    path: SECRET_STAGING_PATH,
  });
}

class FaultingMulterStorage implements multer.StorageEngine {
  constructor(private readonly mode: "write_failure" | "cleanup_failure") {}

  _handleFile(
    _request: Express.Request,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): void {
    if (this.mode === "write_failure") {
      file.stream.resume();
      callback(filesystemError("ENOSPC", "write"));
      return;
    }

    let size = 0;
    file.stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
    });
    file.stream.on("end", () => {
      callback(null, {
        destination: "not-logged",
        filename: "server-generated-test-id",
        path: SECRET_STAGING_PATH,
        size,
      });
    });
  }

  _removeFile(
    _request: Express.Request,
    _file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void {
    callback(filesystemError("EPERM", "unlink"));
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createHarness(
  uploadOptions: DocumentUploadMiddlewareOptions = {},
  logger?: Logger,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "researchweave-upload-api-"));
  temporaryRoots.push(root);
  const storage = new ObservedDocumentStorage(new LocalFilesystemDocumentStorage(root));
  return {
    ...createTestApp(undefined, undefined, undefined, storage, uploadOptions, logger),
    root,
    storage,
  };
}

async function register(
  agent: ReturnType<typeof request.agent>,
  email: string,
  displayName = "Document User",
) {
  const response = await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ email, displayName, password: "secure-password" })
    .expect(201);
  return authResponseSchema.parse(response.body).user;
}

async function createSpace(agent: ReturnType<typeof request.agent>, name: string) {
  const response = await agent
    .post("/api/v1/spaces")
    .set("Origin", origin)
    .send({ name })
    .expect(201);
  return researchSpaceResponseSchema.parse(response.body).space;
}

function upload(
  agent: ReturnType<typeof request.agent>,
  spaceId: string,
  filename: string,
  bytes: string | Buffer,
) {
  return agent
    .post(`/api/v1/spaces/${spaceId}/documents`)
    .set("Origin", origin)
    .attach("file", typeof bytes === "string" ? Buffer.from(bytes) : bytes, filename);
}

async function countStoredSourceFiles(root: string): Promise<number> {
  async function walk(directory: string): Promise<number> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const counts = await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? walk(path.join(directory, entry.name)) : Promise.resolve(1),
      ),
    );
    return counts.reduce((total, count) => total + count, 0);
  }
  return walk(path.join(root, "spaces"));
}

describe("document upload API", () => {
  it("allows owners and members and creates truthful queued records", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const memberAgent = request.agent(harness.app);
    const owner = await register(ownerAgent, "doc-owner@example.com", "Document Owner");
    const member = await register(memberAgent, "doc-member@example.com", "Document Member");
    const space = await createSpace(ownerAgent, "Upload Space");
    harness.spaceRepository.addMember(space.id, member.id);

    const ownerUpload = documentUploadResponseSchema.parse(
      (await upload(ownerAgent, space.id, "paper.PDF", "%PDF-owner").expect(201)).body,
    );
    const memberUpload = documentUploadResponseSchema.parse(
      (await upload(memberAgent, space.id, "notes.TXT", "member notes").expect(201)).body,
    );

    expect(ownerUpload).toMatchObject({
      created: true,
      document: {
        spaceId: space.id,
        uploadedByUserId: owner.id,
        mediaType: "pdf",
        status: "queued",
        stage: null,
        attemptCount: 0,
        chunkCount: 0,
      },
    });
    expect(memberUpload.document).toMatchObject({
      uploadedByUserId: member.id,
      mediaType: "text",
    });
    expect(JSON.stringify(ownerUpload)).not.toContain("storageKey");
    expect(JSON.stringify(ownerUpload)).not.toContain("sourceSha256");
  });

  it("rejects a non-member before invoking multipart staging", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const outsiderAgent = request.agent(harness.app);
    await register(ownerAgent, "preauth-owner@example.com");
    await register(outsiderAgent, "preauth-outsider@example.com");
    const space = await createSpace(ownerAgent, "Private Uploads");

    const response = await upload(outsiderAgent, space.id, "private.txt", "private").expect(404);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("space_not_found");
    expect(harness.storage.prepareCalls).toBe(0);
    expect(await countStoredSourceFiles(harness.root)).toBe(0);
  });

  it("maps missing, multiple, extra-field, and oversized multipart failures", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "limits-owner@example.com");
    const space = await createSpace(ownerAgent, "Limits Space");
    const endpoint = `/api/v1/spaces/${space.id}/documents`;

    const missing = await ownerAgent.post(endpoint).set("Origin", origin).expect(400);
    expect(errorEnvelopeSchema.parse(missing.body).error.code).toBe("document_file_required");

    const multiple = await ownerAgent
      .post(endpoint)
      .set("Origin", origin)
      .attach("file", Buffer.from("first"), "first.txt")
      .attach("file", Buffer.from("second"), "second.txt")
      .expect(400);
    expect(errorEnvelopeSchema.parse(multiple.body).error.code).toBe("document_invalid_file");

    const extraField = await ownerAgent
      .post(endpoint)
      .set("Origin", origin)
      .field("title", "not allowed")
      .attach("file", Buffer.from("content"), "notes.txt")
      .expect(400);
    expect(errorEnvelopeSchema.parse(extraField.body).error.code).toBe("document_invalid_file");

    const oversized = await upload(
      ownerAgent,
      space.id,
      "oversized.txt",
      Buffer.alloc(MAX_DOCUMENT_FILE_BYTES + 1, 0x61),
    ).expect(413);
    expect(errorEnvelopeSchema.parse(oversized.body).error.code).toBe("document_too_large");
    expect(harness.documentRepository.documents.size).toBe(0);
  });

  it.each([
    ["archive.zip", Buffer.from("zip"), 415, "document_unsupported_type"],
    ["paper.pdf", Buffer.from("not-pdf"), 400, "document_invalid_file"],
    ["invalid.txt", Buffer.from([0xc3, 0x28]), 400, "document_invalid_file"],
    ["invalid.md", Buffer.from([0xc3, 0x28]), 400, "document_invalid_file"],
    ["invalid.markdown", Buffer.from([0xc3, 0x28]), 400, "document_invalid_file"],
  ] as const)("rejects invalid source %s with a stable error", async (filename, bytes, status, code) => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, `invalid-${filename.replace(".", "-")}@example.com`);
    const space = await createSpace(ownerAgent, `Invalid ${filename}`);
    const response = await upload(ownerAgent, space.id, filename, bytes).expect(status);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(code);
    expect(harness.documentRepository.documents.size).toBe(0);
  });

  it("deduplicates by Space and original bytes without overwriting first-upload attribution", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const memberAgent = request.agent(harness.app);
    const owner = await register(ownerAgent, "dedupe-owner@example.com");
    const member = await register(memberAgent, "dedupe-member@example.com");
    const space = await createSpace(ownerAgent, "Dedupe Space");
    harness.spaceRepository.addMember(space.id, member.id);

    const first = documentUploadResponseSchema.parse(
      (await upload(ownerAgent, space.id, "original.txt", "same bytes").expect(201)).body,
    );
    const repeated = documentUploadResponseSchema.parse(
      (await upload(memberAgent, space.id, "renamed.md", "same bytes").expect(200)).body,
    );

    expect(repeated.created).toBe(false);
    expect(repeated.document).toEqual(first.document);
    expect(repeated.document.uploadedByUserId).toBe(owner.id);
    expect(repeated.document.originalFilename).toBe("original.txt");
    expect(repeated.document.createdAt).toBe(first.document.createdAt);
    expect(harness.documentRepository.documents.size).toBe(1);
    expect(await countStoredSourceFiles(harness.root)).toBe(1);
    expect(harness.storage.deletedKeys).toHaveLength(1);
  });

  it("allows the same bytes in different Spaces and different bytes under one filename", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "identity-owner@example.com");
    const firstSpace = await createSpace(ownerAgent, "Identity One");
    const secondSpace = await createSpace(ownerAgent, "Identity Two");

    await upload(ownerAgent, firstSpace.id, "notes.txt", "same bytes").expect(201);
    await upload(ownerAgent, secondSpace.id, "renamed.md", "same bytes").expect(201);
    await upload(ownerAgent, firstSpace.id, "notes.txt", "different bytes").expect(201);
    expect(harness.documentRepository.documents.size).toBe(3);
  });
});

describe("document list, detail, and delete API", () => {
  it("lists with a stable cursor and returns member-authorized detail", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const memberAgent = request.agent(harness.app);
    await register(ownerAgent, "list-owner@example.com");
    const member = await register(memberAgent, "list-member@example.com");
    const space = await createSpace(ownerAgent, "List Space");
    harness.spaceRepository.addMember(space.id, member.id);

    const uploadedDocuments = [];
    for (const [filename, content] of [
      ["one.txt", "one"],
      ["two.txt", "two"],
      ["three.txt", "three"],
    ]) {
      uploadedDocuments.push(
        documentUploadResponseSchema.parse(
          (await upload(ownerAgent, space.id, filename, content).expect(201)).body,
        ).document,
      );
    }

    const expectedOrder = [...uploadedDocuments]
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id),
      )
      .map((document) => document.id);
    const ownerList = documentListResponseSchema.parse(
      (await ownerAgent.get(`/api/v1/spaces/${space.id}/documents`).expect(200)).body,
    );
    expect(ownerList.documents.map((document) => document.id)).toEqual(expectedOrder);

    const firstPage = documentListResponseSchema.parse(
      (await memberAgent.get(`/api/v1/spaces/${space.id}/documents?limit=2`).expect(200)).body,
    );
    expect(firstPage.documents).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = documentListResponseSchema.parse(
      (
        await memberAgent
          .get(
            `/api/v1/spaces/${space.id}/documents?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
          )
          .expect(200)
      ).body,
    );
    expect(secondPage.documents).toHaveLength(1);
    expect(new Set([...firstPage.documents, ...secondPage.documents].map((item) => item.id)).size).toBe(
      3,
    );

    const memberDetail = documentResponseSchema.parse(
      (
        await memberAgent
          .get(`/api/v1/spaces/${space.id}/documents/${firstPage.documents[0]?.id}`)
          .expect(200)
      ).body,
    );
    const ownerDetail = documentResponseSchema.parse(
      (
        await ownerAgent
          .get(`/api/v1/spaces/${space.id}/documents/${firstPage.documents[0]?.id}`)
          .expect(200)
      ).body,
    );
    expect(memberDetail.document.id).toBe(firstPage.documents[0]?.id);
    expect(ownerDetail).toEqual(memberDetail);
  });

  it("strictly rejects malformed and non-canonical document cursors", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "cursor-owner@example.com");
    const space = await createSpace(ownerAgent, "Cursor Space");
    await upload(ownerAgent, space.id, "one.txt", "one").expect(201);
    await upload(ownerAgent, space.id, "two.txt", "two").expect(201);

    const firstPage = documentListResponseSchema.parse(
      (await ownerAgent.get(`/api/v1/spaces/${space.id}/documents?limit=1`).expect(200)).body,
    );
    const validCursor = firstPage.nextCursor;
    if (!validCursor) throw new Error("Expected a document cursor.");
    await ownerAgent
      .get(`/api/v1/spaces/${space.id}/documents`)
      .query({ limit: 1, cursor: validCursor })
      .expect(200);

    const cursorDocument = firstPage.documents[0];
    if (!cursorDocument) throw new Error("Expected a cursor document.");
    const encodePayload = (payload: unknown) =>
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const malformedCursors = [
      ["appended illegal characters", `${validCursor}!!!!`],
      ["plus character", `${validCursor}+`],
      ["slash character", `${validCursor}/`],
      ["padding character", `${validCursor}=`],
      ["whitespace", `${validCursor}\n`],
      ["impossible unpadded length", "A"],
      ["malformed JSON", Buffer.from("{", "utf8").toString("base64url")],
      [
        "extra payload field",
        encodePayload({
          createdAt: cursorDocument.createdAt,
          id: cursorDocument.id,
          extra: "not allowed",
        }),
      ],
      ["invalid timestamp", encodePayload({ createdAt: "not-a-date", id: cursorDocument.id })],
      [
        "invalid UUID",
        encodePayload({ createdAt: cursorDocument.createdAt, id: "not-a-document-id" }),
      ],
    ] as const;

    for (const [label, cursor] of malformedCursors) {
      const response = await ownerAgent
        .get(`/api/v1/spaces/${space.id}/documents`)
        .query({ cursor })
        .expect(400);
      expect(errorEnvelopeSchema.parse(response.body).error.code, label).toBe(
        "invalid_document_cursor",
      );
    }
  });

  it("hides Space and Document existence from non-members and checks path Space ownership", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const outsiderAgent = request.agent(harness.app);
    await register(ownerAgent, "visibility-owner@example.com");
    await register(outsiderAgent, "visibility-outsider@example.com");
    const firstSpace = await createSpace(ownerAgent, "Visibility One");
    const secondSpace = await createSpace(ownerAgent, "Visibility Two");
    const uploaded = documentUploadResponseSchema.parse(
      (await upload(ownerAgent, secondSpace.id, "private.txt", "private").expect(201)).body,
    );

    for (const response of [
      await outsiderAgent.get(`/api/v1/spaces/${secondSpace.id}/documents`).expect(404),
      await outsiderAgent
        .get(`/api/v1/spaces/${secondSpace.id}/documents/${uploaded.document.id}`)
        .expect(404),
    ]) {
      expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("space_not_found");
    }
    const wrongSpace = await ownerAgent
      .get(`/api/v1/spaces/${firstSpace.id}/documents/${uploaded.document.id}`)
      .expect(404);
    expect(errorEnvelopeSchema.parse(wrongSpace.body).error.code).toBe("document_not_found");
  });

  it("allows owner or current uploader deletion and forbids another ordinary member", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const uploaderAgent = request.agent(harness.app);
    const otherAgent = request.agent(harness.app);
    await register(ownerAgent, "delete-owner@example.com");
    const uploader = await register(uploaderAgent, "delete-uploader@example.com");
    const other = await register(otherAgent, "delete-other@example.com");
    const space = await createSpace(ownerAgent, "Delete Space");
    harness.spaceRepository.addMember(space.id, uploader.id);
    harness.spaceRepository.addMember(space.id, other.id);

    const memberDocument = documentUploadResponseSchema.parse(
      (await upload(uploaderAgent, space.id, "member.txt", "member file").expect(201)).body,
    ).document;
    const forbidden = await otherAgent
      .delete(`/api/v1/spaces/${space.id}/documents/${memberDocument.id}`)
      .set("Origin", origin)
      .expect(403);
    expect(errorEnvelopeSchema.parse(forbidden.body).error.code).toBe(
      "document_delete_forbidden",
    );
    await uploaderAgent
      .delete(`/api/v1/spaces/${space.id}/documents/${memberDocument.id}`)
      .set("Origin", origin)
      .expect(204);

    const ownerDocument = documentUploadResponseSchema.parse(
      (await upload(uploaderAgent, space.id, "owner-delete.txt", "owner delete").expect(201)).body,
    ).document;
    await ownerAgent
      .delete(`/api/v1/spaces/${space.id}/documents/${ownerDocument.id}`)
      .set("Origin", origin)
      .expect(204);
    expect(harness.documentRepository.documents.size).toBe(0);
  });

  it("does not let a former uploader bypass current membership", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const uploaderAgent = request.agent(harness.app);
    await register(ownerAgent, "former-owner@example.com");
    const uploader = await register(uploaderAgent, "former-uploader@example.com");
    const space = await createSpace(ownerAgent, "Former Uploader Space");
    harness.spaceRepository.addMember(space.id, uploader.id);
    const document = documentUploadResponseSchema.parse(
      (await upload(uploaderAgent, space.id, "former.txt", "former").expect(201)).body,
    ).document;
    harness.spaceRepository.memberships.delete(`${space.id}:${uploader.id}`);

    const response = await uploaderAgent
      .delete(`/api/v1/spaces/${space.id}/documents/${document.id}`)
      .set("Origin", origin)
      .expect(404);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("space_not_found");
    expect(harness.documentRepository.documents.has(document.id)).toBe(true);
  });

  it("allows only the owner to delete when uploader attribution is null", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    const memberAgent = request.agent(harness.app);
    await register(ownerAgent, "null-owner@example.com");
    const member = await register(memberAgent, "null-member@example.com");
    const space = await createSpace(ownerAgent, "Null Attribution Space");
    harness.spaceRepository.addMember(space.id, member.id);
    const document = documentUploadResponseSchema.parse(
      (await upload(ownerAgent, space.id, "null.txt", "null attribution").expect(201)).body,
    ).document;
    const record = harness.documentRepository.documents.get(document.id);
    if (!record) throw new Error("Expected document record.");
    harness.documentRepository.documents.set(document.id, { ...record, uploadedByUserId: null });

    await memberAgent
      .delete(`/api/v1/spaces/${space.id}/documents/${document.id}`)
      .set("Origin", origin)
      .expect(403);
    await ownerAgent
      .delete(`/api/v1/spaces/${space.id}/documents/${document.id}`)
      .set("Origin", origin)
      .expect(204);
  });

  it("returns document_not_found for an unknown Document", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "unknown-owner@example.com");
    const space = await createSpace(ownerAgent, "Unknown Document Space");
    const response = await ownerAgent
      .delete(
        `/api/v1/spaces/${space.id}/documents/10000000-0000-4000-8000-000000000099`,
      )
      .set("Origin", origin)
      .expect(404);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("document_not_found");
  });
});

describe("document upload and delete failure consistency", () => {
  it("maps a Multer staging write failure to a stable storage error", async () => {
    const harness = await createHarness({
      storageEngine: new FaultingMulterStorage("write_failure"),
    });
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "staging-write-owner@example.com");
    const space = await createSpace(ownerAgent, "Staging Write Failure");

    const response = await upload(ownerAgent, space.id, "notes.txt", "notes").expect(503);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(
      "document_storage_unavailable",
    );
    expect(JSON.stringify(response.body)).not.toContain("ENOSPC");
    expect(JSON.stringify(response.body)).not.toContain(SECRET_STAGING_PATH);
  });

  it("logs Multer cleanup failures safely without replacing the primary error", async () => {
    const logLines: string[] = [];
    const logger = pino(
      { level: "warn" },
      new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          logLines.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
          callback();
        },
      }),
    );
    const harness = await createHarness(
      { storageEngine: new FaultingMulterStorage("cleanup_failure") },
      logger,
    );
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "staging-cleanup-owner@example.com");
    const space = await createSpace(ownerAgent, "Staging Cleanup Failure");
    const endpoint = `/api/v1/spaces/${space.id}/documents`;

    const response = await ownerAgent
      .post(endpoint)
      .set("Origin", origin)
      .attach("file", Buffer.from("first"), "first.txt")
      .attach("file", Buffer.from("second"), "second.txt")
      .expect(400);

    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("document_invalid_file");
    const parsedLogs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const cleanupLogs = parsedLogs.filter(
      (entry) => entry.msg === "document upload staging cleanup failed",
    );
    expect(cleanupLogs).toHaveLength(1);
    const cleanupLog = cleanupLogs[0];
    expect(cleanupLog).toMatchObject({
      reason: "multipart_cleanup_failure",
      cleanupErrorCount: 1,
      cleanupErrorCodes: ["EPERM"],
      msg: "document upload staging cleanup failed",
    });
    expect(JSON.stringify(cleanupLog)).not.toContain(SECRET_STAGING_PATH);
    expect(JSON.stringify(cleanupLog)).not.toContain("simulated unlink failure");
    expect(JSON.stringify(response.body)).not.toContain("EPERM");
    expect(JSON.stringify(response.body)).not.toContain(SECRET_STAGING_PATH);
    expect(harness.storage.cleanedStagedPaths).toEqual([]);
    expect(
      parsedLogs.filter((entry) => entry.msg === "document staging cleanup failed"),
    ).toHaveLength(0);
  });

  it("maps staging unavailability and promotion failure without creating a Document", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "storage-owner@example.com");
    const space = await createSpace(ownerAgent, "Storage Failure Space");

    harness.storage.failPrepare = true;
    const unavailable = await upload(ownerAgent, space.id, "notes.txt", "notes").expect(503);
    expect(errorEnvelopeSchema.parse(unavailable.body).error.code).toBe(
      "document_storage_unavailable",
    );

    harness.storage.failPrepare = false;
    harness.storage.failPromote = true;
    const failed = await upload(ownerAgent, space.id, "notes.txt", "notes").expect(500);
    expect(errorEnvelopeSchema.parse(failed.body).error.code).toBe("document_storage_failure");
    expect(harness.documentRepository.documents.size).toBe(0);
  });

  it("cleans the durable candidate after DB failure", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "db-failure-owner@example.com");
    const space = await createSpace(ownerAgent, "DB Failure Space");
    harness.documentRepository.failNextCreate = true;

    await upload(ownerAgent, space.id, "notes.txt", "durable before db").expect(500);
    expect(harness.documentRepository.documents.size).toBe(0);
    expect(harness.storage.deletedKeys).toHaveLength(1);
    expect(await countStoredSourceFiles(harness.root)).toBe(0);
  });

  it("rechecks membership transactionally and cleans a revoked upload candidate", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "revoked-owner@example.com");
    const space = await createSpace(ownerAgent, "Revoked During Upload");
    const ownerId = space.ownerId;
    harness.documentRepository.beforeNextCreate = () => {
      harness.spaceRepository.memberships.delete(`${space.id}:${ownerId}`);
    };

    const response = await upload(ownerAgent, space.id, "notes.txt", "revoked").expect(404);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("space_not_found");
    expect(harness.documentRepository.documents.size).toBe(0);
    expect(harness.storage.deletedKeys).toHaveLength(1);
    expect(await countStoredSourceFiles(harness.root)).toBe(0);
  });

  it("keeps the original validation error when staged cleanup also fails", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "cleanup-owner@example.com");
    const space = await createSpace(ownerAgent, "Cleanup Failure Space");
    harness.storage.failCleanupStaged = true;

    const response = await upload(ownerAgent, space.id, "archive.zip", "bad").expect(415);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("document_unsupported_type");
    expect(harness.storage.cleanedStagedPaths).toHaveLength(1);
    expect(harness.documentRepository.documents.size).toBe(0);
  });

  it("commits DB deletion even when filesystem cleanup fails", async () => {
    const harness = await createHarness();
    const ownerAgent = request.agent(harness.app);
    await register(ownerAgent, "delete-cleanup-owner@example.com");
    const space = await createSpace(ownerAgent, "Delete Cleanup Space");
    const document = documentUploadResponseSchema.parse(
      (await upload(ownerAgent, space.id, "delete.txt", "delete cleanup").expect(201)).body,
    ).document;
    harness.storage.failDelete = true;

    await ownerAgent
      .delete(`/api/v1/spaces/${space.id}/documents/${document.id}`)
      .set("Origin", origin)
      .expect(204);
    expect(harness.documentRepository.documents.has(document.id)).toBe(false);
    expect(harness.storage.deletedKeys).toHaveLength(1);
  });
});
