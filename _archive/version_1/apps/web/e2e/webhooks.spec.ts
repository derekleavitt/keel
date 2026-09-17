import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { verifySignature } from '@keel/webhooks/signature';
import { expect, type Page, test } from '@playwright/test';

const unique = () => `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

/**
 * The worker secret, read from `.env`.
 *
 * The dev server loads `.env` itself; this process does not inherit it, and the test has
 * to authenticate to the drain endpoint the same way a scheduler would.
 */
function envValue(key: string): string {
  const file = readFileSync(path.join(process.cwd(), '.env'), 'utf8');
  const match = file.match(new RegExp(`^\\s*${key}=(.*)$`, 'm'));
  const value = match?.[1]?.trim().replace(/^"|"$/g, '');
  if (!value) throw new Error(`${key} is not set in .env — run \`pnpm db:up\``);
  return value;
}

/** A receiver that records every signed POST it is sent. */
type Received = { body: string; signature: string | null; event: string | null };

async function startReceiver(
  respondWith: () => number = () => 200,
): Promise<{ url: string; received: Received[]; close: () => Promise<void>; server: Server }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      received.push({
        body,
        signature: (request.headers['keel-signature'] as string) ?? null,
        event: (request.headers['keel-event'] as string) ?? null,
      });
      response.writeHead(respondWith()).end('ok');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('receiver did not bind a port');

  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    received,
    server,
    /*
     * `closeAllConnections()` before `close()`.
     *
     * `close()` alone waits for every open connection to end, and the delivery worker keeps
     * one alive — so the receiver never shuts down, the test process never becomes idle, and
     * the run hangs until the outer timeout kills it. It looked like a slow suite rather
     * than a leaked socket.
     */
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function signUp(page: Page) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Webhook Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Register an endpoint through the UI and return the secret it shows once. */
async function subscribe(page: Page, url: string, events: string[]): Promise<string> {
  await page.goto('/settings/webhooks');
  await page.getByLabel('Endpoint URL').fill(url);

  for (const event of ['todo.created', 'todo.completed', 'todo.reopened', 'todo.deleted']) {
    const box = page.getByRole('checkbox', { name: event });
    if (events.includes(event)) await box.check();
    else await box.uncheck();
  }

  await page.getByRole('button', { name: 'Add endpoint' }).click();
  const secret = await page.getByLabel('Signing secret').textContent();
  expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
  return secret as string;
}

/** Drain the queue the way a scheduler would, until it reports nothing left to do. */
async function drain(page: Page, passes = 3) {
  for (let i = 0; i < passes; i += 1) {
    const response = await page.request.post('/api/jobs/run', {
      headers: { authorization: `Bearer ${envValue('JOBS_SECRET')}` },
    });
    expect(response.status()).toBe(200);
  }
}

async function addTodo(page: Page, listName: string, title: string) {
  await page.goto('/lists');
  await page.getByLabel('New list name').fill(listName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: listName }).click();
  await page.getByLabel('New todo').fill(title);
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: title })).toBeVisible();
}

/**
 * The whole loop, against a receiver that is a real HTTP server.
 *
 * Every unit test of delivery stubs `fetch`, which proves the logic and cannot prove that
 * a receiver on the other side of a socket can verify what actually arrives. That is the
 * gap this closes: the signature is checked here with the shipped verifier, over the bytes
 * the server really sent.
 */
test('a todo event reaches a subscribed receiver, correctly signed', async ({ page }) => {
  const receiver = await startReceiver();
  try {
    await signUp(page);
    const secret = await subscribe(page, receiver.url, ['todo.created']);
    await addTodo(page, 'Work', 'Ship the webhook');
    await drain(page);

    await expect.poll(() => receiver.received.length, { timeout: 10_000 }).toBe(1);
    const delivery = receiver.received[0];
    expect(delivery?.event).toBe('todo.created');

    // Verified exactly as an integrator would, over the bytes that crossed the socket.
    expect(verifySignature(secret, delivery?.body ?? '', delivery?.signature ?? null)).toBe(true);
    expect(JSON.parse(delivery?.body ?? '{}').data.title).toBe('Ship the webhook');

    await page.goto('/settings/webhooks');
    await expect(page.getByRole('list', { name: 'Deliveries' })).toContainText('delivered');
  } finally {
    await receiver.close();
  }
});

