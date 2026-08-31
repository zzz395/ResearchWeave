import type { SpaceRole } from "../../shared/contracts/spaces";
import type {
  ChatMessageRecord,
  ConnectionRecord,
  DocumentRecord,
  PaperRecord,
  PaperSummaryRecord,
  ResearchSpaceRecord,
  SavedPaperRecord,
  SessionRecord,
  SpaceMemberRecord,
  UserRecord,
} from "../../server/db/schema";
import type {
  AuthRepository,
  NewSessionRecord,
  NewUserRecord,
} from "../../server/modules/auth/repository";
import type {
  AccessibleSpaceRecord,
  NewSpaceRecord,
  SpaceRepository,
} from "../../server/modules/spaces/repository";
import {
  DuplicateConnectionRepositoryError,
  type ConnectionRepository,
  type ConnectionWithOtherUser,
  type NewConnectionRecord,
} from "../../server/modules/connections/repository";
import type {
  MemberRepository,
  MemberWithUser,
} from "../../server/modules/members/repository";
import type {
  ChatCursorRecord,
  ChatMessageWithSender,
  ChatRepository,
  NewChatMessageRecord,
} from "../../server/modules/chat/repository";
import {
  shouldRefreshPaper,
  type NewPaperRecord,
  type PaperRepository,
} from "../../server/modules/research/paper-repository";
import type {
  RemoveSavedPaperResult,
  SavedPaperListResult,
  SavedPaperRepository,
  SavePaperResult,
} from "../../server/modules/research/saved-paper-repository";
import type {
  PaperSummaryRepository,
  PersistSummaryResult,
} from "../../server/modules/research/summary-repository";
import type {
  CreateDocumentResult,
  ActivateDocumentIndexInput,
  ActivateDocumentIndexResult,
  DeleteDocumentResult,
  DocumentCursorRecord,
  DocumentDetailResult,
  DocumentListResult,
  DocumentRepository,
  DocumentIndexChunk,
  DocumentIndexingClaim,
  NewDocumentRecord,
  QueueDocumentReindexResult,
} from "../../server/modules/documents/repository";
import type { DocumentStorage } from "../../server/integrations/document-storage/storage";
import type {
  SemanticRetrievalRepository,
  SemanticRetrievalRepositoryInput,
  SemanticRetrievalRepositoryResult,
} from "../../server/modules/retrieval/repository";
import {
  createSummarySourceFingerprint,
  toPaperSummarySource,
} from "../../server/modules/research/summary-fingerprint";

export class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, UserRecord>();
  readonly sessions = new Map<string, SessionRecord>();

  findUserByEmail(email: string) {
    return Promise.resolve([...this.users.values()].find((user) => user.email === email) ?? null);
  }

  createUser(user: NewUserRecord) {
    this.users.set(user.id, user);
    return Promise.resolve(user);
  }

  createSession(session: NewSessionRecord) {
    this.sessions.set(session.tokenHash, session);
    return Promise.resolve();
  }

  findUserBySessionHash(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return Promise.resolve(null);
    return Promise.resolve(this.users.get(session.userId) ?? null);
  }

  deleteSessionByHash(tokenHash: string) {
    this.sessions.delete(tokenHash);
    return Promise.resolve();
  }
}

export class InMemorySpaceRepository implements SpaceRepository {
  readonly spaces = new Map<string, ResearchSpaceRecord>();
  readonly memberships = new Map<string, SpaceRole>();

  private membershipKey(spaceId: string, userId: string) {
    return `${spaceId}:${userId}`;
  }

  addMember(spaceId: string, userId: string, role: SpaceRole = "member") {
    this.memberships.set(this.membershipKey(spaceId, userId), role);
  }

  hasMembership(spaceId: string, userId: string) {
    return this.memberships.has(this.membershipKey(spaceId, userId));
  }

  listForUser(userId: string) {
    const spaces = [...this.spaces.values()]
      .flatMap((space) => {
        const role = this.memberships.get(this.membershipKey(space.id, userId));
        return role ? [{ ...space, role } satisfies AccessibleSpaceRecord] : [];
      })
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    return Promise.resolve(spaces);
  }

