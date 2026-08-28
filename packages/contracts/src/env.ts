import process from 'node:process';
import { z } from 'zod';

/**
 * Server-side environment contract.
 *
 * Every variable the system depends on is declared here and nowhere else, so the
 * graph layer can treat env vars as first-class nodes and `verify` can prove that
 * nothing reads an undeclared variable.
 */
const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
    /**
     * Shared secret for the job worker endpoint. A scheduler has no session, and an
     * unauthenticated queue-drain endpoint lets anyone exhaust every job's retry budget.
     * Optional so `pnpm verify` still passes with no `.env`; the endpoint refuses all
     * requests when it is unset, which is the safe default.
     */
    JOBS_SECRET: z.string().min(16).optional(),
    /**
     * Allow webhook endpoints to point at private and loopback addresses.
     *
     * Off by default, and **refused outright in production** by the check below. It exists
     * because the SSRF guard that makes webhooks safe also makes them impossible to exercise
     * locally: a developer's own receiver is on `127.0.0.1`, which is exactly the address the
     * guard is there to block. Without an escape hatch the honest outcome is that nobody
     * tests their webhook code until it is live.
     *
     * The alternative — weakening the guard so localhost is always permitted — would ship the
     * hole to every deployment to make one workflow convenient. See
     * `.orchestration/lessons/L-033.md`.
     */
    WEBHOOK_ALLOW_PRIVATE_HOSTS: z
      .string()
      .optional()
      .transform((value) => value === '1' || value === 'true'),
  })
  .refine(
    (env) => !(env.NODE_ENV === 'production' && env.WEBHOOK_ALLOW_PRIVATE_HOSTS),
    'WEBHOOK_ALLOW_PRIVATE_HOSTS must not be set in production — it disables the SSRF guard',
  );

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/**
 * Parse and cache the server environment.
 *
 * Deliberately lazy: importing this module must never throw, so that typecheck,
 * lint and unit tests all run in an environment with no secrets present.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}\n\nSee .env.example`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: clear the memoised environment. */
export function resetServerEnv(): void {
  cached = undefined;
}

export { serverSchema };
