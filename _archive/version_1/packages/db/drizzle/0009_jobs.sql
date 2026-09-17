CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"run_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"unique_key" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "job_unique_key_unique" UNIQUE("unique_key")
);
--> statement-breakpoint
ALTER TABLE "list" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tag" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" USING btree ("status","run_at");