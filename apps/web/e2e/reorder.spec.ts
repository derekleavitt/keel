import { expect, type Page, test } from '@playwright/test';

const unique = () => `reorder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUpWithList(page: Page, listName: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Reorder Tester');
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

/**
 * Titles in display order.
 *
 * Reads each row's `aria-label` rather than its text: a row also contains a priority
 * select, and its option labels land in `textContent`.
 */
const titles = async (page: Page) =>
  (
    await page
      .getByRole('listitem')
      .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') ?? ''))
  ).map((label) => label.replace(/^Reorder /, ''));

test('dragging a todo to the top reorders it, and the order survives a reload', async ({
  page,
}) => {
  await signUpWithList(page, 'Ordering');
  await quickAdd(page, 'First');
  await quickAdd(page, 'Second');
  await quickAdd(page, 'Third');

  await expect(page.getByRole('listitem').first()).toContainText('First');

  await page.getByLabel('Reorder Third').dragTo(page.getByLabel('Reorder First'));
  await expect(page.getByRole('listitem').first()).toContainText('Third');

  // Position is persisted, not derived — the PRD requires order to survive a reload.
  await page.reload();
  await expect(page.getByRole('listitem').first()).toContainText('Third');
  expect(await titles(page)).toEqual(['Third', 'First', 'Second']);
});

test('dragging downward puts the row below its target', async ({ page }) => {
  await signUpWithList(page, 'Downward');
  await quickAdd(page, 'A');
  await quickAdd(page, 'B');
  await quickAdd(page, 'C');

  await page.getByLabel('Reorder A').dragTo(page.getByLabel('Reorder C'));
  await expect(page.getByRole('listitem').last()).toContainText('A');

  await page.reload();
  expect(await titles(page)).toEqual(['B', 'C', 'A']);
});

test('a completed todo is not draggable', async ({ page }) => {
  await signUpWithList(page, 'Completed');
  await quickAdd(page, 'Done thing');
  await page.getByLabel('Mark Done thing done').check();
  await expect(page.getByLabel(/^Mark Done thing/)).toBeEnabled();

  // Completed rows sink to the bottom by the done sort, so dragging among them would
  // reorder something whose position the user cannot see the effect of.
  await expect(page.getByLabel('Reorder Done thing')).toHaveAttribute('draggable', 'false');
});

test('reordering one list does not disturb another', async ({ page }) => {
  await signUpWithList(page, 'One');
  await quickAdd(page, 'A1');
  await quickAdd(page, 'A2');

  await page.goto('/lists');
  await page.getByLabel('New list name').fill('Two');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: 'Two' }).click();
  await quickAdd(page, 'B1');
  await quickAdd(page, 'B2');
  await page.getByLabel('Reorder B2').dragTo(page.getByLabel('Reorder B1'));
  await expect(page.getByRole('listitem').first()).toContainText('B2');

  await page.goto('/lists');
  await page.getByRole('link', { name: 'One' }).click();
  // Wait for the detail page: without this the assertion can read the /lists rows, which
  // carry no reorder label and come back as empty strings.
  await expect(page.getByRole('heading', { name: 'One' })).toBeVisible();
  expect(await titles(page)).toEqual(['A1', 'A2']);
});
