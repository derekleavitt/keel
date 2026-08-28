ALTER TABLE "list" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("list"."name", ''))) STORED;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("todo"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("todo"."notes", '')), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "list_search_idx" ON "list" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "todo_search_idx" ON "todo" USING gin ("search_vector");