CREATE TABLE "change_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_channel_idx" ON "change_log" USING btree ("channel","id");--> statement-breakpoint
CREATE INDEX "change_log_org_time_idx" ON "change_log" USING btree ("organization_id","created_at");