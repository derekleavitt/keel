import { expect, type Page, test } from '@playwright/test';

/**
 * Todo rows, scoped to the todo list.
 *
 * A bare `getByRole('listitem')` was correct only while the page held exactly one list.
 * Adding the History feed put a second one on it and silently broadened every such
 * query to match activity rows too. See .orchestration/lessons/L-029.md.
 */
const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function signUp(page: Page): Promise<string> {
  const email = `share-${stamp()}@example.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Sharer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function signOut(page: Page) {
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/**
 * Put both users in one workspace.
 *
 * Sharing operates *inside* a tenant, so two people in their own personal workspaces
 * cannot share at all — that is the tenancy boundary, not a bug. Every sharing test
 * therefore starts by creating a workspace and inviting the other person into it.
 */
async function createWorkspaceWith(page: Page, inviteeEmail: string, name: string) {
  await page.goto('/organizations');
  await page.getByLabel('New workspace name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.getByLabel('Invite by email').fill(inviteeEmail);
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText(inviteeEmail)).toBeVisible();
}

async function switchTo(page: Page, name: string) {
  await page.goto('/organizations');
  const button = page.getByRole('button', { name: `Switch to ${name}` });
  if (await button.count()) await button.click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function createListWithTodo(page: Page, listName: string, todo: string) {
  await page.goto('/lists');
  await page.getByLabel('New list name').fill(listName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: listName }).click();
  await expect(page.getByRole('heading', { name: listName })).toBeVisible();
  await page.getByLabel('New todo').fill(todo);
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: todo })).toBeVisible();
  return page.url();
}

async function shareWith(page: Page, email: string, role: 'viewer' | 'editor') {
  await page.getByRole('button', { name: 'Sharing' }).click();
  await page.getByLabel('Share with email').fill(email);
  await page.getByLabel('Share role').selectOption(role);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  // Assert on the revoke button: it is labelled with the grantee's email, so it is unique.
  // Matching on "can edit" also matches the role <option> in the form above it.
  await expect(page.getByRole('button', { name: `Revoke access for ${email}` })).toBeVisible();
}

test('an editor can add to a shared list; a stranger cannot see it at all', async ({ page }) => {
  const friend = await signUp(page);
  await signOut(page);

  await signUp(page);
  await createWorkspaceWith(page, friend, 'Team A');
  const listUrl = await createListWithTodo(page, 'Groceries', 'Milk');
  await shareWith(page, friend, 'editor');
  await signOut(page);

  await signIn(page, friend);
  await switchTo(page, 'Team A');
  await page.goto('/lists');
  await expect(page.getByRole('link', { name: 'Groceries' })).toBeVisible();

  await page.goto(listUrl);
  await expect(page.getByText('Shared with you')).toBeVisible();
  await expect(page.getByText('Milk')).toBeVisible();

  await page.getByLabel('New todo').fill('Bread');
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: 'Bread' })).toBeVisible();
  await signOut(page);

  // A third party sees nothing, and the URL alone gets them nowhere.
  await signUp(page);
  await page.goto('/lists');
  await expect(page.getByRole('link', { name: 'Groceries' })).toHaveCount(0);
  const denied = await page.goto(listUrl);
  expect(denied?.status()).toBe(404);
});

test('a viewer can read but not change anything', async ({ page }) => {
  const friend = await signUp(page);
  await signOut(page);

  await signUp(page);
  await createWorkspaceWith(page, friend, 'Team B');
  const listUrl = await createListWithTodo(page, 'Readonly', 'Look but do not touch');
  await shareWith(page, friend, 'viewer');
  await signOut(page);

  await signIn(page, friend);
  await switchTo(page, 'Team B');
  await page.goto(listUrl);
  await expect(page.getByText('view only')).toBeVisible();
  await expect(page.getByText('Look but do not touch')).toBeVisible();

  // The server refuses even though the control is present — authorization is in the query
  // layer, not the UI.
  await page.getByLabel('New todo').fill('Sneaky');
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: 'Sneaky' })).toHaveCount(0);
});

test('only the owner sees the sharing controls', async ({ page }) => {
  const friend = await signUp(page);
  await signOut(page);

  await signUp(page);
  await createWorkspaceWith(page, friend, 'Team C');
  const listUrl = await createListWithTodo(page, 'Owned', 'Item');
  await expect(page.getByRole('button', { name: 'Sharing' })).toBeVisible();
  await shareWith(page, friend, 'editor');
  await signOut(page);

  await signIn(page, friend);
  await switchTo(page, 'Team C');
  await page.goto(listUrl);
  await expect(page.getByRole('button', { name: 'Sharing' })).toHaveCount(0);
});

test('revoking access takes effect immediately', async ({ page }) => {
  const friend = await signUp(page);
  await signOut(page);

  const owner = await signUp(page);
  await createWorkspaceWith(page, friend, 'Team D');
  const listUrl = await createListWithTodo(page, 'Temporary', 'Item');
  await shareWith(page, friend, 'editor');
  await signOut(page);

  await signIn(page, friend);
  await switchTo(page, 'Team D');
  await page.goto(listUrl);
  await expect(page.getByText('Item')).toBeVisible();
  await signOut(page);

  await signIn(page, owner);
  // Signing out clears the workspace selection, so the owner lands in their personal
  // workspace and must switch back before the shared list is visible.
  await switchTo(page, 'Team D');
  await page.goto(listUrl);
  await page.getByRole('button', { name: 'Sharing' }).click();
  await page.getByRole('button', { name: `Revoke access for ${friend}` }).click();
  await expect(page.getByRole('button', { name: `Revoke access for ${friend}` })).toHaveCount(0);
  await signOut(page);

  await signIn(page, friend);
  await switchTo(page, 'Team D');
  const gone = await page.goto(listUrl);
  expect(gone?.status()).toBe(404);
});

test('a shared list appears in the grantee’s agenda and search', async ({ page }) => {
  const friend = await signUp(page);
  await signOut(page);

  await signUp(page);
  await createWorkspaceWith(page, friend, 'Team E');
  const listUrl = await createListWithTodo(page, 'Joint', 'Shared errand');
  await page.getByLabel('Due date for Shared errand').fill(new Date().toISOString().slice(0, 10));
  await expect(page.getByLabel(/^Mark Shared errand/)).toBeEnabled();
  await shareWith(page, friend, 'viewer');
  await signOut(page);

  await signIn(page, friend);
  await switchTo(page, 'Team E');

  // Cross-feature reads compose the same predicates, so a grant reaches them too.
  await page.goto('/agenda');
  await expect(page.getByText('Shared errand')).toBeVisible();

  await page.goto('/search');
  await page.getByLabel('Search todos').fill('errand');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Shared errand')).toBeVisible();
  expect(listUrl).toContain('/lists/');
});
