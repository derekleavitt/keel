CREATE TYPE "public"."billing_plan" AS ENUM('free', 'team', 'business');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('active', 'trialing', 'past_due', 'canceled');--> statement-breakpoint
CREATE TABLE "billing_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"organization_id" text,
	"event_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"skipped_reason" text
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan" "billing_plan" DEFAULT 'free' NOT NULL,
	"status" "billing_status" DEFAULT 'active' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_event_time_idx" ON "billing_event" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "subscription_provider_idx" ON "subscription" USING btree ("provider_subscription_id");