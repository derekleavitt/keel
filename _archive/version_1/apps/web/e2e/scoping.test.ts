import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

/**
 * A static check over the browser specs, not a browser test.
 *
 * Adding the History feed to `/lists/[id]` broke nine tests across five files that had
 * nothing to do with the audit log. Every one of them asked for `getByRole('listitem')`
 * with no container — a query that meant "the todos" only for as long as the page held
 * exactly one list. The second list changed the answer without changing the tests.
 *
 * A browser test cannot guard against this: it only fails once someone has already added
 * the element that breaks it, which is precisely too late. Reading the specs does.
 *
 * See `.orchestration/lessons/L-029.md`.
 */
const E2E = path.join(process.cwd(), 'e2e');

/** Roles that repeat on a page, so an unscoped query is a coincidence rather than a selector. */
const AMBIGUOUS = [
  'listitem',
  'row',
  'cell',
  'listbox',
  'option',
  'article',
  'figure',
  /*
   * `alert` is ambiguous on every page in this app, not just crowded ones: Next renders its
   * own `role="alert"` route announcer into every document. An unscoped `getByRole('alert')`
   * is therefore a strict-mode violation from the moment it is written.
   */
  'alert',
];

const specs = readdirSync(E2E)
  .filter((name) => name.endsWith('.spec.ts'))
  .map((name) => ({ name, source: readFileSync(path.join(E2E, name), 'utf8') }));

describe('browser specs scope their role queries', () => {
  it('finds the specs to check', () => {
    expect(specs.length).toBeGreaterThan(5);
  });

  it.each(AMBIGUOUS)('no spec asks for a bare %s', (role) => {
    /*
     * Matches `<something>.getByRole('listitem')` where `<something>` is a bare page
     * handle rather than a narrowed locator. A query chained onto a named list — the form
     * this rule is steering towards — has a `)` before the dot and does not match.
     */
    const bare = new RegExp(String.raw`(?<![)\]])\b(page|\w*Page)\.getByRole\('${role}'`, 'g');

    const offenders = specs.flatMap(({ name, source }) => {
      const hits = source.match(bare);
      return hits ? [`${name}: ${hits.length}× ${hits[0]})`] : [];
    });

    expect(
      offenders,
      `Scope these to a named container, e.g.\n` +
        `  page.getByRole('list', { name: 'Todos' }).getByRole('${role}')\n` +
        `and give the container an aria-label. See .orchestration/lessons/L-029.md.`,
    ).toEqual([]);
  });
});
