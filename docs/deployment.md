# Deployment

Two paths. Both have been run; the difference between them is written down rather than
implied.

**What has actually been verified here:** the container image builds from a clean checkout,
boots against a real Postgres, applies migrations, serves pages, signs a user up, writes to
the database, serves its static assets, and refuses an unauthenticated worker call. That was
done on a laptop with `docker-compose.prod.yml`.

**What has not:** deploying to any hosting provider. That needs an account and credentials
belonging to whoever owns the deployment. The Vercel section below is the configuration such
a deployment needs, and it is untested — treated as a checklist, not a guarantee.

## What the application needs

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres. Pooled connection is fine; migrations want a direct one. |
| `BETTER_AUTH_SECRET` | yes | ≥32 characters. Rotating it signs everybody out. |
| `BETTER_AUTH_URL` | yes | The public origin. Sign-in breaks if it is wrong, and the environment contract uses it to tell a deployment from a laptop. |
| `JOBS_SECRET` | to run jobs | ≥16 characters. Without it the worker endpoint refuses everything, which is the safe default. |
| `BILLING_WEBHOOK_SECRET` | with a payment provider | See `docs/billing.md`. |

Two variables exist for local development and are **refused on a deployed instance** by the
environment contract — the app will not start rather than run with them:
`WEBHOOK_ALLOW_PRIVATE_HOSTS` and `AUTH_RATE_LIMIT_DISABLED`. A copied `.env` therefore fails
loudly instead of quietly disabling a guard.

## Container

```bash
docker build -t keel .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://… \
  -e BETTER_AUTH_SECRET=… \
  -e BETTER_AUTH_URL=https://your-app \
  keel
```

The image is two stages. The runtime carries no package manager, no compiler and no source —
only Next's traced `standalone` output, running as a non-root user. That is most of what
makes it a small attack surface, and it is why migrations do not run from it.

To exercise the whole stack locally, including the migration step and its ordering:

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  docker compose -f docker-compose.prod.yml up --build
```

### Migrations are a release step, not a boot step

`docker-compose.prod.yml` runs them as a separate service, from the **build** stage, which is
the one that still has `drizzle-kit`. The app waits for it to complete successfully before
starting.

Do not migrate on application boot. Every replica would run the migration, concurrently, at
exactly the moment a rolling deploy starts several of them — which turns a deploy into a race
whose failure mode is a half-applied schema. Run it once:

```bash
docker build --target build -t keel-migrate .
docker run --rm -e DATABASE_URL=postgres://… keel-migrate pnpm db:migrate
```

**Migrate before the new code serves, and write migrations that the old code survives.** A
deploy is never atomic: for some window, both versions are running against one schema. Adding
a nullable column or a table is safe; dropping or renaming one takes two deploys — stop using
it, ship, then remove it.

### The worker needs a schedule

Nothing drains the queue on its own. Point a scheduler at the endpoint every minute:

```bash
curl -X POST https://your-app/api/jobs/run -H "Authorization: Bearer $JOBS_SECRET"
```

Reminders, digests, webhook deliveries and the recurring-todo sweep all depend on this. It is
safe to call more often than necessary and safe to call concurrently — jobs are claimed with
`FOR UPDATE SKIP LOCKED`, so two workers never take the same one.

Without it the application looks completely healthy and silently does none of its background
work, which is the failure this line exists to prevent.

## Vercel

Untested here, for the reason at the top. What it needs:

- **Root directory** `apps/web`, with the monorepo build command `pnpm --filter @keel/web build`.
- **`output: 'standalone'` is ignored** — Vercel does its own tracing. Harmless.
- **A pooled `DATABASE_URL`** for the app. Serverless functions open a connection each, and a
  direct connection limit is reached faster than expected. Use the pooled URL for the app and
  the direct one for migrations.
- **Migrations as a separate step**, not in the build command — a build can run for a preview
  deployment that should never touch the production schema.
- **Vercel Cron** for `/api/jobs/run`, with `JOBS_SECRET` in the header.

`X-Forwarded-For` is overwritten by Vercel, which the rate limiter depends on — see the
operator note in `docs/api.md`. Behind a bare `next start` with nothing in front, it is not,
and the address limit can be bypassed by setting the header.

## Anywhere else

The requirements are ordinary: Node 24, a Postgres, the environment above, and something that
calls the worker endpoint on a timer. Fly, Render, Railway and a plain VM all work; the
container is the portable artefact.

## Before the first real deployment

- [ ] `BETTER_AUTH_SECRET` generated fresh, not copied from `.env.example`
- [ ] `BETTER_AUTH_URL` is the real public origin
- [ ] `JOBS_SECRET` set, and a scheduler actually calling the endpoint
- [ ] Migrations run once, from a direct connection, before the new code serves
- [ ] Neither `WEBHOOK_ALLOW_PRIVATE_HOSTS` nor `AUTH_RATE_LIMIT_DISABLED` present — the app
      refuses to start with them, so this is a check you get for free
- [ ] A proxy in front that overwrites `X-Forwarded-For`
- [ ] Database backups, which nothing in this repository does for you
