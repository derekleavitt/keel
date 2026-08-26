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
  });
}

let cached: Auth | undefined;

/** The shared auth instance. Lazy for the same reason `db()` is. */
export function auth(): Auth {
  if (!cached) cached = create();
  return cached;
}
