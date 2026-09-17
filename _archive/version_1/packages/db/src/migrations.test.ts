import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static checks on committed migration SQL.
 *
 * These catch a class of failure the PGlite suite structurally cannot: a test database is
 * always empty, so a migration that only breaks on a table with rows in it applies
 * cleanly there and fails the first time it meets production.
 *
 * See .orchestration/lessons/L-018.md.
 */
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

const migrations = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => ({ file, sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8') }));

describe('committed migrations', () => {
  it('exist', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('never add a NOT NULL column without a DEFAULT', () => {
    // `$defaultFn()` is a JavaScript-side default and never reaches SQL. A column added
    // this way succeeds on an empty database and fails on a populated one.
    const offenders: string[] = [];

    for (const { file, sql } of migrations) {
      for (const statement of sql.split('--> statement-breakpoint')) {
        const addColumn = /ALTER TABLE\s+.+?\s+ADD COLUMN\s+(.+)/is.exec(statement);
        if (!addColumn) continue;

        const clause = addColumn[1] ?? '';
        const notNull = /\bNOT\s+NULL\b/i.test(clause);
        const hasDefault = /\bDEFAULT\b/i.test(clause);
        if (notNull && !hasDefault) {
          offenders.push(`${file}: ${clause.trim().split('\n')[0]}`);
        }
      }
    }

    expect(
      offenders,
      'Adding a NOT NULL column with no DEFAULT fails on any table that already has rows. ' +
        'Use .default(value) in the schema — .$defaultFn() is JavaScript-only and never reaches SQL.',
    ).toEqual([]);
  });

  it('never drop a column or table in the same migration that adds its replacement', () => {
    // A rename split into DROP + ADD loses the data silently.
    const offenders: string[] = [];
    for (const { file, sql } of migrations) {
      const drops = /\bDROP\s+(COLUMN|TABLE)\b/i.test(sql);
      const adds = /\bADD COLUMN\b/i.test(sql);
      if (drops && adds) offenders.push(file);
    }
    expect(
      offenders,
      'A migration that both drops and adds is usually a rename that will lose data. ' +
        'Split it, or write the data migration explicitly.',
    ).toEqual([]);
  });
});
