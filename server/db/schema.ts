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
  varchar,
} from "drizzle-orm/pg-core";

export const spaceRole = pgEnum("space_role", ["owner", "member"]);
export const connectionStatus = pgEnum("connection_status", ["pending", "accepted"]);

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

export type UserRecord = typeof users.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;
export type ResearchSpaceRecord = typeof researchSpaces.$inferSelect;
export type SpaceMemberRecord = typeof spaceMembers.$inferSelect;
export type ConnectionRecord = typeof connections.$inferSelect;
export type ChatMessageRecord = typeof chatMessages.$inferSelect;
export type PaperRecord = typeof papers.$inferSelect;
export type SavedPaperRecord = typeof savedPapers.$inferSelect;
export type PaperSummaryRecord = typeof paperSummaries.$inferSelect;