  findForMember(spaceId: string, userId: string) {
    const space = this.spaces.get(spaceId);
    const role = this.memberships.get(this.membershipKey(spaceId, userId));
    return Promise.resolve(space && role ? { ...space, role } : null);
  }

  createForOwner(space: NewSpaceRecord) {
    this.spaces.set(space.id, space);
    this.addMember(space.id, space.ownerId, "owner");
    return Promise.resolve({ ...space, role: "owner" as const });
  }

  updateForOwner(
    spaceId: string,
    ownerId: string,
    changes: Partial<Pick<NewSpaceRecord, "name" | "description" | "updatedAt">>,
  ) {
    const space = this.spaces.get(spaceId);
    if (!space || space.ownerId !== ownerId) return Promise.resolve(null);
    const updated = { ...space, ...changes };
    this.spaces.set(spaceId, updated);
    return Promise.resolve(updated);
  }

  deleteForOwner(spaceId: string, ownerId: string) {
    const space = this.spaces.get(spaceId);
    if (!space || space.ownerId !== ownerId) return Promise.resolve(false);
    this.spaces.delete(spaceId);
    for (const key of this.memberships.keys()) {
      if (key.startsWith(`${spaceId}:`)) this.memberships.delete(key);
    }
    return Promise.resolve(true);
  }
}

export class InMemoryConnectionRepository implements ConnectionRepository {
  readonly connections = new Map<string, ConnectionRecord>();

  constructor(private readonly auth: InMemoryAuthRepository) {}

  findUserByEmail(email: string) {
    return this.auth.findUserByEmail(email);
  }

  findUserById(userId: string) {
    return Promise.resolve(this.auth.users.get(userId) ?? null);
  }

  listForUser(userId: string) {
    const records = [...this.connections.values()]
      .filter((record) => record.userLowId === userId || record.userHighId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .flatMap((record): ConnectionWithOtherUser[] => {
        const otherId = record.userLowId === userId ? record.userHighId : record.userLowId;
        const otherUser = this.auth.users.get(otherId);
        return otherUser ? [{ ...record, otherUser }] : [];
      });
    return Promise.resolve(records);
  }

  findForParticipant(connectionId: string, userId: string) {
    const record = this.connections.get(connectionId);
    return Promise.resolve(
      record && (record.userLowId === userId || record.userHighId === userId) ? record : null,
    );
  }

  createRequest(connection: NewConnectionRecord) {
    const duplicate = [...this.connections.values()].some(
      (record) =>
        record.userLowId === connection.userLowId && record.userHighId === connection.userHighId,
    );
    if (duplicate) return Promise.reject(new DuplicateConnectionRepositoryError());
    this.connections.set(connection.id, connection);
    return Promise.resolve(connection);
  }

  acceptPending(connectionId: string, recipientId: string, respondedAt: Date) {
    const record = this.connections.get(connectionId);
    if (
      !record ||
      record.status !== "pending" ||
      record.requestedByUserId === recipientId ||
      (record.userLowId !== recipientId && record.userHighId !== recipientId)
    ) {
      return Promise.resolve(false);
    }
    this.connections.set(connectionId, { ...record, status: "accepted", respondedAt });
    return Promise.resolve(true);
  }

  deletePending(connectionId: string, actorId: string, requestedByActor: boolean) {
    const record = this.connections.get(connectionId);
    const isParticipant = record?.userLowId === actorId || record?.userHighId === actorId;
    const isRequester = record?.requestedByUserId === actorId;
    if (
      !record ||
      record.status !== "pending" ||
      !isParticipant ||
      isRequester !== requestedByActor
    ) {
      return Promise.resolve(false);
    }
    this.connections.delete(connectionId);
    return Promise.resolve(true);
  }

  deleteAccepted(connectionId: string, actorId: string) {
    const record = this.connections.get(connectionId);
    if (
      !record ||
      record.status !== "accepted" ||
      (record.userLowId !== actorId && record.userHighId !== actorId)
    ) {
      return Promise.resolve(false);
    }
    this.connections.delete(connectionId);
    return Promise.resolve(true);
  }

  areAccepted(userAId: string, userBId: string) {
    const [userLowId, userHighId] = [userAId, userBId].sort();
    return Promise.resolve(
      [...this.connections.values()].some(
        (record) =>
          record.userLowId === userLowId &&
          record.userHighId === userHighId &&
          record.status === "accepted",
      ),
    );
  }
}

export class InMemoryMemberRepository implements MemberRepository {
  private readonly joinedAt = new Map<string, Date>();

