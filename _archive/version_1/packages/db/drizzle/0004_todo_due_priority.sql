CREATE TYPE "public"."todo_priority" AS ENUM('none', 'low', 'medium', 'high');--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "priority" "todo_priority" DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE INDEX "todo_user_due_idx" ON "todo" USING btree ("user_id","due_date");