import { expect, test } from '@playwright/test';

/**
 * A real sign-up against a real database.
 *
 * This exists because the auth schema was hand-written from memory of what Better Auth
 * requires, shipped incomplete, and stayed green through every check in the gate — unit
 * tests, typecheck, build, even PGlite tests that exercised the tables directly. Nothing
 * had ever performed an actual sign-up, so a missing `account.issuer` column went
 * unnoticed until someone ran the app.
 *
 * Typechecking a vendor's required schema proves nothing. Only the vendor's own code
 * knows what it needs, and the only way to ask it is to call it.
 *
 * Requires a database: `pnpm db:up && pnpm db:migrate`, then `KEEL_E2E=1`.
 *
 * See .orchestration/lessons/L-010.md.
 */
const unique = () => `signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

test('a new account can be created end to end', async ({ request }) => {
  const email = unique();

  const response = await request.post('/api/auth/sign-up/email', {
    data: { email, password: 'correct-horse-battery-staple', name: 'E2E User' },
  });

  expect(response.status(), `sign-up failed: ${await response.text()}`).toBe(200);

  const body = await response.json();
  expect(body.user?.email).toBe(email);
  expect(body.token, 'a session token must be issued').toBeTruthy();
});

test('signing in with the wrong password is rejected', async ({ request }) => {
  const email = unique();
  await request.post('/api/auth/sign-up/email', {
    data: { email, password: 'correct-horse-battery-staple', name: 'E2E User' },
  });

  const response = await request.post('/api/auth/sign-in/email', {
    data: { email, password: 'definitely-not-the-password' },
  });

  expect(response.status()).not.toBe(200);
});

/**
 * The user-facing half of T-01. These drive the browser rather than the API, because the
 * acceptance criteria are about what a person experiences: a redirect instead of an
 * error, a session that survives a reload, a sign-out that actually signs you out.
 */
test('an anonymous visitor to a protected page is redirected, not errored', async ({ page }) => {
  const response = await page.goto('/dashboard');

  // The distinction that matters: redirected, not a 500.
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('sign up, stay signed in across a reload, then sign out', async ({ page }) => {
  const email = unique();

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Reload Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(email)).toBeVisible();

  // Session survives a reload — the cookie is doing its job, not client state.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // And the protected page is protected again.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('signing in again with the same credentials works', async ({ page }) => {
  const email = unique();
  const password = 'correct-horse-battery-staple';

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Returning User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(email)).toBeVisible();
});
