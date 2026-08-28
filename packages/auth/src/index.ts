import { serverEnv } from '@keel/contracts/env';
import { db, schema } from '@keel/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

type Auth = ReturnType<typeof create>;

function create() {
  const env = serverEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db(), { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    /**
     * Rate limiting, stated rather than inherited.
     *
     * Better Auth enables this by default in production and **disables it in development**,
     * which meant it had never run here at all: the browser suite ran against `next dev`
     * until T-19, and the first production-build run failed a quarter of its tests with
     * `429 Too many requests`. The limiter was working correctly; nothing had ever met it.
     *
     * Writing the numbers down rather than inheriting them matters twice: a limit nobody
     * chose is a limit nobody can defend when a customer behind a corporate NAT hits it,
     * and an implicit one is invisible to whoever is debugging the 429.
     *
     * The window is per-IP, which is the limitation worth knowing: everyone behind one
     * office address shares a budget. That is the argument for sign-in being generous
     * rather than tight — password hashing already slows brute force, and a limiter that
     * locks out a whole office is its own outage.
     *
     * See `.orchestration/lessons/L-039.md`.
     */
    rateLimit: {
      enabled: !env.AUTH_RATE_LIMIT_DISABLED,
      window: 60,
      max: 100,
      customRules: {
        // The expensive endpoint and the one worth abusing: each request hashes a password
        // and writes three rows.
        '/sign-up/email': { window: 60, max: 10 },
        '/sign-in/email': { window: 60, max: 20 },
      },
    },
  });
}

let cached: Auth | undefined;

/** The shared auth instance. Lazy for the same reason `db()` is. */
export function auth(): Auth {
  if (!cached) cached = create();
  return cached;
}
