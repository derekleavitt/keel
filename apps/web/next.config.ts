import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { NextConfig } from 'next';

/**
 * Load the monorepo root `.env`.
 *
 * Next only reads `.env` from the app directory, so in a monorepo a root `.env` is
 * invisible to the app — while `drizzle-kit`, `pnpm db:migrate` and every script read it
 * from the root. Without this the two disagree, and the failure surfaces at request time
 * as "DATABASE_URL: expected string, received undefined" long after setup appeared to
 * succeed.
 *
 * One file at the root is the single source of truth. Values already in the environment
 * win, so CI and hosting platforms are unaffected.
 */
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  reactStrictMode: true,
  /*
   * `standalone` traces the files the server actually needs into `.next/standalone`, so the
   * runtime image can drop `node_modules` entirely. It matters more in a monorepo than a
   * single app: without it the image has to carry every workspace package's dependencies,
   * including the whole toolchain, because pnpm's symlinked store is not separable by hand.
   *
   * Vercel ignores this — it does its own tracing — so it costs nothing there.
   */
  output: 'standalone',
  // Internal packages ship TypeScript source directly — no build step between
  // editing a package and seeing the effect in the app.
  transpilePackages: [
    '@keel/audit',
    '@keel/rate-limit',
    '@keel/billing',
    '@keel/realtime',
    '@keel/admin',
    '@keel/webhooks',
    '@keel/ui',
    '@keel/auth',
    '@keel/db',
    '@keel/contracts',
    '@keel/runtime',
    '@keel/jobs',
    '@keel/storage',
    '@keel/testbed-attachments',
    '@keel/email',
    '@keel/testbed-reminders',
    '@keel/testbed-views',
    '@keel/testbed-lists',
    '@keel/organizations',
    '@keel/testbed-tags',
    '@keel/testbed-todos',
  ],
  typedRoutes: true,
};

export default config;
