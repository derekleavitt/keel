import { expect, type Page, test } from '@playwright/test';

const unique = () => `agenda-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function signUpWithList(page: Page, listName: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Agenda Tester');
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

async function addDated(page: Page, title: string, dueDate: string) {
  await page.getByLabel('New todo').fill(title);
  await page.getByLabel('New todo').press('Enter');
  await expect(
    page.getByRole('list', { name: 'Todos' }).getByRole('listitem').filter({ hasText: title }),
  ).toBeVisible();
  await page.getByLabel(`Due date for ${title}`).fill(dueDate);
  await expect(page.getByLabel(/^Mark /).first()).toBeEnabled();
}

test('the agenda separates overdue from due today and hides the rest', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await addDated(page, 'Late thing', day(-2));
  await addDated(page, 'Today thing', day(0));
  await addDated(page, 'Future thing', day(5));

  await page.goto('/agenda');

  await expect(page.getByRole('heading', { name: 'Overdue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Due today' })).toBeVisible();
  await expect(page.getByText('Late thing')).toBeVisible();
  await expect(page.getByText('Today thing')).toBeVisible();
  await expect(page.getByText('Future thing')).toHaveCount(0);
});

test('the agenda reads across lists and shows where each todo lives', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await addDated(page, 'Work item', day(0));

  await page.goto('/lists');
  await page.getByLabel('New list name').fill('Home');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: 'Home' }).click();
  await addDated(page, 'Home item', day(0));

  await page.goto('/agenda');

  // One view, two lists — the whole reason this feature belongs to no single territory.
  await expect(page.getByText('Work item')).toBeVisible();
  await expect(page.getByText('Home item')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Work' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
});

test('completing a todo removes it from the agenda', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await addDated(page, 'Do this', day(-1));

  await page.goto('/agenda');
  await expect(page.getByText('Do this')).toBeVisible();

  await page.getByRole('link', { name: 'Work' }).click();
  await page.getByLabel('Mark Do this done').check();
  await expect(page.getByLabel(/^Mark Do this/)).toBeEnabled();

  await page.goto('/agenda');
  await expect(page.getByText('Nothing due today.')).toBeVisible();
});

test('an empty agenda says so rather than looking broken', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await page.goto('/agenda');
  await expect(page.getByText('Nothing due today.')).toBeVisible();
});

test('an anonymous visitor is redirected away from the agenda', async ({ page }) => {
  const response = await page.goto('/agenda');
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/sign-in/);
});
