import { expect, type Page, test } from '@playwright/test';

const unique = () => `todos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUpWithList(page: Page, listName: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Todo Tester');
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

async function quickAdd(page: Page, title: string) {
  await page.getByLabel('New todo').fill(title);
  await page.getByLabel('New todo').press('Enter');
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();
}

test('adding a todo takes one field and one keypress', async ({ page }) => {
  await signUpWithList(page, 'Groceries');
  await expect(page.getByText('Nothing here yet.')).toBeVisible();

  await quickAdd(page, 'Milk');
  await quickAdd(page, 'Bread');

  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('2 outstanding')).toBeVisible();

  // The field clears and keeps focus, so a second todo needs no mouse.
  await expect(page.getByLabel('New todo')).toBeFocused();
  await expect(page.getByLabel('New todo')).toHaveValue('');
});

test('ticking a todo persists, survives a reload, and sinks it to the bottom', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'First');
  await quickAdd(page, 'Second');

  await page.getByLabel('Mark First done').check();
  await expect(page.getByText('1 outstanding')).toBeVisible();

  // Completed sinks below outstanding.
  await expect(page.getByRole('listitem').last()).toContainText('First');

  await page.reload();
  await expect(page.getByLabel('Mark First not done')).toBeChecked();
  await expect(page.getByRole('listitem').last()).toContainText('First');

  // Un-ticking restores the original order.
  await page.getByLabel('Mark First not done').uncheck();
  await expect(page.getByRole('listitem').first()).toContainText('First');
  await expect(page.getByText('2 outstanding')).toBeVisible();
});

test('completing everything says so', async ({ page }) => {
  await signUpWithList(page, 'Short');
  await quickAdd(page, 'Only thing');
  await page.getByLabel('Mark Only thing done').check();
  await expect(page.getByText('All done.')).toBeVisible();
});

test('one user cannot open another user’s list', async ({ page }) => {
  await signUpWithList(page, 'Private');
  const url = page.url();

  await page.goto('/lists');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signUpWithList(page, 'Other');
  const response = await page.goto(url);
  expect(response?.status()).toBe(404);
});
