CREATE TYPE "public"."connection_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_body_length" CHECK (char_length("chat_messages"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_low_id" uuid NOT NULL,
	"user_high_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "connections_canonical_pair" CHECK ("connections"."user_low_id" < "connections"."user_high_id"),
	CONSTRAINT "connections_requester_in_pair" CHECK ("connections"."requested_by_user_id" = "connections"."user_low_id" or "connections"."requested_by_user_id" = "connections"."user_high_id")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_space_id_research_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."research_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_low_id_users_id_fk" FOREIGN KEY ("user_low_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_high_id_users_id_fk" FOREIGN KEY ("user_high_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_space_cursor_index" ON "chat_messages" USING btree ("space_id","created_at","id");--> statement-breakpoint
CREATE INDEX "chat_messages_sender_user_id_index" ON "chat_messages" USING btree ("sender_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_pair_unique" ON "connections" USING btree ("user_low_id","user_high_id");--> statement-breakpoint
CREATE INDEX "connections_user_low_id_index" ON "connections" USING btree ("user_low_id");--> statement-breakpoint
CREATE INDEX "connections_user_high_id_index" ON "connections" USING btree ("user_high_id");