  constructor(
    private readonly auth: InMemoryAuthRepository,
    private readonly spaces: InMemorySpaceRepository,
  ) {}

  private key(spaceId: string, userId: string) {
    return `${spaceId}:${userId}`;
  }

  private toRecord(spaceId: string, userId: string, role: SpaceRole): MemberWithUser | null {
    const user = this.auth.users.get(userId);
    const space = this.spaces.spaces.get(spaceId);
    if (!user || !space) return null;
    const membership: SpaceMemberRecord = {
      spaceId,
      userId,
      role,
      joinedAt: this.joinedAt.get(this.key(spaceId, userId)) ?? space.createdAt,
    };
    return { ...membership, user };
  }

  list(spaceId: string) {
    const prefix = `${spaceId}:`;
    const members = [...this.spaces.memberships.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([key, role]) => {
        const userId = key.slice(prefix.length);
        const member = this.toRecord(spaceId, userId, role);
        return member ? [member] : [];
      })
      .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime());
    return Promise.resolve(members);
  }

  find(spaceId: string, userId: string) {
    const role = this.spaces.memberships.get(this.key(spaceId, userId));
    return Promise.resolve(role ? this.toRecord(spaceId, userId, role) : null);
  }

  add(spaceId: string, userId: string, joinedAt: Date) {
    if (this.spaces.hasMembership(spaceId, userId)) return Promise.resolve(null);
    this.spaces.addMember(spaceId, userId);
    this.joinedAt.set(this.key(spaceId, userId), joinedAt);
    return this.find(spaceId, userId);
  }

  removeOrdinaryMember(spaceId: string, userId: string) {
    const key = this.key(spaceId, userId);
    if (this.spaces.memberships.get(key) !== "member") return Promise.resolve(false);
    this.spaces.memberships.delete(key);
    this.joinedAt.delete(key);
    return Promise.resolve(true);
  }
}

export class InMemoryChatRepository implements ChatRepository {
  readonly messages: ChatMessageRecord[] = [];
  failNextInsert = false;

  constructor(private readonly auth: InMemoryAuthRepository) {}

  insert(message: NewChatMessageRecord) {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      return Promise.reject(new Error("simulated persistence failure"));
    }
    const sender = this.auth.users.get(message.senderUserId);
    if (!sender) return Promise.reject(new Error("sender missing"));
    this.messages.push(message);
    return Promise.resolve({ ...message, sender });
  }

  listBefore(spaceId: string, cursor: ChatCursorRecord | null, limit: number) {
    const records = this.messages
      .filter((message) => {
        if (message.spaceId !== spaceId) return false;
        if (!cursor) return true;
        return (
          message.createdAt < cursor.createdAt ||
          (message.createdAt.getTime() === cursor.createdAt.getTime() && message.id < cursor.id)
        );
      })
      .sort((left, right) => {
        const time = right.createdAt.getTime() - left.createdAt.getTime();
        return time || right.id.localeCompare(left.id);
      })
      .slice(0, limit)
      .flatMap((message): ChatMessageWithSender[] => {
        const sender = this.auth.users.get(message.senderUserId);
        return sender ? [{ ...message, sender }] : [];
      });
    return Promise.resolve(records);
  }
}

export class InMemoryPaperRepository implements PaperRepository {
  readonly papers = new Map<string, PaperRecord>();
  readonly canonicalIds = new Map<string, string>();
  failNextUpsert = false;

  upsertMany(records: NewPaperRecord[]) {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      return Promise.reject(new Error("simulated paper persistence failure"));
    }

