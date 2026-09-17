-- Data migration: give every existing user a personal organization, and move their
-- lists and tags into it.
--
-- Written by hand via `drizzle-kit generate --custom`, because `generate` emits DDL only
-- and cannot know that existing rows need a tenant invented for them. This is the
-- sanctioned way to write one — it is not an edit to a generated file.
--
-- Idempotent throughout: every insert is guarded, so re-running against a partially
-- migrated database completes it rather than failing. A data migration that cannot be
-- safely retried is a data migration that will eventually be run twice by accident.

-- 1. One personal organization per user that does not already have one.
INSERT INTO "organization" ("id", "name", "slug", "personal_for_user_id", "created_at", "updated_at")
SELECT
  'org_' || u."id",
  COALESCE(NULLIF(u."name", ''), u."email") || '''s workspace',
  'personal-' || u."id",
  u."id",
  now(),
  now()
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM "organization" o WHERE o."personal_for_user_id" = u."id"
);
--> statement-breakpoint
-- 2. Every user owns their personal organization.
INSERT INTO "membership" ("organization_id", "user_id", "role", "created_at")
SELECT o."id", o."personal_for_user_id", 'owner', now()
FROM "organization" o
WHERE o."personal_for_user_id" IS NOT NULL
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
--> statement-breakpoint
-- 3. Move orphaned lists and tags into their owner's personal organization.
UPDATE "list" l
SET "organization_id" = o."id"
FROM "organization" o
WHERE o."personal_for_user_id" = l."user_id" AND l."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "tag" t
SET "organization_id" = o."id"
FROM "organization" o
WHERE o."personal_for_user_id" = t."user_id" AND t."organization_id" IS NULL;
--> statement-breakpoint
-- 4. Now that nothing is orphaned, the column can carry its real constraint.
--    Done last on purpose: setting NOT NULL before the backfill would fail on any
--    database that has rows in it, which is every database that matters.
ALTER TABLE "list" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tag" ALTER COLUMN "organization_id" SET NOT NULL;
