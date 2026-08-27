import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema } from './schema/index.ts';

/**
 * A real Postgres, in memory, for tests.
 *
 * The query layer is the security-critical code in this repo — user scoping is enforced
 * there, not in the UI — so it has to be executable in tests rather than merely
 * typechecked. PGlite is actual Postgres compiled to WASM: real constraints, real
 * cascades, real transactions, no server and no cleanup.
 *
 * Migrations are applied from `drizzle/`, so a test failing here means the committed
 * migrations are wrong — which is exactly what you want to find out.
 */
export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/**
 * Migrations are applied once per process, then snapshotted.
 *
 * Applying every migration for every test is O(tests x migrations), and it does not stay
 * cheap: four migrations in, CI was timing out at vitest's 5s default while the same suite
 * passed locally in well under a second. That flake — green on the developer's machine,
 * red in CI — is the fastest way to teach a team to stop trusting the gate.
 *
 * PGlite can dump a migrated data directory and load it back, so each test gets a fresh,
 * fully-isolated database from a snapshot instead of a migration run.
 */
let snapshot: Promise<Blob | File> | undefined;

async function migratedSnapshot() {
  snapshot ??= (async () => {
    const client = new PGlite();
    await migrate(drizzle(client, { schema }), { migrationsFolder });
    const dump = await client.dumpDataDir('none');
    await client.close();
    return dump;
  })();
  return snapshot;
}

export async function createTestDatabase() {
  const client = new PGlite({ loadDataDir: await migratedSnapshot() });
  const database = drizzle(client, { schema });
  return Object.assign(database, {
    async close() {
      await client.close();
    },
  });
}

/**
 * Insert a user directly, bypassing auth.
 *
 * Nearly every query test needs two users — one to own the data and one to prove they
 * cannot see it. Cross-user isolation is the assertion that matters most.
 */
export async function seedUser(
  database: TestDatabase,
  overrides: { id?: string; email?: string; name?: string } = {},
) {
  const id = overrides.id ?? `usr_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date();
  const [row] = await database
    .insert(schema.user)
    .values({
      id,
      name: overrides.name ?? 'Test User',
      email: overrides.email ?? `${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('seedUser failed to insert');
  return row;
}

/** Skip PGlite-backed suites when a platform cannot run WASM Postgres. */
export const canRunTestDatabase = process.env.KEEL_SKIP_PGLITE !== '1';
