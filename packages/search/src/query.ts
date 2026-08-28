import { type SQL, sql } from 'drizzle-orm';

/**
 * Turning what someone typed into something Postgres will accept.
 *
 * **Always `websearch_to_tsquery`, never `to_tsquery`.** `to_tsquery` expects an
 * expression — `cat & dog` — and raises a syntax error on anything else. A search box
 * receives `cat dog`, `"exact phrase`, `c++`, `a & | b` and an unmatched bracket, so every
 * codebase that reaches for `to_tsquery` ends up hand-writing a sanitiser, and that
 * sanitiser is where the injection and the 500s live.
 *
 * `websearch_to_tsquery` parses the syntax users already know from search engines —
 * quoted phrases, `or`, leading `-` to exclude — and **cannot fail on any input**. There is
 * nothing to sanitise because there is no syntax to break.
 */

/** The `tsquery` for a user's search box, or null when they have typed nothing useful. */
export function searchQuery(raw: string, config = 'english'): SQL | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return sql`websearch_to_tsquery(${config}, ${trimmed})`;
}

/**
 * Whether a query would match nothing at all.
 *
 * `websearch_to_tsquery('english', 'the')` is empty — every word was a stop word — and an
 * empty tsquery matches no rows. Without this a user searching for "the" gets zero results
 * and no explanation, which reads as a broken index rather than as a search for a word
 * that carries no information.
 */
export function isEmptyQuery(raw: string, config = 'english'): SQL {
  return sql`websearch_to_tsquery(${config}, ${raw.trim()}) = ''::tsquery`;
}
