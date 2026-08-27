import type { UserId } from '@keel/contracts/ids';
import type { TodoFilter } from '@keel/contracts/todo';
import { queryBuilder } from '@keel/db/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { buildTodoListQuery } from './queries.ts';

/**
 * User scoping, asserted against the rendered SQL.
 *
 * This is the security-critical property of the whole query layer: whatever combination
 * of filters a caller supplies, the user scope must survive. A behavioural test proves it
 * for the combinations it happens to try; rendering the SQL proves it for **every**
 * combination, including ones nobody has written a test for yet.
 *
 * No connection is involved — `PgDialect` turns a query builder into a string.
 */
const dialect = new PgDialect();
const database = queryBuilder();
const userId = 'usr_scope_probe' as UserId;

/** Every subset of the available filters. 2^4 = 16 combinations. */
function allFilterCombinations(): TodoFilter[] {
  const options: [keyof TodoFilter, TodoFilter[keyof TodoFilter]][] = [
    ['done', true],
    ['priority', ['high', 'low']],
    ['dueOnOrBefore', '2026-06-15'],
    ['tagIds', ['tag_a', 'tag_b']],
  ];

  const combinations: TodoFilter[] = [];
  for (let mask = 0; mask < 1 << options.length; mask += 1) {
    const filter: Record<string, unknown> = {};
    options.forEach(([key, value], index) => {
      if (mask & (1 << index)) filter[key] = value;
    });
    combinations.push(filter as TodoFilter);
  }
  return combinations;
}

describe('user scoping survives every filter combination', () => {
  const combinations = allFilterCombinations();

  it('covers all 16 subsets', () => {
    expect(combinations).toHaveLength(16);
  });

  for (const filter of combinations) {
    const label = Object.keys(filter).length ? Object.keys(filter).join(' + ') : 'no filters';

    it(`scopes by user_id with ${label}`, () => {
      const { sql } = dialect.sqlToQuery(
        buildTodoListQuery(userId, 'lst_probe', filter, database).getSQL(),
      );
      expect(sql).toContain('"user_id" =');
    });
  }

  it('parameterises user-supplied values rather than inlining them', () => {
    // An inlined value is an injection waiting to happen. Drizzle parameterises, and this
    // asserts that it stays that way.
    const { sql, params } = dialect.sqlToQuery(
      buildTodoListQuery(userId, 'lst_probe', { tagIds: ["' or 1=1 --"] }, database).getSQL(),
    );
    expect(sql).not.toContain('1=1');
    expect(params).toContain("' or 1=1 --");
  });
});
