import { expect, type Page, test } from '@playwright/test';

const BASE = 'http://localhost:3000';
const unique = () => `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

async function signUp(page: Page) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('API Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Create a list holding one todo, and return the list's id from the URL. */
async function seedList(page: Page, listName: string, todoTitle: string): Promise<string> {
  await page.goto('/lists');
  await page.getByLabel('New list name').fill(listName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: listName }).click();
  await expect(page.getByRole('heading', { name: listName })).toBeVisible();

  await page.getByLabel('New todo').fill(todoTitle);
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: todoTitle })).toBeVisible();

  const id = new URL(page.url()).pathname.split('/').pop();
  expect(id).toBeTruthy();
  return id as string;
}

/**
 * Mint a key through the UI and read it off the page.
 *
 * Deliberately not through a fixture that reaches into the database: the token is shown
 * exactly once, in one place, and this is the only way a real user obtains one. A test
 * that bypasses the issuing screen would not notice it breaking.
 */
async function mintKey(page: Page, name: string): Promise<string> {
  await page.goto('/settings/api-keys');
  await page.getByLabel('New key name').fill(name);
  await page.getByRole('button', { name: 'Create key' }).click();

  const token = await page.getByLabel('New API key').textContent();
  expect(token).toMatch(/^keel_sk_[0-9a-f]{64}$/);
  return token as string;
}

/** A request context with no cookies, so only the bearer token can authenticate it. */
async function client(playwright: typeof import('@playwright/test').request, token?: string) {
  return playwright.newContext({
    baseURL: BASE,
    extraHTTPHeaders: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test('a key reads the lists it was issued for', async ({ page, playwright }) => {
  await signUp(page);
  await seedList(page, 'Groceries', 'Milk');
  const token = await mintKey(page, 'CI');

  const api = await client(playwright.request, token);
  const response = await api.get('/api/v1/lists');

  expect(response.status()).toBe(200);
  expect(response.headers()['x-keel-api-version']).toBe('v1');
  const body = await response.json();
  expect(body.data.map((row: { name: string }) => row.name)).toEqual(['Groceries']);
  await api.dispose();
});

test('a key can create, read, update and delete through the API', async ({ page, playwright }) => {
  await signUp(page);
  const token = await mintKey(page, 'CRUD');
  const api = await client(playwright.request, token);

  const created = await api.post('/api/v1/lists', { data: { name: 'From the API' } });
  expect(created.status()).toBe(201);
  const listId = (await created.json()).data.id;
  expect(created.headers().location).toBe(`/api/v1/lists/${listId}`);

  const todo = await api.post('/api/v1/todos', { data: { listId, title: 'Ship it' } });
  expect(todo.status()).toBe(201);
  const todoId = (await todo.json()).data.id;

  const read = await api.get(`/api/v1/lists/${listId}`);
  expect(read.status()).toBe(200);
  expect((await read.json()).data.todos.map((t: { title: string }) => t.title)).toEqual([
    'Ship it',
  ]);

  const patched = await api.patch(`/api/v1/todos/${todoId}`, { data: { title: 'Shipped' } });
  expect(patched.status()).toBe(200);
  expect((await patched.json()).data.title).toBe('Shipped');

  expect((await api.delete(`/api/v1/todos/${todoId}`)).status()).toBe(204);
  expect((await api.get(`/api/v1/todos/${todoId}`)).status()).toBe(404);

  // The write is real, not just echoed back: the browser sees it too.
  await page.goto(`/lists/${listId}`);
  await expect(page.getByRole('heading', { name: 'From the API' })).toBeVisible();
  await expect(todoItems(page)).toHaveCount(0);
  await api.dispose();
});

/**
 * The acceptance criterion named in T-15.
 *
 * Two separate accounts, each in its own organization. The second key must not be able to
 * see the first's data by listing, and must not be able to reach it by id either — the
 * second check is the one that matters, because a filtered index with an unfiltered
 * detail route is the classic version of this bug.
 */
test('a key scoped to one organisation cannot read another', async ({
  page,
  browser,
  playwright,
}) => {
  await signUp(page);
  const victimListId = await seedList(page, 'Confidential', 'Secret plan');

  const attacker = await browser.newContext();
  const attackerPage = await attacker.newPage();
  await signUp(attackerPage);
  await seedList(attackerPage, 'Innocuous', 'Buy milk');
  const attackerToken = await mintKey(attackerPage, 'Attacker');

  const api = await client(playwright.request, attackerToken);

  const index = await api.get('/api/v1/lists');
  expect((await index.json()).data.map((row: { name: string }) => row.name)).toEqual(['Innocuous']);

  // 404, not 403: telling the caller the id exists is itself a disclosure.
  const direct = await api.get(`/api/v1/lists/${victimListId}`);
  expect(direct.status()).toBe(404);
  expect((await direct.json()).error.code).toBe('not_found');

  // Nor can it write into the other tenant's list.
  const write = await api.post('/api/v1/todos', {
    data: { listId: victimListId, title: 'Injected' },
  });
  expect(write.status()).toBe(404);

  await api.dispose();
  await attacker.close();
});

test('revoking a key stops it immediately', async ({ page, playwright }) => {
  await signUp(page);
  const token = await mintKey(page, 'Doomed');

  const api = await client(playwright.request, token);
  expect((await api.get('/api/v1/lists')).status()).toBe(200);

  await page.getByRole('button', { name: 'Revoke Doomed' }).click();
  await expect(page.getByRole('button', { name: 'Revoke Doomed' })).toHaveCount(0);

  expect((await api.get('/api/v1/lists')).status()).toBe(401);
  await api.dispose();
});

test('an unauthenticated request is refused with a challenge', async ({ playwright }) => {
  const api = await client(playwright.request);
  const response = await api.get('/api/v1/lists');

  expect(response.status()).toBe(401);
  expect(response.headers()['www-authenticate']).toContain('Bearer');
  expect((await response.json()).error.code).toBe('unauthenticated');
  await api.dispose();
});

test('a malformed body is refused with a usable message', async ({ page, playwright }) => {
  await signUp(page);
  const token = await mintKey(page, 'Validation');
  const api = await client(playwright.request, token);

  const empty = await api.post('/api/v1/lists', { data: { name: '' } });
  expect(empty.status()).toBe(400);
  expect((await empty.json()).error.code).toBe('invalid_body');

  const garbage = await api.post('/api/v1/lists', {
    headers: { 'content-type': 'application/json' },
    data: 'not json at all',
  });
  expect(garbage.status()).toBe(400);
  await api.dispose();
});

test('the key list never shows a usable token', async ({ page }) => {
  await signUp(page);
  const token = await mintKey(page, 'Hinted');

  // Reload: the one-time reveal is component state and must not survive a navigation.
  await page.goto('/settings/api-keys');
  await expect(page.getByRole('list', { name: 'API keys' })).toContainText('Hinted');
  await expect(page.getByLabel('New API key')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(token);
});

/**
 * The pay-off from T-14's decision to put `audit()` in the query layer.
 *
 * Nothing in the API route mentions the audit log. The entry exists because the endpoint
 * calls the same `createTodo()` the browser does — which is the whole argument for
 * auditing beside the write rather than in the server action. Had the recording lived in
 * the action layer, this test would show an empty feed.
 */
test('activity made through the API appears in the audit log', async ({ page, playwright }) => {
  await signUp(page);
  const listId = await seedList(page, 'Tracked', 'From the browser');
  const token = await mintKey(page, 'Auditing');

  const api = await client(playwright.request, token);
  const created = await api.post('/api/v1/todos', {
    data: { listId, title: 'From a machine' },
  });
  expect(created.status()).toBe(201);
  await api.dispose();

  await page.goto('/activity');
  const feed = page.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText('added “From a machine”');
  await expect(feed).toContainText('created the API key “Auditing”');
});
