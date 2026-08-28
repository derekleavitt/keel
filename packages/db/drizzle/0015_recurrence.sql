CREATE TYPE "public"."recurrence_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "recurrence_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"list_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"priority" "todo_priority" DEFAULT 'none' NOT NULL,
	"frequency" "recurrence_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"by_weekday" jsonb,
	"start_date" date NOT NULL,
	"until" date,
	"time_zone" text NOT NULL,
	"generated_through" date,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "recurrence_rule_id" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "occurrence_date" date;--> statement-breakpoint
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_list_id_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurrence_rule_org_idx" ON "recurrence_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recurrence_rule_list_idx" ON "recurrence_rule" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "todo_occurrence_idx" ON "todo" USING btree ("recurrence_rule_id","occurrence_date") WHERE "todo"."recurrence_rule_id" is not null;