test('an event nobody subscribed to is not delivered', async ({ page }) => {
  const receiver = await startReceiver();
  try {
    await signUp(page);
    await subscribe(page, receiver.url, ['todo.deleted']);
    await addTodo(page, 'Work', 'Not interesting');
    await drain(page);

    expect(receiver.received).toHaveLength(0);
  } finally {
    await receiver.close();
  }
});

/**
 * "A slow receiver cannot slow down the app."
 *
 * The receiver here never responds. The mutation that triggers the webhook must still
 * complete at normal speed, because emitting is one insert and nothing is contacted on the
 * request path.
 */
test('a hanging receiver does not slow down the mutation', async ({ page }) => {
  const server = createServer(() => {
    // Accept the connection and never answer.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');

  try {
    await signUp(page);
    await subscribe(page, `http://127.0.0.1:${address.port}/hook`, ['todo.created']);

    await page.goto('/lists');
    await page.getByLabel('New list name').fill('Fast');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('link', { name: 'Fast' }).click();

    const started = Date.now();
    await page.getByLabel('New todo').fill('Should be instant');
    await page.getByLabel('New todo').press('Enter');
    await expect(todoItems(page).filter({ hasText: 'Should be instant' })).toBeVisible();

    // The delivery timeout alone is 10s. Anything near that means the receiver is on the
    // request path, which is the bug this asserts against.
    expect(Date.now() - started).toBeLessThan(5000);
  } finally {
    // Same reason as above: this receiver is deliberately holding a request open.
    server.closeAllConnections();
    server.close();
  }
});

test('a failing receiver is recorded and can be replayed', async ({ page }) => {
  let status = 500;
  const receiver = await startReceiver(() => status);
  try {
    await signUp(page);
    await subscribe(page, receiver.url, ['todo.created']);
    await addTodo(page, 'Work', 'Will fail first');
    /*
     * Two passes, not one. `runJobs` fixes its "now" at the start of a pass, so the
     * delivery job the dispatch enqueues has a `run_at` after that instant and is not
     * claimable until the next one. Stage one and stage two are always a pass apart.
     */
    await drain(page, 2);

    await page.goto('/settings/webhooks');
    const deliveries = page.getByRole('list', { name: 'Deliveries' });
    await expect(deliveries).toContainText('500');

    status = 200;
    const replay = page.getByRole('button', { name: /^Replay / }).first();
    await replay.click();
    /*
     * Replay re-queues; it does not deliver. The button stays until a worker pass actually
     * succeeds, which is the honest UI — waiting for it to vanish here would be waiting for
     * something the click never promised.
     */
    await expect(replay).toBeEnabled();
    await drain(page, 2);

    await page.goto('/settings/webhooks');
    await expect(page.getByRole('list', { name: 'Deliveries' })).toContainText('delivered');
    await expect(page.getByRole('button', { name: /^Replay / })).toHaveCount(0);
  } finally {
    await receiver.close();
  }
});

/**
 * The SSRF guard, from the outside.
 *
 * The cloud metadata address stays refused even though this environment has the
 * private-host hatch enabled — the hatch is for reaching a developer's own machine, and
 * that is never it.
 */
test('an endpoint cannot be pointed at cloud metadata', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings/webhooks');
  await page.getByLabel('Endpoint URL').fill('http://169.254.169.254/latest/meta-data/');
  await page.getByRole('button', { name: 'Add endpoint' }).click();

  await expect(page.getByRole('main').getByRole('alert')).toContainText('not reachable');
  await expect(page.getByRole('list', { name: 'Endpoints' })).toHaveCount(0);
});
