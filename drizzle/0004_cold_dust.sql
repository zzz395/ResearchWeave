CREATE TABLE "paper_summaries" (
	"paper_id" uuid PRIMARY KEY NOT NULL,
	"overview" text NOT NULL,
	"key_contributions" text[] NOT NULL,
	"method_highlights" text[] NOT NULL,
	"findings" text[] NOT NULL,
	"caveats" text[] NOT NULL,
	"source_fingerprint" varchar(64) NOT NULL,
	"source_version" integer NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "paper_summaries_source_fingerprint_sha256" CHECK ("paper_summaries"."source_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "paper_summaries_source_version_positive" CHECK ("paper_summaries"."source_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "paper_summaries" ADD CONSTRAINT "paper_summaries_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;