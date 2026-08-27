import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
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

/**
 * Bring the test database up to the schema when committed migrations lag behind it.
 *
 * Feature branches are forbidden from running `db:generate` — three branches each
 * generating a correct delta still collide on `meta/_journal.json` and on
 * identically-numbered snapshots, so the integrator generates one migration after
 * merging (`.claude/rules/database.md`, [[L-005]]). That rule left a hole: a branch that
 * adds `schema/<feature>.ts` has tables that exist in `schema` and in no migration, so
 * `createTestDatabase()` could not see them and the query layer — the security-critical
 * layer, and the only place a cascade direction can actually be proven — could not be
 * tested at all on the branch that wrote it.
 *
 * The two available workarounds were both bad. Committing a migration reintroduces
 * exactly the conflict the rule exists to prevent. Hand-writing `CREATE TABLE` in the
 * test (as `examples/notes` does, for a table that deliberately has no migration) means
 * the test asserts against DDL the test itself invented — a cascade test written that way
 * proves the fixture is right, not the schema.
 *
 * So the delta is *derived* instead: diff the newest committed snapshot against the live
 * schema with the same drizzle-kit that `db:generate` uses, and apply the result. The
 * statements are byte-for-byte what the integrator's migration will contain, nothing is
 * written to `drizzle/`, and a branch that adds tables tests them against real Postgres
 * with real foreign keys.
 *
 * It costs nothing on an integrated branch: the `information_schema` precheck is one
 * query, and drizzle-kit is only imported when something is genuinely missing. When it
 * does run it runs inside the once-per-process snapshot below, so the cost is paid once
 * and restored from a dump thereafter — [[L-016]] still holds.
 */
async function applyPendingSchema(client: PGlite): Promise<void> {
  const declared = Object.values(schema).map((table) => getTableConfig(table));

  const present = await client.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  );
  const have = new Set(present.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const upToDate = declared.every((table) =>
    table.columns.every((column) => have.has(`${table.name}.${column.name}`)),
  );
  if (upToDate) return;

  const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
  const meta = path.join(migrationsFolder, 'meta');
  const journal = JSON.parse(await fs.readFile(path.join(meta, '_journal.json'), 'utf8')) as {
    entries: { idx: number }[];
  };
  const newest = journal.entries.reduce((highest, entry) => Math.max(highest, entry.idx), -1);
  if (newest < 0) return;

  const committed = JSON.parse(
    await fs.readFile(path.join(meta, `${String(newest).padStart(4, '0')}_snapshot.json`), 'utf8'),
  );
  const statements = await generateMigration(
    committed,
    await generateDrizzleJson(schema as Record<string, unknown>),
  );
  for (const statement of statements) await client.exec(statement);
}

async function migratedSnapshot() {
  snapshot ??= (async () => {
    const client = new PGlite();
    await migrate(drizzle(client, { schema }), { migrationsFolder });
    await applyPendingSchema(client);
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
