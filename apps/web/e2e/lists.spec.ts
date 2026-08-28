import { expect, type Page, test } from '@playwright/test';

/** Lists rows, scoped to the lists list — see .orchestration/lessons/L-029.md. */
const rows = (page: Page) => page.getByRole('list', { name: 'Lists' }).getByRole('listitem');

/**
 * Lists, driven through the browser.
 *
 * The query layer is covered by PGlite tests in `testbed/lists`. These prove the parts
 * only a browser can: that a person can actually use the thing, that ordering survives a
 * reload, and that one user never sees another's lists.
 */
const unique = () => `lists-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUp(page: Page): Promise<string> {
  const email = unique();
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('List Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

async function addList(page: Page, name: string) {
  await page.getByLabel('New list name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(rows(page).filter({ hasText: name })).toBeVisible();
}

test('create, rename, reorder and delete a list', async ({ page }) => {
  await signUp(page);
  await page.goto('/lists');
  await expect(page.getByText('No lists yet. Add one above.')).toBeVisible();

  await addList(page, 'Groceries');
  await addList(page, 'Work');

  const items = rows(page);
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('Groceries');

  // Reorder: move Work above Groceries.
  await page.getByRole('button', { name: 'Move Work up' }).click();
  await expect(rows(page).first()).toContainText('Work');

  // Order must survive a reload — position is persisted, not derived.
  await page.reload();
  await expect(rows(page).first()).toContainText('Work');

  // Rename.
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Groceries' })
    .getByRole('button', { name: 'Rename' })
    .click();
  await page.getByLabel('Rename Groceries').fill('Shopping');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(rows(page).filter({ hasText: 'Shopping' })).toBeVisible();

  // Delete.
  await page.getByRole('button', { name: 'Delete Shopping' }).click();
  await expect(rows(page)).toHaveCount(1);
});

test('one user never sees another user’s lists', async ({ page }) => {
  await signUp(page);
  await page.goto('/lists');
  await addList(page, 'Private to first user');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signUp(page);
  await page.goto('/lists');
  await expect(page.getByText('No lists yet. Add one above.')).toBeVisible();
  await expect(page.getByText('Private to first user')).toHaveCount(0);
});

test('an anonymous visitor is redirected away from lists', async ({ page }) => {
  const response = await page.goto('/lists');
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/sign-in/);
});
