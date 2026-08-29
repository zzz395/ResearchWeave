CREATE TYPE "public"."document_media_type" AS ENUM('pdf', 'text', 'markdown');--> statement-breakpoint
CREATE TYPE "public"."document_stage" AS ENUM('extracting', 'chunking', 'embedding');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"page_number" integer,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	CONSTRAINT "document_chunks_ordinal_nonnegative" CHECK ("document_chunks"."ordinal" >= 0),
	CONSTRAINT "document_chunks_page_number_positive" CHECK ("document_chunks"."page_number" is null or "document_chunks"."page_number" > 0),
	CONSTRAINT "document_chunks_start_offset_nonnegative" CHECK ("document_chunks"."start_offset" >= 0),
	CONSTRAINT "document_chunks_end_offset_order" CHECK ("document_chunks"."end_offset" > "document_chunks"."start_offset"),
	CONSTRAINT "document_chunks_content_hash_format" CHECK ("document_chunks"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid,
	"original_filename" varchar(255) NOT NULL,
	"media_type" "document_media_type" NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"status" "document_status" DEFAULT 'queued' NOT NULL,
	"stage" "document_stage",
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"error_code" text,
	"failed_at" timestamp with time zone,
	"page_count" integer,
	"character_count" integer,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"extractor_version" text,
	"chunker_version" text,
	"embedding_model" text,
	"embedding_dimensions" integer,
	"index_fingerprint" varchar(64),
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_size_bytes_positive" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_attempt_count_nonnegative" CHECK ("documents"."attempt_count" >= 0),
	CONSTRAINT "documents_chunk_count_nonnegative" CHECK ("documents"."chunk_count" >= 0),
	CONSTRAINT "documents_page_count_positive" CHECK ("documents"."page_count" is null or "documents"."page_count" > 0),
	CONSTRAINT "documents_character_count_nonnegative" CHECK ("documents"."character_count" is null or "documents"."character_count" >= 0),
	CONSTRAINT "documents_embedding_dimensions_positive" CHECK ("documents"."embedding_dimensions" is null or "documents"."embedding_dimensions" > 0),
	CONSTRAINT "documents_source_sha256_format" CHECK ("documents"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_index_fingerprint_format" CHECK ("documents"."index_fingerprint" is null or "documents"."index_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_research_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."research_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_ordinal_unique" ON "document_chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_space_source_sha256_unique" ON "documents" USING btree ("space_id","source_sha256");--> statement-breakpoint
CREATE INDEX "documents_space_created_at_id_index" ON "documents" USING btree ("space_id","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_uploaded_by_user_id_index" ON "documents" USING btree ("uploaded_by_user_id");