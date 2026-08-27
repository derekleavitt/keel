import { expect, type Page, test } from '@playwright/test';

const unique = () => `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUpWithList(page: Page, listName: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Search Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await openList(page, listName, true);
}

async function openList(page: Page, listName: string, create = false) {
  await page.goto('/lists');
  if (create) {
    await page.getByLabel('New list name').fill(listName);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByRole('link', { name: listName }).click();
  await expect(page.getByRole('heading', { name: listName })).toBeVisible();
}

async function quickAdd(page: Page, title: string) {
  await page.getByLabel('New todo').fill(title);
  await page.getByLabel('New todo').press('Enter');
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();
}

async function search(page: Page, query: string) {
  await page.goto('/search');
  await page.getByLabel('Search todos').fill(query);
  await page.getByRole('button', { name: 'Search' }).click();
}

test('search finds todos across lists and says where each lives', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Buy milk');

  await openList(page, 'Home', true);
  await quickAdd(page, 'Milk the cow');

  await search(page, 'milk');

  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Work' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByText('2 results')).toBeVisible();
});

test('a typed percent sign is literal, not a wildcard', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, '50% done');
  await quickAdd(page, '50 things');

  await search(page, '50%');

  // Unescaped, "50%" as a LIKE pattern would match both.
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem').first()).toContainText('50% done');
});

test('a typed underscore is literal, not a single-character wildcard', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'snake_case');
  await quickAdd(page, 'snakeXcase');

  await search(page, 'snake_case');

  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem').first()).toContainText('snake_case');
});

test('an empty search shows everything rather than nothing', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'One');
  await quickAdd(page, 'Two');

  await page.goto('/search');
  await expect(page.getByRole('listitem')).toHaveCount(2);

  // And clearing a query returns to everything, rather than emptying the screen.
  await search(page, 'One');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await search(page, '');
  await expect(page.getByRole('listitem')).toHaveCount(2);
});

test('no match says so, quoting what was searched', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Buy milk');

  await search(page, 'zzzznothing');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await expect(page.getByText(/zzzznothing/)).toBeVisible();
});

test('the query lives in the URL, so results survive a reload', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Buy milk');

  await search(page, 'milk');
  expect(page.url()).toContain('q=milk');

  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByLabel('Search todos')).toHaveValue('milk');
});

test('one user never finds another user’s todos', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Secret milk');
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signUpWithList(page, 'Mine');
  await search(page, 'milk');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
});
