import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  varchar,
} from "drizzle-orm/pg-core";

export const spaceRole = pgEnum("space_role", ["owner", "member"]);
export const connectionStatus = pgEnum("connection_status", ["pending", "accepted"]);
export const documentMediaType = pgEnum("document_media_type", ["pdf", "text", "markdown"]);
export const documentStatus = pgEnum("document_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);
export const documentStage = pgEnum("document_stage", ["extracting", "chunking", "embedding"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    passwordHash: varchar("password_hash", { length: 60 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check("users_display_name_length", sql`char_length(${table.displayName}) between 2 and 80`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_index").on(table.userId),
    index("sessions_expires_at_index").on(table.expiresAt),
  ],
);

export const researchSpaces = pgTable(
  "research_spaces",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    description: text("description"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("research_spaces_owner_id_index").on(table.ownerId),
    check("research_spaces_name_length", sql`char_length(${table.name}) between 2 and 80`),
    check(
      "research_spaces_description_length",
      sql`${table.description} is null or char_length(${table.description}) <= 1000`,
    ),
  ],
);

export const spaceMembers = pgTable(
  "space_members",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => researchSpaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: spaceRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.userId], name: "space_members_pk" }),
    index("space_members_user_id_index").on(table.userId),
  ],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey(),
    userLowId: uuid("user_low_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHighId: uuid("user_high_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: connectionStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("connections_user_pair_unique").on(table.userLowId, table.userHighId),
    index("connections_user_low_id_index").on(table.userLowId),
    index("connections_user_high_id_index").on(table.userHighId),
    check("connections_canonical_pair", sql`${table.userLowId} < ${table.userHighId}`),
    check(
      "connections_requester_in_pair",
      sql`${table.requestedByUserId} = ${table.userLowId} or ${table.requestedByUserId} = ${table.userHighId}`,
    ),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => researchSpaces.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("chat_messages_space_cursor_index").on(table.spaceId, table.createdAt, table.id),
    index("chat_messages_sender_user_id_index").on(table.senderUserId),
    check("chat_messages_body_length", sql`char_length(${table.body}) between 1 and 4000`),
  ],
);

export const papers = pgTable(
  "papers",
  {
    id: uuid("id").primaryKey(),
    canonicalArxivId: text("canonical_arxiv_id").notNull(),
    versionedArxivId: text("versioned_arxiv_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    abstract: text("abstract").notNull(),
    authors: text("authors").array().notNull(),
    primaryCategory: text("primary_category").notNull(),
    categories: text("categories").array().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    comment: text("comment"),
    journalRef: text("journal_ref"),
    doi: text("doi"),
    absUrl: text("abs_url").notNull(),
    pdfUrl: text("pdf_url").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("papers_canonical_arxiv_id_unique").on(table.canonicalArxivId),
    check("papers_version_positive", sql`${table.version} >= 1`),
    check("papers_authors_nonempty", sql`cardinality(${table.authors}) >= 1`),
    check("papers_categories_nonempty", sql`cardinality(${table.categories}) >= 1`),
  ],
);

export const savedPapers = pgTable(
  "saved_papers",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => researchSpaces.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "restrict" }),
    savedByUserId: uuid("saved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    savedAt: timestamp("saved_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.paperId], name: "saved_papers_pk" }),
    index("saved_papers_space_saved_at_index").on(table.spaceId, table.savedAt),
    index("saved_papers_saved_by_user_id_index").on(table.savedByUserId),
  ],
);

export const paperSummaries = pgTable(
  "paper_summaries",
  {
    paperId: uuid("paper_id")
      .primaryKey()
      .references(() => papers.id, { onDelete: "cascade" }),
    overview: text("overview").notNull(),
    keyContributions: text("key_contributions").array().notNull(),
    methodHighlights: text("method_highlights").array().notNull(),
    findings: text("findings").array().notNull(),
    caveats: text("caveats").array().notNull(),
    sourceFingerprint: varchar("source_fingerprint", { length: 64 }).notNull(),
    sourceVersion: integer("source_version").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true, mode: "date" }).notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    check(
      "paper_summaries_source_fingerprint_sha256",
      sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("paper_summaries_source_version_positive", sql`${table.sourceVersion} >= 1`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => researchSpaces.id, { onDelete: "cascade" }),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    mediaType: documentMediaType("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    storageKey: text("storage_key").notNull(),
    status: documentStatus("status").default("queued").notNull(),
    stage: documentStage("stage"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "date" }),
    errorCode: text("error_code"),
    failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
    pageCount: integer("page_count"),
    characterCount: integer("character_count"),
    chunkCount: integer("chunk_count").default(0).notNull(),
    extractorVersion: text("extractor_version"),
    chunkerVersion: text("chunker_version"),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions"),
    indexFingerprint: varchar("index_fingerprint", { length: 64 }),
    indexedAt: timestamp("indexed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("documents_space_source_sha256_unique").on(table.spaceId, table.sourceSha256),
    index("documents_space_created_at_id_index").on(table.spaceId, table.createdAt, table.id),
    index("documents_uploaded_by_user_id_index").on(table.uploadedByUserId),
    check("documents_size_bytes_positive", sql`${table.sizeBytes} > 0`),
    check("documents_attempt_count_nonnegative", sql`${table.attemptCount} >= 0`),
    check("documents_chunk_count_nonnegative", sql`${table.chunkCount} >= 0`),
    check("documents_page_count_positive", sql`${table.pageCount} is null or ${table.pageCount} > 0`),
    check(
      "documents_character_count_nonnegative",
      sql`${table.characterCount} is null or ${table.characterCount} >= 0`,
    ),
    check(
      "documents_embedding_dimensions_positive",
      sql`${table.embeddingDimensions} is null or ${table.embeddingDimensions} > 0`,
    ),
    check(
      "documents_source_sha256_format",
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "documents_index_fingerprint_format",
      sql`${table.indexFingerprint} is null or ${table.indexFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    pageNumber: integer("page_number"),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (table) => [
    uniqueIndex("document_chunks_document_ordinal_unique").on(table.documentId, table.ordinal),
    check("document_chunks_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check(
      "document_chunks_page_number_positive",
      sql`${table.pageNumber} is null or ${table.pageNumber} > 0`,
    ),
    check("document_chunks_start_offset_nonnegative", sql`${table.startOffset} >= 0`),
    check("document_chunks_end_offset_order", sql`${table.endOffset} > ${table.startOffset}`),
    check(
      "document_chunks_content_hash_format",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type UserRecord = typeof users.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;
export type ResearchSpaceRecord = typeof researchSpaces.$inferSelect;
export type SpaceMemberRecord = typeof spaceMembers.$inferSelect;
export type ConnectionRecord = typeof connections.$inferSelect;
export type ChatMessageRecord = typeof chatMessages.$inferSelect;
export type PaperRecord = typeof papers.$inferSelect;
export type SavedPaperRecord = typeof savedPapers.$inferSelect;
export type PaperSummaryRecord = typeof paperSummaries.$inferSelect;
export type DocumentRecord = typeof documents.$inferSelect;
export type DocumentChunkRecord = typeof documentChunks.$inferSelect;
