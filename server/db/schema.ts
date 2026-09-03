import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
export const agentRunStatus = pgEnum("agent_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const agentStepKind = pgEnum("agent_step_kind", [
  "tool_call",
  "final_answer",
  "decision_error",
]);
export const agentStepStatus = pgEnum("agent_step_status", [
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const agentEvidenceKind = pgEnum("agent_evidence_kind", [
  "arxiv_abstract",
  "knowledge_chunk",
]);

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

export const agentDefinitions = pgTable(
  "agent_definitions",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id").references(() => researchSpaces.id, { onDelete: "cascade" }),
    stableKey: varchar("stable_key", { length: 100 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    purpose: text("purpose").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    systemManaged: boolean("system_managed").default(true).notNull(),
    revision: integer("revision").notNull(),
    limitsJson: jsonb("limits_json").notNull(),
    promptVersion: varchar("prompt_version", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_definitions_stable_key_unique").on(table.stableKey),
    index("agent_definitions_space_id_index").on(table.spaceId),
    check("agent_definitions_stable_key_length", sql`char_length(${table.stableKey}) between 1 and 100`),
    check("agent_definitions_name_length", sql`char_length(${table.name}) between 1 and 120`),
    check("agent_definitions_purpose_length", sql`char_length(${table.purpose}) between 1 and 2000`),
    check("agent_definitions_revision_positive", sql`${table.revision} > 0`),
    check("agent_definitions_limits_object", sql`jsonb_typeof(${table.limitsJson}) = 'object'`),
    check(
      "agent_definitions_limits_valid",
      sql`coalesce(jsonb_typeof(${table.limitsJson}->'maxSteps') = 'number' and (${table.limitsJson}->>'maxSteps')::numeric between 1 and 8 and jsonb_typeof(${table.limitsJson}->'maxToolCalls') = 'number' and (${table.limitsJson}->>'maxToolCalls')::numeric between 1 and 6 and jsonb_typeof(${table.limitsJson}->'wallTimeSeconds') = 'number' and (${table.limitsJson}->>'wallTimeSeconds')::numeric between 1 and 180 and jsonb_typeof(${table.limitsJson}->'providerDecisionTimeoutSeconds') = 'number' and (${table.limitsJson}->>'providerDecisionTimeoutSeconds')::numeric between 1 and 30 and jsonb_typeof(${table.limitsJson}->'toolTimeoutSeconds') = 'number' and (${table.limitsJson}->>'toolTimeoutSeconds')::numeric between 1 and 45 and jsonb_typeof(${table.limitsJson}->'providerAttempts') = 'number' and (${table.limitsJson}->>'providerAttempts')::numeric between 1 and 2 and jsonb_typeof(${table.limitsJson}->'providerResponseMaxBytes') = 'number' and (${table.limitsJson}->>'providerResponseMaxBytes')::numeric between 1 and 65536 and jsonb_typeof(${table.limitsJson}->'observationMaxBytes') = 'number' and (${table.limitsJson}->>'observationMaxBytes')::numeric between 1 and 32768 and jsonb_typeof(${table.limitsJson}->'contextMaxBytes') = 'number' and (${table.limitsJson}->>'contextMaxBytes')::numeric between 1 and 131072 and jsonb_typeof(${table.limitsJson}->'finalAnswerMaxCharacters') = 'number' and (${table.limitsJson}->>'finalAnswerMaxCharacters')::numeric between 1 and 8000 and jsonb_typeof(${table.limitsJson}->'maxEvidence') = 'number' and (${table.limitsJson}->>'maxEvidence')::numeric between 1 and 32, false)`,
    ),
    check("agent_definitions_prompt_version_length", sql`char_length(${table.promptVersion}) between 1 and 100`),
  ],
);

export const agentDefinitionTools = pgTable(
  "agent_definition_tools",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: "cascade" }),
    toolName: varchar("tool_name", { length: 100 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.toolName], name: "agent_definition_tools_pk" }),
    check("agent_definition_tools_name_length", sql`char_length(${table.toolName}) between 1 and 100`),
  ],
);

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => researchSpaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    prompt: text("prompt").notNull(),
    clientRequestId: uuid("client_request_id").notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("agent_tasks_id_space_id_unique").on(table.id, table.spaceId),
    uniqueIndex("agent_tasks_creation_idempotency_unique").on(
      table.spaceId,
      table.createdByUserId,
      table.clientRequestId,
    ),
    index("agent_tasks_space_cursor_index").on(table.spaceId, table.createdAt, table.id),
    index("agent_tasks_agent_id_index").on(table.agentId),
    index("agent_tasks_created_by_user_id_index").on(table.createdByUserId),
    check("agent_tasks_prompt_length", sql`char_length(${table.prompt}) between 1 and 4000`),
    check("agent_tasks_request_fingerprint_sha256", sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => researchSpaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: agentRunStatus("status").default("queued").notNull(),
    definitionRevision: integer("definition_revision").notNull(),
    toolNames: text("tool_names").array().notNull(),
    maxSteps: integer("max_steps").notNull(),
    maxToolCalls: integer("max_tool_calls").notNull(),
    wallTimeSeconds: integer("wall_time_seconds").notNull(),
    providerDecisionTimeoutSeconds: integer("provider_decision_timeout_seconds").notNull(),
    toolTimeoutSeconds: integer("tool_timeout_seconds").notNull(),
    providerAttempts: integer("provider_attempts").notNull(),
    providerResponseMaxBytes: integer("provider_response_max_bytes").notNull(),
    observationMaxBytes: integer("observation_max_bytes").notNull(),
    contextMaxBytes: integer("context_max_bytes").notNull(),
    finalAnswerMaxCharacters: integer("final_answer_max_characters").notNull(),
    maxEvidence: integer("max_evidence").notNull(),
    promptVersion: varchar("prompt_version", { length: 100 }).notNull(),
    providerModel: varchar("provider_model", { length: 200 }).notNull(),
    stepCount: integer("step_count").default(0).notNull(),
    toolCallCount: integer("tool_call_count").default(0).notNull(),
    contextBytes: integer("context_bytes").default(0).notNull(),
    leaseOwnerId: uuid("lease_owner_id"),
    leaseGeneration: integer("lease_generation").default(0).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true, mode: "date" }),
    cancelRequestedByUserId: uuid("cancel_requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    errorCode: varchar("error_code", { length: 100 }),
    finalStatus: varchar("final_status", { length: 32 }),
    finalAnswer: text("final_answer"),
    retryClientRequestId: uuid("retry_client_request_id"),
    retryRequestFingerprint: varchar("retry_request_fingerprint", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.taskId, table.spaceId],
      foreignColumns: [agentTasks.id, agentTasks.spaceId],
      name: "agent_runs_task_space_fk",
    }).onDelete("cascade"),
    uniqueIndex("agent_runs_task_attempt_unique").on(table.taskId, table.attemptNumber),
    uniqueIndex("agent_runs_retry_idempotency_unique").on(
      table.taskId,
      table.retryClientRequestId,
    ),
    index("agent_runs_queued_claim_index")
      .on(table.createdAt, table.id)
      .where(sql`${table.status} = 'queued'`),
    index("agent_runs_expired_claim_index")
      .on(table.leaseExpiresAt, table.createdAt, table.id)
      .where(sql`${table.status} = 'running' and ${table.leaseExpiresAt} is not null`),
    check("agent_runs_attempt_number_positive", sql`${table.attemptNumber} > 0`),
    check("agent_runs_definition_revision_positive", sql`${table.definitionRevision} > 0`),
    check("agent_runs_tool_names_count", sql`cardinality(${table.toolNames}) between 1 and 3`),
    check("agent_runs_max_steps_valid", sql`${table.maxSteps} between 1 and 8`),
    check("agent_runs_max_tool_calls_valid", sql`${table.maxToolCalls} between 1 and 6`),
    check("agent_runs_wall_time_valid", sql`${table.wallTimeSeconds} between 1 and 180`),
    check("agent_runs_provider_timeout_valid", sql`${table.providerDecisionTimeoutSeconds} between 1 and 30`),
    check("agent_runs_tool_timeout_valid", sql`${table.toolTimeoutSeconds} between 1 and 45`),
    check("agent_runs_provider_attempts_valid", sql`${table.providerAttempts} between 1 and 2`),
    check("agent_runs_provider_response_bytes_valid", sql`${table.providerResponseMaxBytes} between 1 and 65536`),
    check("agent_runs_observation_bytes_valid", sql`${table.observationMaxBytes} between 1 and 32768`),
    check("agent_runs_context_bytes_limit_valid", sql`${table.contextMaxBytes} between 1 and 131072`),
    check("agent_runs_final_answer_limit_valid", sql`${table.finalAnswerMaxCharacters} between 1 and 8000`),
    check("agent_runs_max_evidence_valid", sql`${table.maxEvidence} between 1 and 32`),
    check("agent_runs_prompt_version_length", sql`char_length(${table.promptVersion}) between 1 and 100`),
    check("agent_runs_provider_model_length", sql`char_length(${table.providerModel}) between 1 and 200`),
    check("agent_runs_step_count_nonnegative", sql`${table.stepCount} >= 0`),
    check("agent_runs_tool_call_count_nonnegative", sql`${table.toolCallCount} >= 0`),
    check("agent_runs_tool_call_count_lte_steps", sql`${table.toolCallCount} <= ${table.stepCount}`),
    check("agent_runs_context_bytes_nonnegative", sql`${table.contextBytes} >= 0`),
    check("agent_runs_lease_generation_nonnegative", sql`${table.leaseGeneration} >= 0`),
    check(
      "agent_runs_lease_state_consistent",
      sql`(${table.status} = 'running' and ${table.leaseOwnerId} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'running' and ${table.leaseOwnerId} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "agent_runs_timing_consistent",
      sql`(${table.startedAt} is null and ${table.deadlineAt} is null) or (${table.startedAt} is not null and ${table.deadlineAt} > ${table.startedAt})`,
    ),
    check(
      "agent_runs_retry_idempotency_consistent",
      sql`(${table.attemptNumber} = 1 and ${table.retryClientRequestId} is null and ${table.retryRequestFingerprint} is null) or (${table.attemptNumber} > 1 and ${table.retryClientRequestId} is not null and ${table.retryRequestFingerprint} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "agent_runs_final_status_allowed",
      sql`${table.finalStatus} is null or ${table.finalStatus} in ('answered', 'insufficient_context')`,
    ),
    check(
      "agent_runs_final_answer_length",
      sql`${table.finalAnswer} is null or char_length(${table.finalAnswer}) between 1 and 8000`,
    ),
    check(
      "agent_runs_status_fields_consistent",
      sql`(${table.status} = 'queued' and ${table.startedAt} is null and ${table.finishedAt} is null and ${table.errorCode} is null and ${table.finalStatus} is null and ${table.finalAnswer} is null and ${table.cancelRequestedAt} is null and ${table.cancelRequestedByUserId} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.finishedAt} is null and ${table.errorCode} is null and ${table.finalStatus} is null and ${table.finalAnswer} is null and (${table.cancelRequestedByUserId} is null or ${table.cancelRequestedAt} is not null)) or (${table.status} = 'completed' and ${table.startedAt} is not null and ${table.finishedAt} is not null and ${table.errorCode} is null and ${table.finalStatus} is not null and ${table.finalAnswer} is not null and ${table.cancelRequestedAt} is null and ${table.cancelRequestedByUserId} is null) or (${table.status} = 'failed' and ${table.startedAt} is not null and ${table.finishedAt} is not null and ${table.errorCode} is not null and ${table.finalStatus} is null and ${table.finalAnswer} is null and ${table.cancelRequestedAt} is null and ${table.cancelRequestedByUserId} is null) or (${table.status} = 'cancelled' and ${table.finishedAt} is not null and ${table.errorCode} is null and ${table.finalStatus} is null and ${table.finalAnswer} is null and ${table.cancelRequestedAt} is not null)`,
    ),
  ],
);

