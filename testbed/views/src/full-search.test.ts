import type { Scope } from '@keel/contracts/ids';
import { createTestDatabase, seedScope, seedSharedOrganization } from '@keel/db/testing';
import { createList, revokeShare, shareList, updateList } from '@keel/testbed-lists';
import { createTodo, deleteTodo, updateTodo } from '@keel/testbed-todos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchEverything } from './full-search.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: Scope;
let stranger: Scope;
let listId: string;

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedScope(database, { id: 'owner' })).scope;
  stranger = (await seedScope(database, { id: 'stranger' })).scope;
  listId = (await createList(owner, { name: 'Kitchen renovation' }, database)).id;
});

afterEach(async () => {
  await database.close();
});

const add = (title: string, notes?: string) =>
  createTodo(owner, { listId, title, notes }, database);

const search = async (scope: Scope, query: string) =>
  (await searchEverything(scope, query, { database })).hits;

describe('finding things', () => {
  it('matches a todo title', async () => {
    await add('Replace the kitchen tap');
    await add('Book a dentist appointment');

    const hits = await search(owner, 'tap');
    expect(hits.map((hit) => hit.title)).toContain('Replace the kitchen tap');
    expect(hits.map((hit) => hit.title)).not.toContain('Book a dentist appointment');
  });

  it('matches text in notes and shows where', async () => {
    await add('Call the plumber', 'They quoted for the leaking radiator in the hallway');

    const [hit] = await search(owner, 'radiator');
    expect(hit?.title).toBe('Call the plumber');
    expect(hit?.snippet).toContain('radiator');
  });

  it('matches a list by name', async () => {
    const hits = await search(owner, 'renovation');
    expect(hits.some((hit) => hit.type === 'list' && hit.title === 'Kitchen renovation')).toBe(
      true,
    );
  });

  /*
   * Full text, not substring: stemming is the difference between a search box and a `LIKE`
   * query, and it is what users assume already works.
   */
  it('matches a different form of the same word', async () => {
    await add('Running the dishwasher');
    expect((await search(owner, 'run')).map((hit) => hit.title)).toContain(
      'Running the dishwasher',
    );
  });

  it('finds both a list and its todos in one search', async () => {
    await add('Kitchen tiles');
    const hits = await search(owner, 'kitchen');
    expect(new Set(hits.map((hit) => hit.type))).toEqual(new Set(['todo', 'list']));
  });
});

describe('ranking', () => {
  /*
   * The weights on the generated column: a title match is `A`, a notes match is `B`. Both
   * are relevant, but the one in the title is what the user meant.
   */
  it('ranks a title match above a notes-only match', async () => {
    await add('Something unrelated', 'a passing mention of skirting');
    await add('Fit the skirting boards');

    const hits = await search(owner, 'skirting');
    expect(hits[0]?.title).toBe('Fit the skirting boards');
  });

  /*
   * `ts_rank` is a function of document length, so a short `list.name` scores far above an
   * equally relevant `todo.notes`. Merging raw ranks would put every list above every todo
   * and look like a deliberate decision. Normalising per source is what makes the weights
   * an explicit choice.
   */
  it('does not let one source dominate purely because its rows are shorter', async () => {
    await add('Kitchen tap', 'kitchen kitchen kitchen');
    const hits = await search(owner, 'kitchen');

    expect(hits[0]?.type).toBe('todo');
    expect(hits.some((hit) => hit.type === 'list')).toBe(true);
  });
});

describe('a search box receives anything', () => {
  /*
   * `to_tsquery` raises a syntax error on every one of these. `websearch_to_tsquery` cannot
   * fail on any input, which is why there is no sanitiser here to get wrong.
   */
  it.each([
    ['an operator', '&'],
    ['unbalanced quotes', '"kitchen'],
    ['an unmatched bracket', '(tap'],
    ['a bare pipe', '|'],
    ['punctuation soup', ':*!&|()'],
    ['an injection attempt', "'; drop table todo; --"],
  ])('survives %s', async (_label, query) => {
    await expect(search(owner, query)).resolves.toBeInstanceOf(Array);
  });

  it('treats a quoted phrase as a phrase', async () => {
    await add('Replace the kitchen tap');
    await add('Tap the kitchen replacement schedule');

    const hits = await search(owner, '"kitchen tap"');
    expect(hits.map((hit) => hit.title)).toEqual(['Replace the kitchen tap']);
  });

  it('excludes a term with a leading minus', async () => {
    await add('Paint the hallway');
    await add('Paint the kitchen');

    const titles = (await search(owner, 'paint -kitchen')).map((hit) => hit.title);
    expect(titles).toContain('Paint the hallway');
    expect(titles).not.toContain('Paint the kitchen');
  });

  it('returns nothing, and does not error, for a stop word', async () => {
    await add('Paint the hallway');
    await expect(search(owner, 'the')).resolves.toEqual([]);
  });

  /*
   * An empty box is not a search, but it is not an empty screen either — a search page that
   * blanks when cleared reads as broken. It lists the caller's todos, and reports
   * `searched: false` so the page can say "nothing here yet" rather than "nothing matches".
   */
  it('an empty query lists todos without counting as a search', async () => {
    await add('Paint the hallway');
    const result = await searchEverything(owner, '   ', { database });

    expect(result.searched).toBe(false);
    expect(result.hits.map((hit) => hit.title)).toContain('Paint the hallway');
    // Lists are excluded here: `/lists` already exists for browsing containers.
    expect(result.hits.every((hit) => hit.type === 'todo')).toBe(true);
  });
});

