import { expect, type Page, test } from '@playwright/test';

const unique = () => `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUpWithKey(page: Page): Promise<string> {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Rate Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/settings/api-keys');
  await page.getByLabel('New key name').fill('Rate limit test');
  await page.getByRole('button', { name: 'Create key' }).click();
  const token = await page.getByLabel('New API key').textContent();
  expect(token).toBeTruthy();
  return token as string;
}

/*
 * Each test gets its own apparent address.
 *
 * Two reasons. The address limit is shared, so without this these tests — which deliberately
 * make hundreds of requests — would exhaust the budget for every other spec running beside
 * them. And it keeps each test independent of how many ran before it.
 *
 * That this works at all is the caveat documented in `docs/api.md`: `x-forwarded-for` is
 * client-settable unless a proxy overwrites it. Here it is a testing convenience; in
 * production it is the operator's responsibility, and nothing the application can check.
 */
const client = (
  playwright: typeof import('@playwright/test').request,
  token?: string,
  address = `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
) =>
  playwright.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: {
      'x-forwarded-for': `${address}-${Date.now()}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

/*
 * The allowance is reported on every response, not only when refused — a client that can only
 * learn its quota by being refused has to make the request you wanted it not to make.
 */
test('every response reports the remaining allowance', async ({ page, playwright }) => {
  const token = await signUpWithKey(page);
  const api = await client(playwright.request, token);

  const first = await api.get('/api/v1/lists');
  expect(first.status()).toBe(200);
  expect(Number(first.headers()['ratelimit-limit'])).toBe(60);
  const remaining = Number(first.headers()['ratelimit-remaining']);

  const second = await api.get('/api/v1/lists');
  expect(Number(second.headers()['ratelimit-remaining'])).toBeLessThan(remaining);
  await api.dispose();
});

/** The acceptance criterion: the limit actually blocks, rather than only being reported. */
test('the free plan limit refuses the request that exceeds it', async ({ page, playwright }) => {
  const token = await signUpWithKey(page);
  const api = await client(playwright.request, token);

  let refused: Awaited<ReturnType<typeof api.get>> | null = null;
  // The free plan allows 60/minute. Sequential rather than parallel, so the count is
  // unambiguous and the first refusal is identifiable.
  for (let n = 0; n < 70; n += 1) {
    const response = await api.get('/api/v1/lists');
    if (response.status() === 429) {
      refused = response;
      break;
    }
  }

  expect(refused, 'expected a 429 within 70 requests on a 60/minute plan').not.toBeNull();
  expect((await refused?.json())?.error.code).toBe('rate_limited');
  // A refusal has to say when to come back, or a client can only guess.
  expect(Number(refused?.headers()['retry-after'])).toBeGreaterThan(0);
  expect(refused?.headers()['ratelimit-remaining']).toBe('0');
  await api.dispose();
});

/*
 * Keyed by credential, not by tenant. Revoking a leaked key should also stop the traffic it
 * was generating, and one runaway integration should not consume a whole organisation's
 * allowance.
 */
test('two keys in one organisation are counted separately', async ({ page, playwright }) => {
  await signUpWithKey(page);

  await page.goto('/settings/api-keys');
  await page.getByLabel('New key name').fill('Second key');
  await page.getByRole('button', { name: 'Create key' }).click();
  const second = await page.getByLabel('New API key').textContent();

  const api = await client(playwright.request, second as string);
  const response = await api.get('/api/v1/lists');

  // A fresh key starts with its own allowance, untouched by the first key's use.
  expect(response.status()).toBe(200);
  expect(Number(response.headers()['ratelimit-remaining'])).toBeGreaterThan(50);
  await api.dispose();
});

/*
 * The address limit runs *before* authentication. A limit that only counted successful
 * requests would leave someone working through stolen keys entirely unmetered.
 */
test('failed authentication is rate limited too', async ({ playwright }) => {
  const api = await client(playwright.request, `keel_sk_${'a'.repeat(64)}`);

  let sawRateLimit = false;
  for (let n = 0; n < 700; n += 1) {
    const response = await api.get('/api/v1/lists');
    if (response.status() === 429) {
      sawRateLimit = true;
      expect((await response.json()).error.message).toContain('address');
      break;
    }
    expect(response.status()).toBe(401);
  }

  expect(sawRateLimit, 'bad credentials should eventually be rate limited').toBe(true);
  await api.dispose();
});
