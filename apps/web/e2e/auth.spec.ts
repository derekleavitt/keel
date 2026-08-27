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
