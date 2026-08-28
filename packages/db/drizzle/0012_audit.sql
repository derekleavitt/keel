CREATE TABLE "audit_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"summary" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_entry" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_entry" USING btree ("target_type","target_id");