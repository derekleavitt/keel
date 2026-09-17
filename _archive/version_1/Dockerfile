# syntax=docker/dockerfile:1

# Keel — production image.
#
# Two stages. A third "deps" stage is the usual pattern and does not work here: pnpm installs
# a symlink farm into `node_modules`, and copying that between stages turns the links into
# plain directories, so the next install redoes the work anyway. The pnpm store cache mount
# gives the same layer-caching benefit without the pretence.
#
# The runtime stage carries no package manager, no compiler and no source — only Next's traced
# output. Size is the lesser benefit; the real one is that nothing in the image can install or
# build anything if somebody gets into it.

# --------------------------------------------------------------------------- build
FROM node:24-alpine AS build
WORKDIR /app

# Corepack pins the package manager from package.json, so the image cannot silently build with
# a different pnpm than the lockfile was written by.
RUN corepack enable

# pnpm refuses to remove an existing modules directory without a TTY to confirm on. There is
# no TTY in a build, and the answer is always yes.
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

# Built with no real environment.
#
# `next build` must not need secrets — that is exactly what lazy `serverEnv()`, `db()` and
# `auth()` exist to guarantee, and this is where the guarantee is tested. If this step ever
# starts demanding a `DATABASE_URL`, something has been hoisted to module scope. See CLAUDE.md.
RUN pnpm --filter @keel/web build

# ------------------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# A non-root user: the container should not be able to modify its own application code even if
# something in the app is persuaded to try.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs keel

# The standalone bundle brings its own minimal `node_modules`, traced from what the server
# actually imports. Static assets are *not* traced into it and must be copied separately —
# omitting them is the classic "the site loads but has no CSS" deployment.
COPY --from=build --chown=keel:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=keel:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=keel:nodejs /app/apps/web/public ./apps/web/public

# The migrations themselves, so a release step can apply them from this image rather than
# needing a checkout on the host. Running them is a separate command, never the entrypoint —
# see docs/deployment.md for why.
COPY --from=build --chown=keel:nodejs /app/packages/db/drizzle ./packages/db/drizzle

USER keel
EXPOSE 3000

# `server.js` is what standalone emits: Next's own server, with no CLI in between.
CMD ["node", "apps/web/server.js"]
