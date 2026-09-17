import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { schema } from './schema/index.ts';
import { createTestDatabase, seedUser } from './testing.ts';

/**
 * The test database must match the schema, not merely the committed migrations.
 *
 * Feature branches may not run `db:generate` ([[L-005]]), so between writing
 * `schema/<feature>.ts` and the integrator's migration there is a window where a table
 * exists in `schema` and in no migration. Before this guard, `createTestDatabase()` simply
 * did not have those tables, and the query layer — where user scoping and cascade
 * behaviour actually live — could not be tested on the branch that wrote it. The failure
 * was silent in the worst way: `select ... from "tag"` throwing looks like a broken test,
 * not a missing mechanism, and the cheap way out is to hand-write `CREATE TABLE` in the
 * test, which then asserts against DDL the test invented.
 *
 * `applyPendingSchema()` in `testing.ts` closes that window by deriving the delta from the
 * schema. This asserts it stays closed, for every table and column, without naming any of
 * them — a guard that must be edited whenever a feature is added gets edited to pass.
 */
describe('schema coverage', () => {
  it('has every table and column the schema declares, migrated or not', async () => {
    const database = await createTestDatabase();
    try {
      const present = await database.execute<{ table_name: string; column_name: string }>(
        "select table_name, column_name from information_schema.columns where table_schema = 'public'",
      );
      const rows = Array.isArray(present) ? present : (present.rows ?? []);
      const have = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));

      const missing: string[] = [];
      for (const table of Object.values(schema)) {
        const config = getTableConfig(table);
        for (const column of config.columns) {
          if (!have.has(`${config.name}.${column.name}`)) {
            missing.push(`${config.name}.${column.name}`);
          }
        }
      }
      expect(missing, 'declared in schema but absent from the test database').toEqual([]);
    } finally {
      await database.close();
    }
  });
});

describe('test database', () => {
  it('applies committed migrations and round-trips a row', async () => {
    const database = await createTestDatabase();
    try {
      const user = await seedUser(database, { email: 'owner@example.test' });
      const rows = await database.select().from(schema.user);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe('owner@example.test');
      expect(user.emailVerified).toBe(true);
    } finally {
      await database.close();
    }
  });

  it('enforces the unique constraint on email', async () => {
    const database = await createTestDatabase();
    try {
      await seedUser(database, { id: 'a', email: 'dup@example.test' });
      await expect(seedUser(database, { id: 'b', email: 'dup@example.test' })).rejects.toThrow();
    } finally {
      await database.close();
    }
  });

  it('cascades session deletion from the owning user', async () => {
    const database = await createTestDatabase();
    try {
      const user = await seedUser(database);
      const now = new Date();
      await database.insert(schema.session).values({
        id: 'sess_1',
        token: 'tok_1',
        userId: user.id,
        expiresAt: new Date(now.getTime() + 86_400_000),
        createdAt: now,
        updatedAt: now,
      });
      await database.delete(schema.user);
      expect(await database.select().from(schema.session)).toHaveLength(0);
    } finally {
      await database.close();
    }
  });
});
