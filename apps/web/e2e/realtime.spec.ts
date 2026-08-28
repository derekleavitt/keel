import { expect, type Page, test } from '@playwright/test';

const unique = () => `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

async function signUp(page: Page, email = unique()): Promise<string> {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Live Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

async function openList(page: Page, name: string, create = false) {
  await page.goto('/lists');
  if (create) {
    await page.getByLabel('New list name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  // The subscription is open once the status line says so.
  await expect(page.getByTestId('live-status')).toHaveText(/Live/, { timeout: 15_000 });
}

/** The acceptance criterion: a change in one session appears in another without a refresh. */
test('a todo added in one tab appears in another', async ({ page, context }) => {
  await signUp(page);
  await openList(page, 'Shared work', true);
  const url = page.url();

  const watcher = await context.newPage();
  await watcher.goto(url);
  await expect(watcher.getByTestId('live-status')).toHaveText(/Live/, { timeout: 15_000 });

  await page.getByLabel('New todo').fill('Appears live');
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: 'Appears live' })).toBeVisible();

  // No reload of the watcher anywhere in this test.
  await expect(todoItems(watcher).filter({ hasText: 'Appears live' })).toBeVisible({
    timeout: 15_000,
  });
  await watcher.close();
});

test('completing a todo in one tab updates the other', async ({ page, context }) => {
  await signUp(page);
  await openList(page, 'Ticking', true);
  await page.getByLabel('New todo').fill('Tick me');
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: 'Tick me' })).toBeVisible();

  const watcher = await context.newPage();
  await watcher.goto(page.url());
  await expect(watcher.getByLabel('Mark Tick me done')).toBeVisible();

  await page.getByLabel('Mark Tick me done').check();
  await expect(page.getByLabel('Mark Tick me not done')).toBeEnabled();

  await expect(watcher.getByLabel('Mark Tick me not done')).toBeChecked({ timeout: 15_000 });
  await watcher.close();
});

/*
 * Subscriptions are authorization-checked server-side, not filtered in the client. A
 * subscriber who names someone else's channel is refused the connection outright.
 */
test('a stranger cannot subscribe to another user’s list', async ({ page, browser }) => {
  await signUp(page);
  await openList(page, 'Private', true);
  const listId = new URL(page.url()).pathname.split('/').pop() ?? '';

  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await signUp(strangerPage);

  const response = await strangerPage.request.get(`/api/realtime?channels=list:${listId}&poll=1`);
  expect(response.status()).toBe(403);
  await stranger.close();
});

test('an anonymous visitor cannot subscribe at all', async ({ browser }) => {
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get('/api/realtime?channels=list:anything&poll=1');
  expect(response.status()).toBe(401);
  await anonymous.close();
});

/*
 * The degraded path is the same endpoint, the same authorization and the same cursor — so
 * it cannot drift from the live one. Driving it directly is how that stays true.
 */
test('polling reports the same changes as the stream', async ({ page }) => {
  await signUp(page);
  await openList(page, 'Polled', true);
  const listId = new URL(page.url()).pathname.split('/').pop() ?? '';
  const channel = `list:${listId}`;

  const first = await page.request.get(`/api/realtime?channels=${channel}&poll=1`);
  expect(first.status()).toBe(200);
  const start = (await first.json()) as { cursor: number; changed: string[] };

  await page.getByLabel('New todo').fill('Polled into existence');
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: 'Polled into existence' })).toBeVisible();

  const second = await page.request.get(
    `/api/realtime?channels=${channel}&poll=1&cursor=${start.cursor}`,
  );
  const after = (await second.json()) as { cursor: number; changed: string[] };

  expect(after.changed).toContain(channel);
  expect(after.cursor).toBeGreaterThan(start.cursor);
});

/*
 * Reconnects recover missed state: a cursor from before a change still reports it, which is
 * exactly what the browser does with `Last-Event-ID` after a dropped connection.
 */
test('a stale cursor recovers changes made while disconnected', async ({ page }) => {
  await signUp(page);
  await openList(page, 'Recovering', true);
  const channel = `list:${new URL(page.url()).pathname.split('/').pop()}`;

  const before = await page.request.get(`/api/realtime?channels=${channel}&poll=1`);
  const mark = ((await before.json()) as { cursor: number }).cursor;

  for (const title of ['One', 'Two']) {
    await page.getByLabel('New todo').fill(title);
    await page.getByLabel('New todo').press('Enter');
    await expect(todoItems(page).filter({ hasText: title })).toBeVisible();
  }

  const resumed = await page.request.get(`/api/realtime?channels=${channel}&poll=1&cursor=${mark}`);
  const recovered = (await resumed.json()) as { cursor: number; changed: string[] };
  expect(recovered.changed).toContain(channel);
  expect(recovered.cursor).toBeGreaterThan(mark);
});
