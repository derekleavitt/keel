CREATE TYPE "public"."list_share_role" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TABLE "list_share" (
	"list_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "list_share_role" NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "list_share_list_id_user_id_pk" PRIMARY KEY("list_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "list_share" ADD CONSTRAINT "list_share_list_id_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_share" ADD CONSTRAINT "list_share_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_share_user_idx" ON "list_share" USING btree ("user_id");