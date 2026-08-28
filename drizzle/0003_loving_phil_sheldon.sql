CREATE TABLE "papers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"canonical_arxiv_id" text NOT NULL,
	"versioned_arxiv_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"abstract" text NOT NULL,
	"authors" text[] NOT NULL,
	"primary_category" text NOT NULL,
	"categories" text[] NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"comment" text,
	"journal_ref" text,
	"doi" text,
	"abs_url" text NOT NULL,
	"pdf_url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "papers_version_positive" CHECK ("papers"."version" >= 1),
	CONSTRAINT "papers_authors_nonempty" CHECK (cardinality("papers"."authors") >= 1),
	CONSTRAINT "papers_categories_nonempty" CHECK (cardinality("papers"."categories") >= 1)
);
--> statement-breakpoint
CREATE TABLE "saved_papers" (
	"space_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"saved_by_user_id" uuid,
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "saved_papers_pk" PRIMARY KEY("space_id","paper_id")
);
--> statement-breakpoint
ALTER TABLE "saved_papers" ADD CONSTRAINT "saved_papers_space_id_research_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."research_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_papers" ADD CONSTRAINT "saved_papers_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_papers" ADD CONSTRAINT "saved_papers_saved_by_user_id_users_id_fk" FOREIGN KEY ("saved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "papers_canonical_arxiv_id_unique" ON "papers" USING btree ("canonical_arxiv_id");--> statement-breakpoint
CREATE INDEX "saved_papers_space_saved_at_index" ON "saved_papers" USING btree ("space_id","saved_at");--> statement-breakpoint
CREATE INDEX "saved_papers_saved_by_user_id_index" ON "saved_papers" USING btree ("saved_by_user_id");