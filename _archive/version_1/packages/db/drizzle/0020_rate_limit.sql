CREATE TABLE "rate_limit_bucket" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"current_count" bigint NOT NULL,
	"previous_count" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_window_idx" ON "rate_limit_bucket" USING btree ("window_start");