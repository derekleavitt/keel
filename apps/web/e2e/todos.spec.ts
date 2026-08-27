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

test('due date and priority persist and survive a reload', async ({ page }) => {
  await signUpWithList(page, 'Planning');
  await quickAdd(page, 'Book flights');

  await page.getByLabel('Due date for Book flights').fill('2026-09-15');
  await expect(page.getByLabel('Due date for Book flights')).toHaveValue('2026-09-15');

  await page.getByLabel('Priority for Book flights').selectOption('high');

  await page.reload();
  // A date stored as a DATE column comes back as the same calendar day, whatever the
  // browser's timezone. A timestamp would shift it.
  await expect(page.getByLabel('Due date for Book flights')).toHaveValue('2026-09-15');
  await expect(page.getByLabel('Priority for Book flights')).toHaveValue('high');
});

test('higher priority sorts first', async ({ page }) => {
  await signUpWithList(page, 'Triage');
  await quickAdd(page, 'Low thing');
  await quickAdd(page, 'Urgent thing');

  await page.getByLabel('Priority for Urgent thing').selectOption('high');
  await expect(page.getByRole('listitem').first()).toContainText('Urgent thing');

  await page.reload();
  await expect(page.getByRole('listitem').first()).toContainText('Urgent thing');
});

test('a due date can be cleared, not just set', async ({ page }) => {
  await signUpWithList(page, 'Clearing');
  await quickAdd(page, 'Dated');

  await page.getByLabel('Due date for Dated').fill('2026-09-15');
  await expect(page.getByLabel('Due date for Dated')).toHaveValue('2026-09-15');

  await page.getByLabel('Due date for Dated').fill('');
  await page.reload();
  await expect(page.getByLabel('Due date for Dated')).toHaveValue('');
});
