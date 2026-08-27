import { expect, type Page, test } from '@playwright/test';

const unique = () => `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUpWithList(page: Page, listName: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Filter Tester');
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

test('an empty list and a filtered-empty list say different things', async ({ page }) => {
  await signUpWithList(page, 'Distinctions');

  // Genuinely empty.
  await expect(page.getByText('Nothing here yet.')).toBeVisible();

  await quickAdd(page, 'Only outstanding thing');

  // Filtered to completed, of which there are none. Same zero rows, different meaning —
  // the PRD calls this out because users read "nothing here" as broken.
  await page.getByLabel('Filter by status').selectOption('true');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByText('No todos match these filters.')).toBeVisible();
  await expect(page.getByText('Nothing here yet.')).toHaveCount(0);
});

test('filters narrow by status and priority, and survive a reload', async ({ page }) => {
  await signUpWithList(page, 'Narrowing');
  await quickAdd(page, 'Urgent item');
  await quickAdd(page, 'Ordinary item');

  await page.getByLabel('Priority for Urgent item').selectOption('high');

  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem').first()).toContainText('Urgent item');

  // Filter state lives in the URL, so it survives a reload and can be shared.
  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  expect(page.url()).toContain('priority=high');

  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
});

test('combining status and priority narrows further', async ({ page }) => {
  await signUpWithList(page, 'Combining');
  await quickAdd(page, 'Done urgent');
  await quickAdd(page, 'Open urgent');

  for (const title of ['Done urgent', 'Open urgent']) {
    await page.getByLabel(`Priority for ${title}`).selectOption('high');
  }

  await page.getByLabel('Mark Done urgent done').check();
  await expect(page.getByText('1 outstanding')).toBeVisible();

  // Submitting the filter is a full navigation, so it must not race the write it is
  // about to filter on. An enabled control means the mutation queue has drained.
  await expect(page.getByLabel(/^Mark Done urgent/)).toBeEnabled();

  await page.getByLabel('Filter by status').selectOption('false');
  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem').first()).toContainText('Open urgent');
});
