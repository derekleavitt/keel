import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../testing.ts';
import { schema } from './index.ts';

/**
 * Timestamps carry a time zone.
 *
 * `timestamp()` without options is Drizzle's default and stores wall-clock digits with no
 * record of which clock they came from. Nothing breaks until something compares in SQL,
 * and then Postgres reconciles the zone-less column against a zone-aware expression using
 * the *server's* zone — silently, and wrongly, on any server not running in UTC.
 *
 * That is exactly how the job queue came to claim nothing at all: `run_at <= now()` was
 * never true. See .orchestration/lessons/L-025.md.
 */
describe('every instant column carries a time zone', () => {
  const offenders: string[] = [];

  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (column.getSQLType() === 'timestamp') {
        offenders.push(`${config.name}.${column.name}`);
      }
    }
  }

  it('has no zone-less timestamp columns', () => {
    expect(
      offenders,
      'Use timestamp({ withTimezone: true }). A zone-less column compared against now() ' +
        'is reconciled through the server zone and silently returns the wrong answer.',
    ).toEqual([]);
  });
});

describe('comparison against SQL now() resolves correctly', () => {
  it('a past instant is due and a future one is not, whatever the server zone', async () => {
    const database = await createTestDatabase();
    try {
      // Run the comparison under a deliberately non-UTC session zone. Before the
      // conversion this is precisely where the answer went wrong.
      await database.execute(sql`set time zone 'Pacific/Auckland'`);

      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 60_000);

      await database.insert(schema.job).values([
        { id: 'past', kind: 'probe', payload: {}, runAt: past },
        { id: 'future', kind: 'probe', payload: {}, runAt: future },
      ]);

      const due = await database.execute(
        sql`select id from ${schema.job} where run_at <= now() order by id`,
      );
      const rows = due.rows as { id: string }[];

      expect(rows.map((row) => row.id)).toEqual(['past']);
    } finally {
      await database.close();
    }
  });

  it('round-trips an instant unchanged across a non-UTC session', async () => {
    const database = await createTestDatabase();
    try {
      await database.execute(sql`set time zone 'America/Los_Angeles'`);
      const instant = new Date('2026-06-15T12:34:56.000Z');

      await database
        .insert(schema.job)
        .values({ id: 'probe', kind: 'probe', payload: {}, runAt: instant });

      const [row] = await database.select().from(schema.job);
      // The stored value is the same instant, not the same wall-clock digits.
      expect(row?.runAt.toISOString()).toBe(instant.toISOString());
    } finally {
      await database.close();
    }
  });
});
