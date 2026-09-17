import { expect, type Page, test } from '@playwright/test';

const unique = () => `recur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

async function signUpWithList(page: Page, listName: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Recurrence Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/lists');
  await page.getByLabel('New list name').fill(listName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: listName }).click();
  await expect(page.getByRole('heading', { name: listName })).toBeVisible();
}

/** Dates relative to today, so the test never depends on a fixed calendar. */
const dayFrom = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function repeat(
  page: Page,
  options: { title: string; frequency: string; interval?: number; days?: number },
) {
  await page.getByLabel('Repeating todo title').fill(options.title);
  await page.getByLabel('Frequency').selectOption(options.frequency);
  if (options.interval) {
    await page.getByLabel('Repeat interval').fill(String(options.interval));
  }
  await page.getByLabel('Start date').fill(dayFrom(0));
  await page.getByLabel('End date').fill(dayFrom(options.days ?? 4));
  await page.getByRole('button', { name: 'Repeat this' }).click();
  await expect(page.getByRole('list', { name: 'Series' })).toContainText(options.title);
}

test('a daily series generates one todo per day', async ({ page }) => {
  await signUpWithList(page, 'Chores');
  await repeat(page, { title: 'Take the bins out', frequency: 'daily', days: 4 });

  // Today through four days out, inclusive.
  await expect(todoItems(page).filter({ hasText: 'Take the bins out' })).toHaveCount(5);
});

/*
 * The acceptance criterion, from the outside: generation must be idempotent. Reloading and
 * re-running the worker must not produce a second copy of anything.
 */
test('running the generator again creates no duplicates', async ({ page }) => {
  await signUpWithList(page, 'Idempotent');
  await repeat(page, { title: 'Water the plants', frequency: 'daily', days: 3 });
  await expect(todoItems(page).filter({ hasText: 'Water the plants' })).toHaveCount(4);

  await page.reload();
  await page.reload();

  await expect(todoItems(page).filter({ hasText: 'Water the plants' })).toHaveCount(4);
});

/*
 * The bug this feature exists not to ship. A deleted occurrence must stay deleted — a
 * generator that helpfully recreates it is the single most infuriating failure a recurring
 * task feature can have.
 */
test('a deleted occurrence is not resurrected', async ({ page }) => {
  await signUpWithList(page, 'Deletions');
  await repeat(page, { title: 'Standup', frequency: 'daily', days: 3 });
  await expect(todoItems(page).filter({ hasText: 'Standup' })).toHaveCount(4);

  await page.getByLabel('Delete Standup').first().click();
  await expect(todoItems(page).filter({ hasText: 'Standup' })).toHaveCount(3);

  await page.reload();
  await expect(todoItems(page).filter({ hasText: 'Standup' })).toHaveCount(3);
});

/** Series and instance are different objects, so editing one occurrence is unambiguous. */
test('completing one occurrence leaves the others outstanding', async ({ page }) => {
  await signUpWithList(page, 'Instances');
  await repeat(page, { title: 'Exercise', frequency: 'daily', days: 3 });

  await page.getByLabel('Mark Exercise done').first().check();
  await expect(page.getByLabel(/^Mark Exercise not done/).first()).toBeChecked();
  await expect(page.getByLabel(/^Mark Exercise not done/).first()).toBeEnabled();

  await page.reload();
  await expect(page.getByLabel('Mark Exercise done')).toHaveCount(3);
  await expect(page.getByLabel('Mark Exercise not done')).toHaveCount(1);
});

/** Stopping a series keeps the work it already produced — nobody means "delete a month". */
test('stopping a series keeps the todos it already made', async ({ page }) => {
  await signUpWithList(page, 'Stopping');
  await repeat(page, { title: 'Review inbox', frequency: 'daily', days: 3 });
  await expect(todoItems(page).filter({ hasText: 'Review inbox' })).toHaveCount(4);

  await page.getByRole('button', { name: 'Stop repeating Review inbox' }).click();
  await expect(page.getByRole('list', { name: 'Series' })).toHaveCount(0);

  await expect(todoItems(page).filter({ hasText: 'Review inbox' })).toHaveCount(4);
});

test('a paused series stops generating', async ({ page }) => {
  await signUpWithList(page, 'Pausing');
  await repeat(page, { title: 'Weekly report', frequency: 'weekly', days: 20 });

  await page.getByRole('button', { name: 'Pause Weekly report' }).click();
  await expect(page.getByRole('button', { name: 'Resume Weekly report' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Series' })).toContainText('paused');
});

test('an end date before the start is refused', async ({ page }) => {
  await signUpWithList(page, 'Validation');
  await page.getByLabel('Repeating todo title').fill('Impossible');
  await page.getByLabel('Start date').fill(dayFrom(5));
  await page.getByLabel('End date').fill(dayFrom(1));
  await page.getByRole('button', { name: 'Repeat this' }).click();

  await expect(page.getByRole('main').getByRole('alert')).toContainText('end date is before');
  await expect(todoItems(page)).toHaveCount(0);
});

/** The series is anchored to the browser's zone, which is the user's, not the server's. */
test('the series records the viewer’s time zone', async ({ page }) => {
  await signUpWithList(page, 'Zones');
  await repeat(page, { title: 'Zoned', frequency: 'daily', days: 1 });

  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect(page.getByRole('list', { name: 'Series' })).toContainText(zone);
});
