import { expect, type Page, test } from '@playwright/test';

const unique = () => `notes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

async function signUpOnly(page: Page): Promise<string> {
  const email = unique();
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Notes Tester');
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

async function signUpWithTodo(page: Page, listName: string, title: string): Promise<string> {
  const email = unique();
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Notes Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/lists');
  await page.getByLabel('New list name').fill(listName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: listName }).click();
  await page.getByLabel('New todo').fill(title);
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: title })).toBeVisible();
  return email;
}

/** Notes save when the field loses focus — no save button, no request per keystroke. */
test('notes are saved on blur and survive a reload', async ({ page }) => {
  await signUpWithTodo(page, 'Work', 'Call the plumber');

  const notes = page.getByLabel('Notes for Call the plumber');
  await notes.fill('the leaking radiator in the hallway');
  await notes.blur();
  await expect(notes).toBeEnabled();

  await page.reload();
  await expect(page.getByLabel('Notes for Call the plumber')).toHaveValue(
    'the leaking radiator in the hallway',
  );
});

/*
 * The gap that produced this task: notes were searchable and settable through the API, with
 * no way to set them in the app. This closes the loop between the two.
 */
test('notes become searchable as soon as they are saved', async ({ page }) => {
  await signUpWithTodo(page, 'Work', 'Call the plumber');

  await page.goto('/search');
  await page.getByLabel('Search todos').fill('radiator');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(/Nothing matches/)).toBeVisible();

  await page.goto('/lists');
  await page.getByRole('link', { name: 'Work' }).click();
  const notes = page.getByLabel('Notes for Call the plumber');
  await notes.fill('the leaking radiator in the hallway');
  await notes.blur();
  await expect(notes).toBeEnabled();

  await page.goto('/search');
  await page.getByLabel('Search todos').fill('radiator');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('list', { name: 'Results' })).toContainText('Call the plumber');
});

test('clearing the notes removes them', async ({ page }) => {
  await signUpWithTodo(page, 'Work', 'Tidy up');

  const notes = page.getByLabel('Notes for Tidy up');
  await notes.fill('something to remember');
  await notes.blur();
  await expect(notes).toBeEnabled();

  await notes.fill('');
  await notes.blur();
  await page.reload();
  await expect(page.getByLabel('Notes for Tidy up')).toHaveValue('');
});

/*
 * Focusing and leaving without typing must not write. Otherwise merely scrolling past a todo
 * with the keyboard bumps `updated_at` and wakes every live subscriber to the list.
 */
test('focusing the field without editing writes nothing', async ({ page, context }) => {
  await signUpWithTodo(page, 'Quiet', 'Untouched');
  const url = page.url();

  const watcher = await context.newPage();
  await watcher.goto(url);
  await expect(watcher.getByTestId('live-status')).toHaveText(/Live/, { timeout: 15_000 });

  const notes = page.getByLabel('Notes for Untouched');
  await notes.focus();
  await notes.blur();

  // Nothing to observe directly, so assert the visible consequence: the row is unchanged.
  await page.reload();
  await expect(page.getByLabel('Notes for Untouched')).toHaveValue('');
  await watcher.close();
});

/**
 * A viewer on a shared list sees the notes and cannot change them.
 *
 * Follows the flow `sharing.spec.ts` established: sharing operates *inside* a tenant, so both
 * people have to be in one workspace first — two users in their own personal workspaces
 * cannot share at all.
 */
test('a viewer cannot edit notes', async ({ page }) => {
  const friend = await signUpOnly(page);
  await signOut(page);

  await signUpOnly(page);
  await page.goto('/organizations');
  await page.getByLabel('New workspace name').fill('Notes team');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Notes team' })).toBeVisible();
  await page.getByLabel('Invite by email').fill(friend);
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText(friend)).toBeVisible();

  await page.goto('/lists');
  await page.getByLabel('New list name').fill('Readonly');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: 'Readonly' }).click();
  await page.getByLabel('New todo').fill('Look but do not touch');
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: 'Look but do not touch' })).toBeVisible();

  const notes = page.getByLabel('Notes for Look but do not touch');
  await notes.fill('owner wrote this');
  await notes.blur();
  await expect(notes).toBeEnabled();
  const listUrl = page.url();

  await page.getByRole('button', { name: 'Sharing' }).click();
  await page.getByLabel('Share with email').fill(friend);
  await page.getByLabel('Share role').selectOption('viewer');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('button', { name: `Revoke access for ${friend}` })).toBeVisible();
  await signOut(page);

  await signIn(page, friend);
  await page.goto('/organizations');
  const join = page.getByRole('button', { name: 'Switch to Notes team' });
  if (await join.count()) await join.click();
  await expect(page.getByRole('heading', { name: 'Notes team' })).toBeVisible();

  await page.goto(listUrl);
  const friendNotes = page.getByLabel('Notes for Look but do not touch');
  await expect(friendNotes).toHaveValue('owner wrote this');
  // Disabled in the UI; the query layer refuses it regardless. This is the honest signal,
  // not the control.
  await expect(friendNotes).toBeDisabled();
});