describe('tenancy', () => {
  /** The acceptance criterion. Search reads across features and must not read across tenants. */
  it('never returns another user’s todos or lists', async () => {
    await add('Confidential kitchen plans');

    expect(await search(stranger, 'kitchen')).toEqual([]);
    expect(await search(stranger, 'renovation')).toEqual([]);
    expect((await search(owner, 'kitchen')).length).toBeGreaterThan(0);
  });

  /*
   * Sharing is the interesting case: search must honour a grant it does not know about,
   * which it does because each source composes `visibleVia` rather than re-deriving one.
   *
   * Note the setup — sharing only exists *within* a tenant, so the recipient has to be a
   * member of the same organization. A share pointing across tenants is not a weaker grant,
   * it is impossible; `visibleListIds` filters by organization on the inner selects.
   */
  it('includes a shared list and its todos for the recipient', async () => {
    const ownerSeed = await seedScope(database, { id: 'o2', email: 'o2@example.test' });
    const friendSeed = await seedScope(database, { id: 'f2', email: 'f2@example.test' });
    const inOrg = await seedSharedOrganization(database, [ownerSeed.user.id, friendSeed.user.id]);
    const sharer = inOrg(ownerSeed.user.id);
    const friend = inOrg(friendSeed.user.id);

    const shared = await createList(sharer, { name: 'Bathroom refit' }, database);
    await createTodo(sharer, { listId: shared.id, title: 'Order the bathroom tiles' }, database);
    await shareList(
      sharer,
      { listId: shared.id, email: 'f2@example.test', role: 'viewer' },
      database,
    );

    const titles = (await search(friend, 'bathroom')).map((hit) => hit.title);
    expect(titles).toContain('Order the bathroom tiles');
    expect(titles).toContain('Bathroom refit');
  });

  /*
   * `visibleVia` is a subquery, not a cached id list, so revoking takes effect on the very
   * next search with nothing to invalidate.
   */
  it('stops returning results the moment a share is revoked', async () => {
    const ownerSeed = await seedScope(database, { id: 'o3', email: 'o3@example.test' });
    const friendSeed = await seedScope(database, { id: 'f3', email: 'f3@example.test' });
    const inOrg = await seedSharedOrganization(database, [ownerSeed.user.id, friendSeed.user.id]);
    const sharer = inOrg(ownerSeed.user.id);
    const friend = inOrg(friendSeed.user.id);

    const shared = await createList(sharer, { name: 'Garage clearout' }, database);
    await createTodo(sharer, { listId: shared.id, title: 'Hire a garage skip' }, database);
    await shareList(
      sharer,
      { listId: shared.id, email: 'f3@example.test', role: 'viewer' },
      database,
    );
    expect((await search(friend, 'garage')).length).toBeGreaterThan(0);

    await revokeShare(sharer, { listId: shared.id, userId: friendSeed.user.id }, database);
    expect(await search(friend, 'garage')).toEqual([]);
  });
});

describe('the index keeps up with writes', () => {
  /*
   * The acceptance criterion, asserted where it actually lives. `todo.search_vector` is a
   * generated column, so there is no indexing step that could lag — a row is searchable in
   * the statement that wrote it. No wait, no retry, no reindex.
   */
  it('a todo is searchable in the transaction that created it', async () => {
    const created = await add('Immediately findable widget');
    const hits = await search(owner, 'widget');
    expect(hits.map((hit) => hit.id)).toContain(created?.id);
  });

  it('editing a title changes what the todo matches', async () => {
    const created = await add('Pelican');
    expect((await search(owner, 'pelican')).length).toBe(1);

    await updateTodo(owner, created?.id ?? '', { title: 'Aardvark' }, database);

    expect(await search(owner, 'pelican')).toEqual([]);
    expect((await search(owner, 'aardvark')).map((hit) => hit.title)).toEqual(['Aardvark']);
  });

  it('adding notes makes their text searchable', async () => {
    const created = await add('Call the plumber');
    expect(await search(owner, 'radiator')).toEqual([]);

    await updateTodo(owner, created?.id ?? '', { notes: 'the leaking radiator' }, database);

    const [hit] = await search(owner, 'radiator');
    expect(hit?.title).toBe('Call the plumber');
  });

  it('renaming a list changes what the list matches', async () => {
    expect((await search(owner, 'renovation')).length).toBe(1);
    await updateList(owner, listId, { name: 'Loft conversion' }, database);

    expect(await search(owner, 'renovation')).toEqual([]);
    expect((await search(owner, 'conversion')).map((hit) => hit.title)).toEqual([
      'Loft conversion',
    ]);
  });

  /*
   * A deleted todo leaves the index with it — there is no tombstone to clean up, because
   * the index is a column on the row.
   */
  it('a deleted todo stops matching', async () => {
    const created = await add('Ephemeral badger');
    expect((await search(owner, 'badger')).length).toBe(1);

    await deleteTodo(owner, created?.id ?? '', database);
    expect(await search(owner, 'badger')).toEqual([]);
  });
});
