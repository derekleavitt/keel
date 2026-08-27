import { serverEnv } from '@keel/contracts/env';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema/index.ts';

export * from './schema/index.ts';

type Database = ReturnType<typeof create>;

/**
 * The database type every query helper accepts.
 *
 * Broad enough to cover both the postgres-js handle `db()` returns and the PGlite handle
 * used in tests, so one helper runs in production and against real Postgres in a test.
 *
 * It lives here because this package owns the database. Without it every feature package
 * declares its own `XDatabase = PgDatabase<PgQueryResultHKT, typeof schema>` — five
 * identical aliases and five reasons to depend on drizzle directly, including packages
 * that write no SQL at all.
 */
export type KeelDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

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