    const nextPapers = new Map(this.papers);
    const nextCanonicalIds = new Map(this.canonicalIds);
    const persisted = records.map((incoming) => {
      const existingId = nextCanonicalIds.get(incoming.canonicalArxivId);
      const existing = existingId ? nextPapers.get(existingId) : undefined;
      if (!existing) {
        nextPapers.set(incoming.id, incoming);
        nextCanonicalIds.set(incoming.canonicalArxivId, incoming.id);
        return incoming;
      }
      if (!shouldRefreshPaper(incoming, existing)) return existing;
      const updated = { ...incoming, id: existing.id };
      nextPapers.set(existing.id, updated);
      return updated;
    });

    this.papers.clear();
    this.canonicalIds.clear();
    for (const [id, paper] of nextPapers) this.papers.set(id, paper);
    for (const [canonicalId, id] of nextCanonicalIds) this.canonicalIds.set(canonicalId, id);
    return Promise.resolve(persisted);
  }

  findById(paperId: string) {
    return Promise.resolve(this.papers.get(paperId) ?? null);
  }
}

export class InMemoryPaperSummaryRepository implements PaperSummaryRepository {
  readonly summaries = new Map<string, PaperSummaryRecord>();

  constructor(private readonly papers: InMemoryPaperRepository) {}

  findByPaperId(paperId: string) {
    return Promise.resolve(this.summaries.get(paperId) ?? null);
  }

  persistIfSourceCurrent(record: PaperSummaryRecord): Promise<PersistSummaryResult> {
    const paper = this.papers.papers.get(record.paperId);
    if (!paper) return Promise.resolve({ status: "paper_not_found" });
    const fingerprint = createSummarySourceFingerprint(toPaperSummarySource(paper));
    if (fingerprint !== record.sourceFingerprint) {
      return Promise.resolve({ status: "source_changed" });
    }
    this.summaries.set(record.paperId, record);
    return Promise.resolve({ status: "persisted", record });
  }
}

export class InMemorySavedPaperRepository implements SavedPaperRepository {
  readonly savedPapers = new Map<string, SavedPaperRecord>();

  constructor(
    private readonly papers: InMemoryPaperRepository,
    private readonly spaces: InMemorySpaceRepository,
  ) {}

  private key(spaceId: string, paperId: string) {
    return `${spaceId}:${paperId}`;
  }

