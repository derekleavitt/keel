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
 * select and an attachment input, whose option labels land in `textContent`.
 */
const titles = async (page: Page) =>
  (
    await page
      .getByRole('listitem')
      .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') ?? ''))
  ).map((label) => label.replace(/^Reorder /, ''));

/**
 * Reordering is driven by the move buttons, not by dragging.
 *
 * Drag is an enhancement layered on top; these buttons are the interface. Reordering that
 * only works by dragging is unusable with a keyboard, unusable with a screen reader and
 * awkward on a phone — and the buttons are the only path a test can drive deterministically,
 * because HTML5 drag emulation differs between browsers and a row containing a file input
 * has a native drop target competing for the event.
 */
test('moving a todo up reorders it, and the order survives a reload', async ({ page }) => {
  await signUpWithList(page, 'Ordering');
  await quickAdd(page, 'First');
  await quickAdd(page, 'Second');
  await quickAdd(page, 'Third');

  expect(await titles(page)).toEqual(['First', 'Second', 'Third']);

  await page.getByLabel('Move Third up').click();
  await expect(page.getByLabel('Move Third down')).toBeEnabled();
  expect(await titles(page)).toEqual(['First', 'Third', 'Second']);

  // Position is persisted, not derived — the PRD requires order to survive a reload.
  await page.reload();
  expect(await titles(page)).toEqual(['First', 'Third', 'Second']);
});

test('moving a todo down puts it below its neighbour', async ({ page }) => {
  await signUpWithList(page, 'Downward');
  await quickAdd(page, 'A');
  await quickAdd(page, 'B');
  await quickAdd(page, 'C');

  await page.getByLabel('Move A down').click();
  await expect(page.getByLabel('Move A up')).toBeEnabled();
  expect(await titles(page)).toEqual(['B', 'A', 'C']);

  await page.reload();
  expect(await titles(page)).toEqual(['B', 'A', 'C']);
});

test('the ends of the list cannot be moved past', async ({ page }) => {
  await signUpWithList(page, 'Edges');
  await quickAdd(page, 'Top');
  await quickAdd(page, 'Bottom');

  // Disabled rather than hidden: the control stays where the user expects to find it.
  await expect(page.getByLabel('Move Top up')).toBeDisabled();
  await expect(page.getByLabel('Move Bottom down')).toBeDisabled();
  await expect(page.getByLabel('Move Top down')).toBeEnabled();
});

test('a completed todo has no reorder controls', async ({ page }) => {
  await signUpWithList(page, 'Completed');
  await quickAdd(page, 'Done thing');
  await page.getByLabel('Mark Done thing done').check();
  await expect(page.getByLabel(/^Mark Done thing/)).toBeEnabled();

  // Completed rows sink to the bottom by the `done` sort, so moving one would change a
  // position whose effect the user cannot see.
  await expect(page.getByLabel('Move Done thing up')).toHaveCount(0);
  await expect(page.getByLabel('Drag Done thing')).toHaveCount(0);
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

  await page.getByLabel('Move B2 up').click();
  await expect(page.getByLabel('Move B2 down')).toBeEnabled();
  expect(await titles(page)).toEqual(['B2', 'B1']);

  await page.goto('/lists');
  await page.getByRole('link', { name: 'One' }).click();
  await expect(page.getByRole('heading', { name: 'One' })).toBeVisible();
  expect(await titles(page)).toEqual(['A1', 'A2']);
});
