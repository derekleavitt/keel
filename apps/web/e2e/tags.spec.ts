import { expect, type Page, test } from '@playwright/test';

const unique = () => `tags-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUp(page: Page) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Tag Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function addList(page: Page, name: string) {
  await page.goto('/lists');
  await page.getByLabel('New list name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

async function openList(page: Page, name: string) {
  await page.goto('/lists');
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function quickAdd(page: Page, title: string) {
  await page.getByLabel('New todo').fill(title);
  await page.getByLabel('New todo').press('Enter');
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();
}

async function tagInline(page: Page, todoTitle: string, tagName: string) {
  await page.getByLabel(`Add a tag to ${todoTitle}`).fill(tagName);
  await page.getByLabel(`Add a tag to ${todoTitle}`).press('Enter');
}

test('tagging a todo creates the tag inline and survives a reload', async ({ page }) => {
  await signUp(page);
  await addList(page, 'Work');
  await openList(page, 'Work');
  await quickAdd(page, 'Deploy');

  const row = page.getByRole('listitem').filter({ hasText: 'Deploy' });
  await tagInline(page, 'Deploy', 'urgent');

  // The chip appears without waiting for the round trip — the optimistic path from
  // .claude/rules/web.md, which only a browser can check.
  await expect(row.getByText('urgent')).toBeVisible();

  // An optimistic chip has no id yet, so its remove control stays disabled until the
  // server answers. Waiting for it to enable is how this test tells "rendered" from
  // "saved" — reloading before that point cancels the in-flight action, which is exactly
  // what this test did on its first run.
  await expect(page.getByLabel('Remove tag urgent from Deploy')).toBeEnabled();

  await page.reload();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Deploy' }).getByText('urgent'),
  ).toBeVisible();
});

test('the same tag spans lists, and is reused rather than duplicated', async ({ page }) => {
  await signUp(page);
  await addList(page, 'Work');
  await addList(page, 'Home');

  await openList(page, 'Work');
  await quickAdd(page, 'Deploy');
  await tagInline(page, 'Deploy', 'urgent');
  await expect(page.getByRole('listitem').filter({ hasText: 'Deploy' })).toContainText('urgent');

  // A tag created in one list is offered in another: tags are global to the user.
  await openList(page, 'Home');
  await quickAdd(page, 'Bins');
  // The suggestion list on a todo in a *different* list already offers it, which is the
  // observable form of "tags are global to the user, not scoped to a list".
  await expect(page.locator('datalist > option[value="urgent"]').first()).toBeAttached();
  await tagInline(page, 'Bins', 'urgent');
  await expect(page.getByRole('listitem').filter({ hasText: 'Bins' })).toContainText('urgent');

  // Back in the first list the original is untouched — one tag, two lists.
  await openList(page, 'Work');
  await expect(page.getByRole('listitem').filter({ hasText: 'Deploy' })).toContainText('urgent');
});

test('removing a tag from a todo deletes neither the todo nor the tag', async ({ page }) => {
  await signUp(page);
  await addList(page, 'Work');
  await openList(page, 'Work');
  await quickAdd(page, 'Deploy');
  await quickAdd(page, 'Review');
  await tagInline(page, 'Deploy', 'urgent');
  await tagInline(page, 'Review', 'urgent');

  await page.getByLabel('Remove tag urgent from Deploy').click();

  await expect(page.getByRole('listitem').filter({ hasText: 'Deploy' })).not.toContainText(
    'urgent',
  );
  // The todo is still there, and the tag still exists on the other todo.
  await expect(page.getByRole('listitem').filter({ hasText: 'Deploy' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Review' })).toContainText('urgent');

  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('listitem').filter({ hasText: 'Review' })).toContainText('urgent');
});
