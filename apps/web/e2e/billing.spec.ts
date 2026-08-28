import { expect, type Page, test } from '@playwright/test';

const unique = () => `bill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUp(page: Page) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Billing Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function addList(page: Page, name: string) {
  await page.goto('/lists');
  await page.getByLabel('New list name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

test('a new tenant starts on the free plan with its usage shown', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings/billing');

  await expect(page.getByRole('heading', { name: 'Free plan' })).toBeVisible();
  await expect(page.getByTestId('billing-status')).toHaveText('active');
  await expect(page.getByRole('list', { name: 'Usage' })).toContainText('0 / 3');
});

/*
 * The acceptance criterion. Enforced in the query layer, so the limit holds regardless of
 * which entry point is used — the API test below calls a completely different one.
 */
test('the plan limit stops list creation, with a message that says what to do', async ({
  page,
}) => {
  await signUp(page);
  for (const name of ['One', 'Two', 'Three']) await addList(page, name);
  await expect(page.getByRole('list', { name: 'Lists' }).getByRole('listitem')).toHaveCount(3);

  await addList(page, 'Four');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('free plan allows 3');
  await expect(page.getByRole('list', { name: 'Lists' }).getByRole('listitem')).toHaveCount(3);

  await page.goto('/settings/billing');
  await expect(page.getByRole('list', { name: 'Usage' })).toContainText('3 / 3');
});

/** The same limit, reached through the public API — a different endpoint, the same query. */
test('the limit cannot be bypassed through the API', async ({ page, playwright }) => {
  await signUp(page);
  for (const name of ['One', 'Two', 'Three']) await addList(page, name);

  await page.goto('/settings/api-keys');
  await page.getByLabel('New key name').fill('Billing bypass');
  await page.getByRole('button', { name: 'Create key' }).click();
  const token = await page.getByLabel('New API key').textContent();

  const api = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  const response = await api.post('/api/v1/lists', { data: { name: 'Via the API' } });

  // 402, not 500: a plan limit is a fact about the account, and telling an integrator to
  // retry a request that can never succeed is worse than useless.
  expect(response.status()).toBe(402);
  expect((await response.json()).error.code).toBe('limit_exceeded');
  const index = await api.get('/api/v1/lists');
  expect((await index.json()).data).toHaveLength(3);
  await api.dispose();
});

describe_webhooks();

function describe_webhooks() {
  const signature = { 'keel-billing-signature': 'whsec_stub', 'content-type': 'application/json' };

  test('a webhook raises the plan, and the limit moves with it', async ({ page, playwright }) => {
    await signUp(page);
    for (const name of ['One', 'Two', 'Three']) await addList(page, name);
    await addList(page, 'Four');
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();

    await page.goto('/settings/billing');
    // Read from the page rather than the cookie: `keel_org` is only written when someone
    // switches workspace, so a user in their default one has no such cookie at all.
    const organizationId = await page.getByTestId('organization-id').textContent();
    expect(organizationId).toBeTruthy();

    const api = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
    const sent = await api.post('/api/billing/webhook', {
      headers: signature,
      data: {
        id: `evt_${Date.now()}`,
        type: 'subscription.updated',
        createdAt: new Date().toISOString(),
        organizationId,
        plan: 'team',
        status: 'active',
        seats: 10,
      },
    });
    expect(sent.status()).toBe(200);
    expect((await sent.json()).applied).toBe(true);

    await page.goto('/settings/billing');
    await expect(page.getByRole('heading', { name: 'Team plan' })).toBeVisible();

    await addList(page, 'Four');
    await expect(page.getByRole('list', { name: 'Lists' }).getByRole('listitem')).toHaveCount(4);
    await api.dispose();
  });

  /*
   * Providers retry, so the same delivery arrives more than once. A duplicate must answer
   * 200 — anything else makes the provider retry harder and eventually disable the endpoint.
   */
  test('a replayed webhook is accepted and applied once', async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
    const body = {
      id: `evt_dup_${Date.now()}`,
      type: 'subscription.updated',
      createdAt: new Date().toISOString(),
      organizationId: 'org_does_not_exist',
      plan: 'team',
    };

    const first = await api.post('/api/billing/webhook', { headers: signature, data: body });
    const second = await api.post('/api/billing/webhook', { headers: signature, data: body });

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect((await second.json()).reason).toBe('duplicate');
    await api.dispose();
  });

  test('an unsigned webhook is refused', async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
    const response = await api.post('/api/billing/webhook', {
      headers: { 'content-type': 'application/json' },
      data: { id: 'evt_forged', type: 'subscription.updated' },
    });

    expect(response.status()).toBe(400);
    await api.dispose();
  });
}
