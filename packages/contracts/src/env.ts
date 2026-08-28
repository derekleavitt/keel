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
    /**
     * Turn off the auth rate limiter.
     *
     * Exists because the browser suite performs a real sign-up per test, from one address,
     * and would otherwise spend most of its run being throttled — correctly. Refused on a
     * deployed instance by the same check as the webhook hatch: with no limiter, the
     * sign-in endpoint is an unmetered password-guessing oracle.
     */
    AUTH_RATE_LIMIT_DISABLED: z
      .string()
      .optional()
      .transform((value) => value === '1' || value === 'true'),
  })
  /*
   * The hatch is refused on a **deployed** instance, not merely a production *build*.
   *
   * `NODE_ENV=production` alone was the first attempt and it was too blunt: `next start`
   * sets it, so running the production build on your own machine — which is exactly what
   * the browser suite does, and what anyone verifying a build does — became impossible the
   * moment `db:up` wrote the variable into `.env`. A guard that stops you testing your own
   * build is a guard someone deletes.
   *
   * A deployment is distinguished by where it thinks it lives. `BETTER_AUTH_URL` must
   * already be correct for authentication to work at all, so it cannot be quietly wrong to
   * dodge this check — getting it wrong breaks sign-in first.
   */
  .refine(
    (env) => !(env.NODE_ENV === 'production' && isDeployed(env) && env.WEBHOOK_ALLOW_PRIVATE_HOSTS),
    'WEBHOOK_ALLOW_PRIVATE_HOSTS must not be set on a deployed instance — it disables the SSRF guard',
  )
  .refine(
    (env) => !(env.NODE_ENV === 'production' && isDeployed(env) && env.AUTH_RATE_LIMIT_DISABLED),
    'AUTH_RATE_LIMIT_DISABLED must not be set on a deployed instance — it unmeters password guessing',
  );

/** True when this instance is serving a real origin rather than the developer's machine. */
function isDeployed(env: { BETTER_AUTH_URL: string }): boolean {
  try {
    const host = new URL(env.BETTER_AUTH_URL).hostname.toLowerCase();
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]');
  } catch {
    // An unparseable URL is not evidence of being local, and the safe reading is deployed.
    return true;
  }
}

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