export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: agentStepKind("kind").notNull(),
    status: agentStepStatus("status").notNull(),
    toolName: varchar("tool_name", { length: 100 }),
    safeArgumentsJson: jsonb("safe_arguments_json"),
    observationJson: jsonb("observation_json"),
    executionCount: integer("execution_count").default(1).notNull(),
    errorCode: varchar("error_code", { length: 100 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    unique("agent_run_steps_id_run_id_unique").on(table.id, table.runId),
    uniqueIndex("agent_run_steps_run_sequence_unique").on(table.runId, table.sequence),
    check("agent_run_steps_sequence_valid", sql`${table.sequence} between 1 and 8`),
    check("agent_run_steps_execution_count_positive", sql`${table.executionCount} > 0`),
    check("agent_run_steps_duration_nonnegative", sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
    check("agent_run_steps_tool_name_length", sql`${table.toolName} is null or char_length(${table.toolName}) between 1 and 100`),
    check("agent_run_steps_arguments_object", sql`${table.safeArgumentsJson} is null or jsonb_typeof(${table.safeArgumentsJson}) = 'object'`),
    check("agent_run_steps_observation_object", sql`${table.observationJson} is null or jsonb_typeof(${table.observationJson}) = 'object'`),
    check("agent_run_steps_observation_bytes", sql`${table.observationJson} is null or octet_length(${table.observationJson}::text) <= 32768`),
    check(
      "agent_run_steps_kind_fields_consistent",
      sql`(${table.kind} = 'tool_call' and ${table.toolName} is not null and ${table.safeArgumentsJson} is not null) or (${table.kind} <> 'tool_call' and ${table.toolName} is null and ${table.safeArgumentsJson} is null)`,
    ),
    check(
      "agent_run_steps_status_fields_consistent",
      sql`(${table.kind} = 'tool_call' and ${table.status} = 'running' and ${table.completedAt} is null and ${table.durationMs} is null and ${table.errorCode} is null and ${table.observationJson} is null) or (${table.kind} = 'tool_call' and ${table.status} = 'completed' and ${table.completedAt} is not null and ${table.durationMs} is not null and ${table.errorCode} is null and ${table.observationJson} is not null) or (${table.kind} = 'tool_call' and ${table.status} = 'failed' and ${table.completedAt} is not null and ${table.durationMs} is not null and ${table.errorCode} is not null and ${table.observationJson} is null) or (${table.kind} = 'tool_call' and ${table.status} = 'cancelled' and ${table.completedAt} is not null and ${table.durationMs} is not null and ${table.errorCode} is null and ${table.observationJson} is null) or (${table.kind} = 'final_answer' and ${table.status} = 'completed' and ${table.completedAt} is not null and ${table.durationMs} is not null and ${table.errorCode} is null and ${table.observationJson} is null) or (${table.kind} = 'decision_error' and ${table.status} = 'failed' and ${table.completedAt} is not null and ${table.durationMs} is not null and ${table.errorCode} is not null and ${table.observationJson} is null)`,
    ),
  ],
);

export const agentRunEvidence = pgTable(
  "agent_run_evidence",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").notNull(),
    evidenceKey: varchar("evidence_key", { length: 3 }).notNull(),
    kind: agentEvidenceKind("kind").notNull(),
    paperId: uuid("paper_id").references(() => papers.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    canonicalArxivId: varchar("canonical_arxiv_id", { length: 100 }),
    versionedArxivId: varchar("versioned_arxiv_id", { length: 100 }),
    sourceVersion: integer("source_version"),
    sourceTitle: varchar("source_title", { length: 1000 }),
    sourceUrl: text("source_url"),
    originalFilename: varchar("original_filename", { length: 255 }),
    contentHash: varchar("content_hash", { length: 64 }),
    chunkOrdinal: integer("chunk_ordinal"),
    pageNumber: integer("page_number"),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    excerpt: text("excerpt").notNull(),
    finalOrdinal: integer("final_ordinal"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.stepId, table.runId],
      foreignColumns: [agentRunSteps.id, agentRunSteps.runId],
      name: "agent_run_evidence_step_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("agent_run_evidence_run_key_unique").on(table.runId, table.evidenceKey),
    uniqueIndex("agent_run_evidence_run_final_ordinal_unique").on(
      table.runId,
      table.finalOrdinal,
    ),
    check("agent_run_evidence_key_format", sql`${table.evidenceKey} ~ '^E([1-9]|[12][0-9]|3[0-2])$'`),
    check("agent_run_evidence_final_ordinal_valid", sql`${table.finalOrdinal} is null or ${table.finalOrdinal} between 1 and 32`),
    check("agent_run_evidence_excerpt_nonempty", sql`char_length(${table.excerpt}) > 0`),
    check(
      "agent_run_evidence_arxiv_fields_consistent",
      sql`${table.kind} <> 'arxiv_abstract' or (${table.documentId} is null and ${table.canonicalArxivId} is not null and ${table.versionedArxivId} is not null and ${table.sourceVersion} > 0 and ${table.sourceTitle} is not null and ${table.sourceUrl} is not null and ${table.originalFilename} is null and ${table.contentHash} is null and ${table.chunkOrdinal} is null and ${table.pageNumber} is null and ${table.startOffset} is null and ${table.endOffset} is null and char_length(${table.excerpt}) <= 2000)`,
    ),
    check(
      "agent_run_evidence_knowledge_fields_consistent",
      sql`${table.kind} <> 'knowledge_chunk' or (${table.paperId} is null and ${table.canonicalArxivId} is null and ${table.versionedArxivId} is null and ${table.sourceVersion} is null and ${table.sourceTitle} is null and ${table.sourceUrl} is null and ${table.originalFilename} is not null and ${table.contentHash} ~ '^[0-9a-f]{64}$' and ${table.chunkOrdinal} >= 0 and (${table.pageNumber} is null or ${table.pageNumber} > 0) and ${table.startOffset} >= 0 and ${table.endOffset} > ${table.startOffset} and char_length(${table.excerpt}) <= 1000)`,
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
export type AgentDefinitionRecord = typeof agentDefinitions.$inferSelect;
export type AgentDefinitionToolRecord = typeof agentDefinitionTools.$inferSelect;
export type AgentTaskRecord = typeof agentTasks.$inferSelect;
export type AgentRunRecord = typeof agentRuns.$inferSelect;
export type AgentRunStepRecord = typeof agentRunSteps.$inferSelect;
export type AgentRunEvidenceRecord = typeof agentRunEvidence.$inferSelect;
