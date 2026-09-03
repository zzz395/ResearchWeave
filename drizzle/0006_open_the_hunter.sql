CREATE TYPE "public"."agent_evidence_kind" AS ENUM('arxiv_abstract', 'knowledge_chunk');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_step_kind" AS ENUM('tool_call', 'final_answer', 'decision_error');--> statement-breakpoint
CREATE TYPE "public"."agent_step_status" AS ENUM('running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_definition_tools" (
	"agent_id" uuid NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	CONSTRAINT "agent_definition_tools_pk" PRIMARY KEY("agent_id","tool_name"),
	CONSTRAINT "agent_definition_tools_name_length" CHECK (char_length("agent_definition_tools"."tool_name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "agent_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid,
	"stable_key" varchar(100) NOT NULL,
	"name" varchar(120) NOT NULL,
	"purpose" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"system_managed" boolean DEFAULT true NOT NULL,
	"revision" integer NOT NULL,
	"limits_json" jsonb NOT NULL,
	"prompt_version" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_definitions_stable_key_length" CHECK (char_length("agent_definitions"."stable_key") between 1 and 100),
	CONSTRAINT "agent_definitions_name_length" CHECK (char_length("agent_definitions"."name") between 1 and 120),
	CONSTRAINT "agent_definitions_purpose_length" CHECK (char_length("agent_definitions"."purpose") between 1 and 2000),
	CONSTRAINT "agent_definitions_revision_positive" CHECK ("agent_definitions"."revision" > 0),
	CONSTRAINT "agent_definitions_limits_object" CHECK (jsonb_typeof("agent_definitions"."limits_json") = 'object'),
	CONSTRAINT "agent_definitions_limits_valid" CHECK (coalesce(jsonb_typeof("agent_definitions"."limits_json"->'maxSteps') = 'number' and ("agent_definitions"."limits_json"->>'maxSteps')::numeric between 1 and 8 and jsonb_typeof("agent_definitions"."limits_json"->'maxToolCalls') = 'number' and ("agent_definitions"."limits_json"->>'maxToolCalls')::numeric between 1 and 6 and jsonb_typeof("agent_definitions"."limits_json"->'wallTimeSeconds') = 'number' and ("agent_definitions"."limits_json"->>'wallTimeSeconds')::numeric between 1 and 180 and jsonb_typeof("agent_definitions"."limits_json"->'providerDecisionTimeoutSeconds') = 'number' and ("agent_definitions"."limits_json"->>'providerDecisionTimeoutSeconds')::numeric between 1 and 30 and jsonb_typeof("agent_definitions"."limits_json"->'toolTimeoutSeconds') = 'number' and ("agent_definitions"."limits_json"->>'toolTimeoutSeconds')::numeric between 1 and 45 and jsonb_typeof("agent_definitions"."limits_json"->'providerAttempts') = 'number' and ("agent_definitions"."limits_json"->>'providerAttempts')::numeric between 1 and 2 and jsonb_typeof("agent_definitions"."limits_json"->'providerResponseMaxBytes') = 'number' and ("agent_definitions"."limits_json"->>'providerResponseMaxBytes')::numeric between 1 and 65536 and jsonb_typeof("agent_definitions"."limits_json"->'observationMaxBytes') = 'number' and ("agent_definitions"."limits_json"->>'observationMaxBytes')::numeric between 1 and 32768 and jsonb_typeof("agent_definitions"."limits_json"->'contextMaxBytes') = 'number' and ("agent_definitions"."limits_json"->>'contextMaxBytes')::numeric between 1 and 131072 and jsonb_typeof("agent_definitions"."limits_json"->'finalAnswerMaxCharacters') = 'number' and ("agent_definitions"."limits_json"->>'finalAnswerMaxCharacters')::numeric between 1 and 8000 and jsonb_typeof("agent_definitions"."limits_json"->'maxEvidence') = 'number' and ("agent_definitions"."limits_json"->>'maxEvidence')::numeric between 1 and 32, false)),
	CONSTRAINT "agent_definitions_prompt_version_length" CHECK (char_length("agent_definitions"."prompt_version") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "agent_run_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"evidence_key" varchar(3) NOT NULL,
	"kind" "agent_evidence_kind" NOT NULL,
	"paper_id" uuid,
	"document_id" uuid,
	"canonical_arxiv_id" varchar(100),
	"versioned_arxiv_id" varchar(100),
	"source_version" integer,
	"source_title" varchar(1000),
	"source_url" text,
	"original_filename" varchar(255),
	"content_hash" varchar(64),
	"chunk_ordinal" integer,
	"page_number" integer,
	"start_offset" integer,
	"end_offset" integer,
	"excerpt" text NOT NULL,
	"final_ordinal" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_evidence_key_format" CHECK ("agent_run_evidence"."evidence_key" ~ '^E([1-9]|[12][0-9]|3[0-2])$'),
	CONSTRAINT "agent_run_evidence_final_ordinal_valid" CHECK ("agent_run_evidence"."final_ordinal" is null or "agent_run_evidence"."final_ordinal" between 1 and 32),
	CONSTRAINT "agent_run_evidence_excerpt_nonempty" CHECK (char_length("agent_run_evidence"."excerpt") > 0),
	CONSTRAINT "agent_run_evidence_arxiv_fields_consistent" CHECK ("agent_run_evidence"."kind" <> 'arxiv_abstract' or ("agent_run_evidence"."document_id" is null and "agent_run_evidence"."canonical_arxiv_id" is not null and "agent_run_evidence"."versioned_arxiv_id" is not null and "agent_run_evidence"."source_version" > 0 and "agent_run_evidence"."source_title" is not null and "agent_run_evidence"."source_url" is not null and "agent_run_evidence"."original_filename" is null and "agent_run_evidence"."content_hash" is null and "agent_run_evidence"."chunk_ordinal" is null and "agent_run_evidence"."page_number" is null and "agent_run_evidence"."start_offset" is null and "agent_run_evidence"."end_offset" is null and char_length("agent_run_evidence"."excerpt") <= 2000)),
	CONSTRAINT "agent_run_evidence_knowledge_fields_consistent" CHECK ("agent_run_evidence"."kind" <> 'knowledge_chunk' or ("agent_run_evidence"."paper_id" is null and "agent_run_evidence"."canonical_arxiv_id" is null and "agent_run_evidence"."versioned_arxiv_id" is null and "agent_run_evidence"."source_version" is null and "agent_run_evidence"."source_title" is null and "agent_run_evidence"."source_url" is null and "agent_run_evidence"."original_filename" is not null and "agent_run_evidence"."content_hash" ~ '^[0-9a-f]{64}$' and "agent_run_evidence"."chunk_ordinal" >= 0 and ("agent_run_evidence"."page_number" is null or "agent_run_evidence"."page_number" > 0) and "agent_run_evidence"."start_offset" >= 0 and "agent_run_evidence"."end_offset" > "agent_run_evidence"."start_offset" and char_length("agent_run_evidence"."excerpt") <= 1000))
);
--> statement-breakpoint
CREATE TABLE "agent_run_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" "agent_step_kind" NOT NULL,
	"status" "agent_step_status" NOT NULL,
	"tool_name" varchar(100),
	"safe_arguments_json" jsonb,
	"observation_json" jsonb,
	"execution_count" integer DEFAULT 1 NOT NULL,
	"error_code" varchar(100),
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "agent_run_steps_id_run_id_unique" UNIQUE("id","run_id"),
	CONSTRAINT "agent_run_steps_sequence_valid" CHECK ("agent_run_steps"."sequence" between 1 and 8),
	CONSTRAINT "agent_run_steps_execution_count_positive" CHECK ("agent_run_steps"."execution_count" > 0),
	CONSTRAINT "agent_run_steps_duration_nonnegative" CHECK ("agent_run_steps"."duration_ms" is null or "agent_run_steps"."duration_ms" >= 0),
	CONSTRAINT "agent_run_steps_tool_name_length" CHECK ("agent_run_steps"."tool_name" is null or char_length("agent_run_steps"."tool_name") between 1 and 100),
	CONSTRAINT "agent_run_steps_arguments_object" CHECK ("agent_run_steps"."safe_arguments_json" is null or jsonb_typeof("agent_run_steps"."safe_arguments_json") = 'object'),
	CONSTRAINT "agent_run_steps_observation_object" CHECK ("agent_run_steps"."observation_json" is null or jsonb_typeof("agent_run_steps"."observation_json") = 'object'),
	CONSTRAINT "agent_run_steps_observation_bytes" CHECK ("agent_run_steps"."observation_json" is null or octet_length("agent_run_steps"."observation_json"::text) <= 32768),
	CONSTRAINT "agent_run_steps_kind_fields_consistent" CHECK (("agent_run_steps"."kind" = 'tool_call' and "agent_run_steps"."tool_name" is not null and "agent_run_steps"."safe_arguments_json" is not null) or ("agent_run_steps"."kind" <> 'tool_call' and "agent_run_steps"."tool_name" is null and "agent_run_steps"."safe_arguments_json" is null)),
	CONSTRAINT "agent_run_steps_status_fields_consistent" CHECK (("agent_run_steps"."kind" = 'tool_call' and "agent_run_steps"."status" = 'running' and "agent_run_steps"."completed_at" is null and "agent_run_steps"."duration_ms" is null and "agent_run_steps"."error_code" is null and "agent_run_steps"."observation_json" is null) or ("agent_run_steps"."kind" = 'tool_call' and "agent_run_steps"."status" = 'completed' and "agent_run_steps"."completed_at" is not null and "agent_run_steps"."duration_ms" is not null and "agent_run_steps"."error_code" is null and "agent_run_steps"."observation_json" is not null) or ("agent_run_steps"."kind" = 'tool_call' and "agent_run_steps"."status" = 'failed' and "agent_run_steps"."completed_at" is not null and "agent_run_steps"."duration_ms" is not null and "agent_run_steps"."error_code" is not null and "agent_run_steps"."observation_json" is null) or ("agent_run_steps"."kind" = 'tool_call' and "agent_run_steps"."status" = 'cancelled' and "agent_run_steps"."completed_at" is not null and "agent_run_steps"."duration_ms" is not null and "agent_run_steps"."error_code" is null and "agent_run_steps"."observation_json" is null) or ("agent_run_steps"."kind" = 'final_answer' and "agent_run_steps"."status" = 'completed' and "agent_run_steps"."completed_at" is not null and "agent_run_steps"."duration_ms" is not null and "agent_run_steps"."error_code" is null and "agent_run_steps"."observation_json" is null) or ("agent_run_steps"."kind" = 'decision_error' and "agent_run_steps"."status" = 'failed' and "agent_run_steps"."completed_at" is not null and "agent_run_steps"."duration_ms" is not null and "agent_run_steps"."error_code" is not null and "agent_run_steps"."observation_json" is null))
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"attempt_number" integer NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"definition_revision" integer NOT NULL,
	"tool_names" text[] NOT NULL,
	"max_steps" integer NOT NULL,
	"max_tool_calls" integer NOT NULL,
	"wall_time_seconds" integer NOT NULL,
	"provider_decision_timeout_seconds" integer NOT NULL,
	"tool_timeout_seconds" integer NOT NULL,
	"provider_attempts" integer NOT NULL,
	"provider_response_max_bytes" integer NOT NULL,
	"observation_max_bytes" integer NOT NULL,
	"context_max_bytes" integer NOT NULL,
	"final_answer_max_characters" integer NOT NULL,
	"max_evidence" integer NOT NULL,
	"prompt_version" varchar(100) NOT NULL,
	"provider_model" varchar(200) NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"context_bytes" integer DEFAULT 0 NOT NULL,
	"lease_owner_id" uuid,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancel_requested_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" varchar(100),
	"final_status" varchar(32),
	"final_answer" text,
	"retry_client_request_id" uuid,
	"retry_request_fingerprint" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_attempt_number_positive" CHECK ("agent_runs"."attempt_number" > 0),
	CONSTRAINT "agent_runs_definition_revision_positive" CHECK ("agent_runs"."definition_revision" > 0),
	CONSTRAINT "agent_runs_tool_names_count" CHECK (cardinality("agent_runs"."tool_names") between 1 and 3),
	CONSTRAINT "agent_runs_max_steps_valid" CHECK ("agent_runs"."max_steps" between 1 and 8),
	CONSTRAINT "agent_runs_max_tool_calls_valid" CHECK ("agent_runs"."max_tool_calls" between 1 and 6),
	CONSTRAINT "agent_runs_wall_time_valid" CHECK ("agent_runs"."wall_time_seconds" between 1 and 180),
	CONSTRAINT "agent_runs_provider_timeout_valid" CHECK ("agent_runs"."provider_decision_timeout_seconds" between 1 and 30),
	CONSTRAINT "agent_runs_tool_timeout_valid" CHECK ("agent_runs"."tool_timeout_seconds" between 1 and 45),
	CONSTRAINT "agent_runs_provider_attempts_valid" CHECK ("agent_runs"."provider_attempts" between 1 and 2),
	CONSTRAINT "agent_runs_provider_response_bytes_valid" CHECK ("agent_runs"."provider_response_max_bytes" between 1 and 65536),
	CONSTRAINT "agent_runs_observation_bytes_valid" CHECK ("agent_runs"."observation_max_bytes" between 1 and 32768),
	CONSTRAINT "agent_runs_context_bytes_limit_valid" CHECK ("agent_runs"."context_max_bytes" between 1 and 131072),
	CONSTRAINT "agent_runs_final_answer_limit_valid" CHECK ("agent_runs"."final_answer_max_characters" between 1 and 8000),
	CONSTRAINT "agent_runs_max_evidence_valid" CHECK ("agent_runs"."max_evidence" between 1 and 32),
	CONSTRAINT "agent_runs_prompt_version_length" CHECK (char_length("agent_runs"."prompt_version") between 1 and 100),
	CONSTRAINT "agent_runs_provider_model_length" CHECK (char_length("agent_runs"."provider_model") between 1 and 200),
	CONSTRAINT "agent_runs_step_count_nonnegative" CHECK ("agent_runs"."step_count" >= 0),
	CONSTRAINT "agent_runs_tool_call_count_nonnegative" CHECK ("agent_runs"."tool_call_count" >= 0),
	CONSTRAINT "agent_runs_tool_call_count_lte_steps" CHECK ("agent_runs"."tool_call_count" <= "agent_runs"."step_count"),
	CONSTRAINT "agent_runs_context_bytes_nonnegative" CHECK ("agent_runs"."context_bytes" >= 0),
	CONSTRAINT "agent_runs_lease_generation_nonnegative" CHECK ("agent_runs"."lease_generation" >= 0),
	CONSTRAINT "agent_runs_lease_state_consistent" CHECK (("agent_runs"."status" = 'running' and "agent_runs"."lease_owner_id" is not null and "agent_runs"."lease_expires_at" is not null) or ("agent_runs"."status" <> 'running' and "agent_runs"."lease_owner_id" is null and "agent_runs"."lease_expires_at" is null)),
	CONSTRAINT "agent_runs_timing_consistent" CHECK (("agent_runs"."started_at" is null and "agent_runs"."deadline_at" is null) or ("agent_runs"."started_at" is not null and "agent_runs"."deadline_at" > "agent_runs"."started_at")),
	CONSTRAINT "agent_runs_retry_idempotency_consistent" CHECK (("agent_runs"."attempt_number" = 1 and "agent_runs"."retry_client_request_id" is null and "agent_runs"."retry_request_fingerprint" is null) or ("agent_runs"."attempt_number" > 1 and "agent_runs"."retry_client_request_id" is not null and "agent_runs"."retry_request_fingerprint" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "agent_runs_final_status_allowed" CHECK ("agent_runs"."final_status" is null or "agent_runs"."final_status" in ('answered', 'insufficient_context')),
	CONSTRAINT "agent_runs_final_answer_length" CHECK ("agent_runs"."final_answer" is null or char_length("agent_runs"."final_answer") between 1 and 8000),
	CONSTRAINT "agent_runs_status_fields_consistent" CHECK (("agent_runs"."status" = 'queued' and "agent_runs"."started_at" is null and "agent_runs"."finished_at" is null and "agent_runs"."error_code" is null and "agent_runs"."final_status" is null and "agent_runs"."final_answer" is null and "agent_runs"."cancel_requested_at" is null and "agent_runs"."cancel_requested_by_user_id" is null) or ("agent_runs"."status" = 'running' and "agent_runs"."started_at" is not null and "agent_runs"."finished_at" is null and "agent_runs"."error_code" is null and "agent_runs"."final_status" is null and "agent_runs"."final_answer" is null and ("agent_runs"."cancel_requested_by_user_id" is null or "agent_runs"."cancel_requested_at" is not null)) or ("agent_runs"."status" = 'completed' and "agent_runs"."started_at" is not null and "agent_runs"."finished_at" is not null and "agent_runs"."error_code" is null and "agent_runs"."final_status" is not null and "agent_runs"."final_answer" is not null and "agent_runs"."cancel_requested_at" is null and "agent_runs"."cancel_requested_by_user_id" is null) or ("agent_runs"."status" = 'failed' and "agent_runs"."started_at" is not null and "agent_runs"."finished_at" is not null and "agent_runs"."error_code" is not null and "agent_runs"."final_status" is null and "agent_runs"."final_answer" is null and "agent_runs"."cancel_requested_at" is null and "agent_runs"."cancel_requested_by_user_id" is null) or ("agent_runs"."status" = 'cancelled' and "agent_runs"."finished_at" is not null and "agent_runs"."error_code" is null and "agent_runs"."final_status" is null and "agent_runs"."final_answer" is null and "agent_runs"."cancel_requested_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"prompt" text NOT NULL,
	"client_request_id" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tasks_id_space_id_unique" UNIQUE("id","space_id"),
	CONSTRAINT "agent_tasks_prompt_length" CHECK (char_length("agent_tasks"."prompt") between 1 and 4000),
	CONSTRAINT "agent_tasks_request_fingerprint_sha256" CHECK ("agent_tasks"."request_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agent_definition_tools" ADD CONSTRAINT "agent_definition_tools_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_space_id_research_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."research_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_evidence" ADD CONSTRAINT "agent_run_evidence_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_evidence" ADD CONSTRAINT "agent_run_evidence_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_evidence" ADD CONSTRAINT "agent_run_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_evidence" ADD CONSTRAINT "agent_run_evidence_step_run_fk" FOREIGN KEY ("step_id","run_id") REFERENCES "public"."agent_run_steps"("id","run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_space_id_research_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."research_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_cancel_requested_by_user_id_users_id_fk" FOREIGN KEY ("cancel_requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_space_fk" FOREIGN KEY ("task_id","space_id") REFERENCES "public"."agent_tasks"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_space_id_research_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."research_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definitions_stable_key_unique" ON "agent_definitions" USING btree ("stable_key");--> statement-breakpoint
CREATE INDEX "agent_definitions_space_id_index" ON "agent_definitions" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_evidence_run_key_unique" ON "agent_run_evidence" USING btree ("run_id","evidence_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_evidence_run_final_ordinal_unique" ON "agent_run_evidence" USING btree ("run_id","final_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_steps_run_sequence_unique" ON "agent_run_steps" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_task_attempt_unique" ON "agent_runs" USING btree ("task_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_retry_idempotency_unique" ON "agent_runs" USING btree ("task_id","retry_client_request_id");--> statement-breakpoint
CREATE INDEX "agent_runs_queued_claim_index" ON "agent_runs" USING btree ("created_at","id") WHERE "agent_runs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "agent_runs_expired_claim_index" ON "agent_runs" USING btree ("lease_expires_at","created_at","id") WHERE "agent_runs"."status" = 'running' and "agent_runs"."lease_expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tasks_creation_idempotency_unique" ON "agent_tasks" USING btree ("space_id","created_by_user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_space_cursor_index" ON "agent_tasks" USING btree ("space_id","created_at","id");--> statement-breakpoint
CREATE INDEX "agent_tasks_agent_id_index" ON "agent_tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_created_by_user_id_index" ON "agent_tasks" USING btree ("created_by_user_id");