import { serverEnv } from '@keel/contracts/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema/index.ts';

export * from './schema/index.ts';

type Database = ReturnType<typeof create>;

function create() {
  const client = postgres(serverEnv().DATABASE_URL, { prepare: false });
  return drizzle(client, { schema });
}

let cached: Database | undefined;

/**
 * The shared database handle.
 *
 * Lazy on purpose: importing this module must never open a connection, so that
 * typecheck, lint and unit tests run with no database present.
 */
export function db(): Database {
  if (!cached) cached = create();
  return cached;
}
