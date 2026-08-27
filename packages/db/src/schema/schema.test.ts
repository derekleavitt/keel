import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schemaModule from './index.ts';
import { schema } from './index.ts';

/**
 * Every area module exports a `<area>Tables` group. Discovering them rather than listing
 * them matters: a guard that must be edited each time a feature is added gets edited to
 * pass rather than fixed, and then it is no longer a guard.
 */
const areaTables: Record<string, unknown> = Object.fromEntries(
  Object.entries(schemaModule)
    .filter(([name]) => name.endsWith('Tables'))
    .flatMap(([, group]) => Object.entries(group as Record<string, unknown>)),
);

/**
 * Structural guards on the schema module.
 *
 * These exist because prose could not hold the line. `schema.ts` once carried a header
 * comment stating the opposite of the rule governing it, and six agents read that file
 * without correcting it. A comment does not fail a build; these do.
 *
 * See .orchestration/lessons/L-001.md and L-009.md.
 */

describe('schema assembly', () => {
  it('exposes every table declared by an area module', () => {
    expect(Object.keys(areaTables).length).toBeGreaterThan(0);
    for (const name of Object.keys(areaTables)) {
      expect(schema, `${name} is declared but missing from the assembled schema`).toHaveProperty(
        name,
      );
    }
  });

  it('carries the four tables the Better Auth adapter requires', () => {
    for (const required of ['user', 'session', 'account', 'verification']) {
      expect(schema).toHaveProperty(required);
    }
  });

  it('assembles only from spreads, so parallel branches never edit one literal', () => {
    // Every key in `schema` must originate in an area module rather than being defined
    // inline here. Inline definitions are what made this file a three-way conflict.
    const fromAreas = new Set(Object.keys(areaTables));
    for (const key of Object.keys(schema)) {
      expect(fromAreas.has(key), `${key} is defined inline instead of in an area module`).toBe(
        true,
      );
    }
  });
});

describe('column types that silently break behaviour if changed', () => {
  it('keeps session.expiresAt a timestamp, not a date', () => {
    const columns = getTableConfig(schema.session).columns;
    const expiresAt = columns.find((c) => c.name === 'expires_at');
    expect(expiresAt?.getSQLType()).toBe('timestamp');
  });

  it('cascades session deletion from the owning user', () => {
    const [fk] = getTableConfig(schema.session).foreignKeys;
    expect(fk?.onDelete).toBe('cascade');
  });

  it('never cascades deletion INTO the user table', () => {
    // A cascade pointing the other way would let deleting a session delete the account.
    for (const fk of getTableConfig(schema.user).foreignKeys) {
      expect(fk.onDelete).not.toBe('cascade');
    }
  });
});