  listForMember(spaceId: string, actorId: string): Promise<SavedPaperListResult> {
    if (!this.spaces.hasMembership(spaceId, actorId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    const records = [...this.savedPapers.values()]
      .filter((record) => record.spaceId === spaceId)
      .sort((left, right) => {
        const time = right.savedAt.getTime() - left.savedAt.getTime();
        return time || right.paperId.localeCompare(left.paperId);
      })
      .flatMap((record) => {
        const paper = this.papers.papers.get(record.paperId);
        return paper ? [{ ...record, paper }] : [];
      });
    return Promise.resolve({ status: "ok", records });
  }

  saveForMember({
    spaceId,
    paperId,
    actorId,
    savedAt,
  }: {
    spaceId: string;
    paperId: string;
    actorId: string;
    savedAt: Date;
  }): Promise<SavePaperResult> {
    if (!this.spaces.hasMembership(spaceId, actorId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    const paper = this.papers.papers.get(paperId);
    if (!paper) return Promise.resolve({ status: "paper_not_found" });
    const key = this.key(spaceId, paperId);
    const existing = this.savedPapers.get(key);
    if (existing) {
      return Promise.resolve({ status: "existing", record: { ...existing, paper } });
    }
    const created = { spaceId, paperId, savedByUserId: actorId, savedAt };
    this.savedPapers.set(key, created);
    return Promise.resolve({ status: "created", record: { ...created, paper } });
  }

  removeForMember(
    spaceId: string,
    paperId: string,
    actorId: string,
  ): Promise<RemoveSavedPaperResult> {
    const role = this.spaces.memberships.get(`${spaceId}:${actorId}`);
    if (!role) return Promise.resolve({ status: "space_not_found" });
    const key = this.key(spaceId, paperId);
    const savedPaper = this.savedPapers.get(key);
    if (!savedPaper) return Promise.resolve({ status: "saved_paper_not_found" });
    if (role !== "owner" && savedPaper.savedByUserId !== actorId) {
      return Promise.resolve({ status: "forbidden" });
    }
    this.savedPapers.delete(key);
    return Promise.resolve({ status: "removed" });
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, DocumentRecord>();
  readonly documentChunks = new Map<string, DocumentIndexChunk[]>();
  readonly claimedDocumentIds: string[] = [];
  readonly stageUpdates: Array<{ documentId: string; stage: DocumentRecord["stage"] }> = [];
  readonly activationEvents: string[] = [];
  failNextCreate = false;
  failNextActivationAt?: "after_delete" | "during_insert" | "before_document_update";
  beforeNextCreate?: () => void;
  beforeNextActivation?: () => void;
  beforeNextStageUpdate?: () => void;

  constructor(private readonly spaces: InMemorySpaceRepository) {}

  hasMembership(spaceId: string, actorId: string) {
    return Promise.resolve(this.spaces.hasMembership(spaceId, actorId));
  }

  createForMember(record: NewDocumentRecord, actorId: string): Promise<CreateDocumentResult> {
    this.beforeNextCreate?.();
    this.beforeNextCreate = undefined;
    if (!this.spaces.hasMembership(record.spaceId, actorId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    if (this.failNextCreate) {
      this.failNextCreate = false;
      return Promise.reject(new Error("simulated document persistence failure"));
    }
    const existing = [...this.documents.values()].find(
      (item) => item.spaceId === record.spaceId && item.sourceSha256 === record.sourceSha256,
    );
    if (existing) return Promise.resolve({ status: "existing", record: existing });
    this.documents.set(record.id, record);
    return Promise.resolve({ status: "created", record });
  }

  listForMember(
    spaceId: string,
    actorId: string,
    cursor: DocumentCursorRecord | null,
    limit: number,
  ): Promise<DocumentListResult> {
    if (!this.spaces.hasMembership(spaceId, actorId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    const records = [...this.documents.values()]
      .filter((record) => {
        if (record.spaceId !== spaceId) return false;
        if (!cursor) return true;
        return (
          record.createdAt < cursor.createdAt ||
          (record.createdAt.getTime() === cursor.createdAt.getTime() && record.id < cursor.id)
        );
      })
      .sort((left, right) => {
        const time = right.createdAt.getTime() - left.createdAt.getTime();
        return time || right.id.localeCompare(left.id);
      })
      .slice(0, limit);
    return Promise.resolve({ status: "ok", records });
  }

  findForMember(
    spaceId: string,
    documentId: string,
    actorId: string,
  ): Promise<DocumentDetailResult> {
    if (!this.spaces.hasMembership(spaceId, actorId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    const record = this.documents.get(documentId);
    return Promise.resolve(
      record?.spaceId === spaceId
        ? { status: "ok", record }
        : { status: "document_not_found" },
    );
  }

  deleteForMember(
    spaceId: string,
    documentId: string,
    actorId: string,
  ): Promise<DeleteDocumentResult> {
    const role = this.spaces.memberships.get(`${spaceId}:${actorId}`);
    if (!role) return Promise.resolve({ status: "space_not_found" });
    const record = this.documents.get(documentId);
    if (!record || record.spaceId !== spaceId) {
      return Promise.resolve({ status: "document_not_found" });
    }
    if (role !== "owner" && record.uploadedByUserId !== actorId) {
      return Promise.resolve({ status: "forbidden" });
    }
    this.documents.delete(documentId);
    this.documentChunks.delete(documentId);
    return Promise.resolve({ status: "removed", storageKey: record.storageKey });
  }

  queueReindexForMember(
    spaceId: string,
    documentId: string,
    actorId: string,
  ): Promise<QueueDocumentReindexResult> {
    const role = this.spaces.memberships.get(`${spaceId}:${actorId}`);
    if (!role) return Promise.resolve({ status: "space_not_found" });
    const record = this.documents.get(documentId);
    if (!record || record.spaceId !== spaceId) {
      return Promise.resolve({ status: "document_not_found" });
    }
    if (role !== "owner" && record.uploadedByUserId !== actorId) {
      return Promise.resolve({ status: "forbidden" });
    }
    if (record.status === "queued" || record.status === "processing") {
      return Promise.resolve({ status: "accepted", record });
    }
    const queued: DocumentRecord = {
      ...record,
      status: "queued",
      stage: null,
      errorCode: null,
      failedAt: null,
      updatedAt: new Date(),
    };
    this.documents.set(documentId, queued);
    return Promise.resolve({ status: "accepted", record: queued });
  }

  recoverProcessingDocuments(now: Date): Promise<number> {
    let recovered = 0;
    for (const [id, record] of this.documents) {
      if (record.status !== "processing") continue;
      this.documents.set(id, { ...record, status: "queued", stage: null, updatedAt: now });
      recovered += 1;
    }
    return Promise.resolve(recovered);
  }

  claimNextQueuedDocument(now: Date): Promise<DocumentIndexingClaim | null> {
    const record = [...this.documents.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort(
        (left, right) =>
          left.updatedAt.getTime() - right.updatedAt.getTime() || left.id.localeCompare(right.id),
      )[0];
    if (!record) return Promise.resolve(null);
    const attemptNumber = record.attemptCount + 1;
    this.documents.set(record.id, {
      ...record,
      status: "processing",
      stage: "extracting",
      attemptCount: attemptNumber,
      lastAttemptAt: now,
      errorCode: null,
      failedAt: null,
      updatedAt: now,
    });
    this.claimedDocumentIds.push(record.id);
    return Promise.resolve({
      documentId: record.id,
      mediaType: record.mediaType,
      storageKey: record.storageKey,
      sourceSha256: record.sourceSha256,
      attemptNumber,
    });
  }

  updateProcessingStage(
    documentId: string,
    attemptNumber: number,
    stage: DocumentRecord["stage"] & {},
    now: Date,
  ): Promise<boolean> {
    this.beforeNextStageUpdate?.();
    this.beforeNextStageUpdate = undefined;
    const record = this.documents.get(documentId);
    if (
      !record ||
      record.status !== "processing" ||
      record.attemptCount !== attemptNumber
    ) {
      return Promise.resolve(false);
    }
    this.documents.set(documentId, { ...record, stage, updatedAt: now });
    this.stageUpdates.push({ documentId, stage });
    return Promise.resolve(true);
  }

  markIndexingFailed(
    documentId: string,
    attemptNumber: number,
    stage: DocumentRecord["stage"] & {},
    errorCode: string,
    now: Date,
  ): Promise<boolean> {
    const record = this.documents.get(documentId);
    if (
      !record ||
      record.status !== "processing" ||
      record.attemptCount !== attemptNumber
    ) {
      return Promise.resolve(false);
    }
    this.documents.set(documentId, {
      ...record,
      status: "failed",
      stage,
      errorCode,
      failedAt: now,
      updatedAt: now,
    });
    return Promise.resolve(true);
  }

  activateDocumentIndex(
    input: ActivateDocumentIndexInput,
    now: Date,
  ): Promise<ActivateDocumentIndexResult> {
    this.beforeNextActivation?.();
    this.beforeNextActivation = undefined;
    this.activationEvents.length = 0;
    this.activationEvents.push("begin");
    const record = this.documents.get(input.documentId);
    if (
      !record ||
      record.status !== "processing" ||
      record.attemptCount !== input.attemptNumber
    ) {
      return Promise.resolve({ status: "stale" });
    }

    const failurePoint = this.failNextActivationAt;
    this.failNextActivationAt = undefined;
    const workingDocument: DocumentRecord = { ...record };
    const workingChunks = (this.documentChunks.get(input.documentId) ?? []).map((chunk) => ({
      ...chunk,
      embedding: [...chunk.embedding],
    }));
    workingChunks.length = 0;
    this.activationEvents.push("delete-old-chunks");
    if (failurePoint === "after_delete") {
      this.activationEvents.push("fail", "rollback");
      return Promise.reject(new Error("simulated document activation failure after delete"));
    }

    for (let offset = 0; offset < input.chunks.length; offset += 100) {
      const batch = input.chunks.slice(offset, offset + 100).map((chunk) => ({
        ...chunk,
        embedding: [...chunk.embedding],
      }));
      workingChunks.push(...batch);
      this.activationEvents.push("insert-new-batch");
      if (failurePoint === "during_insert") {
        this.activationEvents.push("fail", "rollback");
        return Promise.reject(new Error("simulated document activation failure during insert"));
      }
    }

    if (failurePoint === "before_document_update") {
      this.activationEvents.push("fail", "rollback");
      return Promise.reject(
        new Error("simulated document activation failure before document update"),
      );
    }

    Object.assign(workingDocument, {
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
    } satisfies Partial<DocumentRecord>);
    this.activationEvents.push("update-document", "commit");
    this.documentChunks.set(input.documentId, workingChunks);
    this.documents.set(input.documentId, workingDocument);
    return Promise.resolve({ status: "activated" });
  }
}

function cosineDistance(left: number[], right: number[]): number {
  if (left.length !== right.length) return Number.NaN;
  let dotProduct = 0;
  let leftMagnitudeSquared = 0;
  let rightMagnitudeSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    dotProduct += leftValue * rightValue;
    leftMagnitudeSquared += leftValue * leftValue;
    rightMagnitudeSquared += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitudeSquared) * Math.sqrt(rightMagnitudeSquared);
  return denominator === 0 ? Number.NaN : 1 - dotProduct / denominator;
}

export class InMemorySemanticRetrievalRepository implements SemanticRetrievalRepository {
  constructor(
    private readonly spaces: InMemorySpaceRepository,
    private readonly documents: InMemoryDocumentRepository,
  ) {}

  hasMembership(spaceId: string, actorId: string) {
    return Promise.resolve(this.spaces.hasMembership(spaceId, actorId));
  }

  searchForMember(
    input: SemanticRetrievalRepositoryInput,
  ): Promise<SemanticRetrievalRepositoryResult> {
    if (!this.spaces.hasMembership(input.spaceId, input.actorId)) {
      return Promise.resolve({ status: "space_not_found" });
    }
    const activeDocuments = [...this.documents.documents.values()].filter(
      (document) => document.spaceId === input.spaceId && document.indexedAt !== null,
    );
    if (activeDocuments.length === 0) {
      return Promise.resolve({ status: "knowledge_not_indexed" });
    }
    if (
      activeDocuments.some(
        (document) =>
          document.embeddingModel !== input.embeddingModel ||
          document.embeddingDimensions !== input.embeddingDimensions,
      )
    ) {
      return Promise.resolve({ status: "knowledge_embedding_incompatible" });
    }
    const records = activeDocuments
      .flatMap((document) =>
        (this.documents.documentChunks.get(document.id) ?? []).map((chunk) => ({
          documentId: document.id,
          originalFilename: document.originalFilename,
          ordinal: chunk.ordinal,
          content: chunk.content,
          contentHash: chunk.contentHash,
          pageNumber: chunk.pageNumber,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          cosineDistance: cosineDistance(chunk.embedding, input.embedding),
        })),
      )
      .filter((record) => Number.isFinite(record.cosineDistance))
      .sort(
        (left, right) =>
          left.cosineDistance - right.cosineDistance ||
          left.documentId.localeCompare(right.documentId) ||
          left.ordinal - right.ordinal,
      )
      .slice(0, input.limit);
    return Promise.resolve({ status: "ok", records });
  }
}

export class InMemoryDocumentStorage implements DocumentStorage {
  readonly sources = new Map<string, Uint8Array>();

  prepareStagingDirectory(): Promise<string> {
    return Promise.reject(new Error("Document upload storage was not configured for this test."));
  }

  readStaged(): Promise<Buffer> {
    return Promise.reject(new Error("Document upload storage was not configured for this test."));
  }

  readSource(storageKey: string): Promise<Uint8Array> {
    const bytes = this.sources.get(storageKey);
    return bytes
      ? Promise.resolve(bytes.slice())
      : Promise.reject(new Error("Document source is unavailable."));
  }

  promote(): Promise<void> {
    return Promise.reject(new Error("Document upload storage was not configured for this test."));
  }

  cleanupStaged(): Promise<void> {
    return Promise.resolve();
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }
}
