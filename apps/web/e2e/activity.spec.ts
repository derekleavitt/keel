import { expect, type Page, test } from '@playwright/test';

/**
 * Todo rows, scoped to the todo list.
 *
 * A bare `getByRole('listitem')` was correct only while the page held exactly one list.
 * Adding the History feed put a second one on it and silently broadened every such
 * query to match activity rows too. See .orchestration/lessons/L-029.md.
 */
const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

const unique = () =>
  `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUp(page: Page): Promise<string> {
  const email = unique();
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Activity Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

async function addList(page: Page, name: string) {
  await page.goto('/lists');
  await page.getByLabel('New list name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

test('the feed records what the user did, and says who did it', async ({ page }) => {
  const email = await signUp(page);
  await addList(page, 'Groceries');

  await page.goto('/activity');
  const feed = page.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText('created the list “Groceries”');
  await expect(feed).toContainText(email);
});

test('a deleted list keeps its history', async ({ page }) => {
  await signUp(page);
  await addList(page, 'Doomed');

  await page.getByLabel('Delete Doomed').click();
  await expect(page.getByRole('link', { name: 'Doomed' })).toHaveCount(0);

  /*
   * The point of the whole design. The list is gone; the record of its deletion is not,
   * because `audit_entry.target_id` carries no foreign key back to it.
   */
  await page.goto('/activity');
  const feed = page.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText('deleted a list');
  await expect(feed).toContainText('created the list “Doomed”');
});

test('todo activity is recorded too', async ({ page }) => {
  await signUp(page);
  await addList(page, 'Work');
  await page.getByRole('link', { name: 'Work' }).click();

  await page.getByLabel('New todo').fill('Write the thing');
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: 'Write the thing' })).toBeVisible();

  await page.getByLabel('Mark Write the thing done').check();
  /*
   * `toBeChecked()` alone is not enough to know the write landed. The checkbox is
   * optimistic (see L-015), so it flips before the server action returns — and the feed on
   * the next page is a static render, so an entry arriving late is never picked up by
   * retries. The row is disabled while a mutation is in flight; waiting for it to come back
   * is the signal that the action actually completed.
   */
  await expect(page.getByLabel('Mark Write the thing not done')).toBeChecked();
  await expect(page.getByLabel('Mark Write the thing not done')).toBeEnabled();

  await page.goto('/activity');
  const feed = page.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText('added “Write the thing”');
  await expect(feed).toContainText('completed “Write the thing”');
});

test('a list page shows only its own history', async ({ page }) => {
  await signUp(page);
  await addList(page, 'Alpha');
  await addList(page, 'Beta');

  await page.getByRole('link', { name: 'Alpha' }).click();
  const history = page.getByRole('list', { name: 'Activity' });
  await expect(history).toContainText('created the list “Alpha”');
  await expect(history).not.toContainText('Beta');
});

test('one tenant never sees another’s activity', async ({ page, browser }) => {
  await signUp(page);
  await addList(page, 'Confidential');

  // A second, unrelated account in its own organisation.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUp(otherPage);
  await addList(otherPage, 'Unrelated');

  await otherPage.goto('/activity');
  const feed = otherPage.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText('Unrelated');
  await expect(feed).not.toContainText('Confidential');
  await other.close();
});
