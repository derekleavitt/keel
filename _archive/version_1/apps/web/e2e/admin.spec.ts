import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, type Page, test } from '@playwright/test';

const unique = () => `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUp(page: Page): Promise<string> {
  const email = unique();
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Admin Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

/**
 * Grant staff access the only way it can be granted: out of band.
 *
 * There is deliberately no in-app path, so the test uses the same script an operator would.
 * A test that reached into the database directly would not notice that script breaking.
 */
function grantStaff(email: string, note = 'e2e') {
  execFileSync('pnpm', ['admin:grant', email, note], {
    cwd: path.resolve(process.cwd()),
    stdio: 'pipe',
  });
}

/*
 * The acceptance criterion named in T-18.
 *
 * 404 rather than 403: confirming that `/admin` exists and is merely forbidden tells an
 * attacker exactly where to spend their time.
 */
test('an ordinary member cannot reach any admin route', async ({ page }) => {
  await signUp(page);

  for (const route of [
    '/admin',
    '/admin/organizations',
    '/admin/users',
    '/admin/jobs',
    '/admin/actions',
  ]) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} should not be reachable`).toBe(404);
  }
});

test('owning an organization does not grant staff access', async ({ page }) => {
  await signUp(page);

  // Every user owns their personal workspace, so if staff were a membership role this
  // would already be enough.
  await page.goto('/lists');
  await page.getByLabel('New list name').fill('Mine');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mine' })).toBeVisible();

  expect((await page.goto('/admin'))?.status()).toBe(404);
});

test('a signed-out visitor is sent to sign in, not shown the area', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/sign-in/);
  await context.close();
});

test('staff can see across organizations, and the visit is recorded', async ({ page }) => {
  const email = await signUp(page);
  grantStaff(email);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  // `getByLabel`, not `getByRole('list')`: a <dl> maps to DescriptionList, not list.
  await expect(page.getByLabel('Summary')).toBeVisible();

  // Scoped: the nav link and the summary card share a name. See L-029.
  await page
    .getByRole('navigation', { name: 'Staff' })
    .getByRole('link', { name: 'Organizations' })
    .click();
  await expect(page.getByRole('list', { name: 'Organizations' })).toBeVisible();

  /*
   * Reads are the majority of what support does. An action log covering only writes cannot
   * answer "who looked at this account", which is the question that actually gets asked.
   */
  await page.goto('/admin/actions');
  await expect(page.getByRole('list', { name: 'Actions' })).toContainText(
    'listed every organization',
  );
  await expect(page.getByRole('list', { name: 'Actions' })).toContainText(email);
});

test('a staff search is recorded and disclosed to nobody it did not touch', async ({ page }) => {
  const email = await signUp(page);
  grantStaff(email);

  await page.goto('/admin/users');
  // The unique half of the address: a prefix would match every account this suite makes.
  await page.getByLabel('Search users').fill(email.split('@')[0]?.slice(-12) ?? email);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('list', { name: 'Users' })).toContainText(email);

  await page.goto('/admin/actions');
  await expect(page.getByRole('list', { name: 'Actions' })).toContainText('searched users');
});

test('revoking staff access closes the door immediately', async ({ page }) => {
  const email = await signUp(page);
  grantStaff(email);
  await expect(page.goto('/admin')).resolves.toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  execFileSync('pnpm', ['admin:grant', '--revoke', email], { stdio: 'pipe' });

  // No session invalidation needed: the check is per request, against the current grant.
  expect((await page.goto('/admin'))?.status()).toBe(404);
});
