import type { Scope } from '@keel/contracts/ids';
import { job, webhookDelivery, webhookEndpoint } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { runJobs } from '@keel/jobs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webhookHandlers } from './handlers.ts';
import {
  createEndpoint,
  deleteEndpoint,
  emit,
  listDeliveries,
  listEndpoints,
  replayDelivery,
} from './index.ts';
import { verifySignature } from './signature.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let acme: Scope;
let other: Scope;

beforeEach(async () => {
  database = await createTestDatabase();
  acme = (await seedScope(database, { id: 'acme' })).scope;
  other = (await seedScope(database, { id: 'other' })).scope;
});

afterEach(async () => {
  await database.close();
  vi.unstubAllGlobals();
});

/** Drain the queue, letting jobs scheduled by other jobs run in the same pass. */
const drain = async (passes = 3) => {
  for (let i = 0; i < passes; i += 1) {
    await runJobs(webhookHandlers, { database, limit: 50 });
  }
};

/** A receiver that records what it was sent. */
function receiver(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; body: string; headers: Headers }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: String(init.body),
      headers: new Headers(init.headers as HeadersInit),
    });
    return respond(String(url));
  });
  return calls;
}

const ok = () => new Response('', { status: 200 });

describe('emitting', () => {
  it('writes exactly one job regardless of how many endpoints exist', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    await createEndpoint(acme, { url: 'https://b.test/hook', events: ['todo.created'] }, database);

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);

    /*
     * The property that keeps a slow receiver off the request path: at emit time nothing
     * has been looked up and nobody has been contacted. Fan-out is the worker's problem.
     */
    expect(await database.select().from(job)).toHaveLength(1);
    expect(await database.select().from(webhookDelivery)).toHaveLength(0);
  });

  /*
   * The announcement commits with the write that caused it, so a rolled-back mutation
   * cannot notify anyone that it happened.
   */
  it('is lost when the transaction that emitted it rolls back', async () => {
    await expect(
      database.transaction(async (tx) => {
        await emit(acme, 'todo.created', { id: 'tdo_1' }, tx);
        throw new Error('the mutation failed');
      }),
    ).rejects.toThrow('the mutation failed');

    expect(await database.select().from(job)).toHaveLength(0);
  });
});

describe('dispatch', () => {
  it('creates one delivery per subscribed endpoint', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    await createEndpoint(acme, { url: 'https://b.test/hook', events: ['todo.created'] }, database);
    receiver(ok);

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    const deliveries = await listDeliveries(acme.organizationId, {}, database);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === 'delivered')).toBe(true);
  });

  it('skips endpoints not subscribed to the event', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    await createEndpoint(acme, { url: 'https://b.test/hook', events: ['todo.deleted'] }, database);
    const calls = receiver(ok);

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    expect(calls.map((c) => c.url)).toEqual(['https://a.test/hook']);
  });

  it('skips a disabled endpoint', async () => {
    const endpoint = await createEndpoint(
      acme,
      { url: 'https://a.test/hook', events: ['todo.created'] },
      database,
    );
    await database
      .update(webhookEndpoint)
      .set({ disabledAt: new Date() })
      .where(eq(webhookEndpoint.id, endpoint.id));
    const calls = receiver(ok);

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    expect(calls).toHaveLength(0);
  });

  /** The tenancy boundary: an endpoint hears only its own organisation's events. */
  it('never delivers one organisation’s event to another’s endpoint', async () => {
    await createEndpoint(
      acme,
      { url: 'https://acme.test/hook', events: ['todo.created'] },
      database,
    );
    await createEndpoint(
      other,
      { url: 'https://other.test/hook', events: ['todo.created'] },
      database,
    );
    const calls = receiver(ok);

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    expect(calls.map((c) => c.url)).toEqual(['https://acme.test/hook']);
  });

  it('is a no-op when nobody is listening', async () => {
    const calls = receiver(ok);
    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    expect(calls).toHaveLength(0);
    expect(await database.select().from(webhookDelivery)).toHaveLength(0);
  });
});

describe('delivery', () => {
  it('signs the body so the receiver can verify it', async () => {
    const endpoint = await createEndpoint(
      acme,
      { url: 'https://a.test/hook', events: ['todo.created'] },
      database,
    );
    const calls = receiver(ok);

    await emit(acme, 'todo.created', { id: 'tdo_1', title: 'Milk' }, database);
    await drain();

    const call = calls[0];
    expect(call).toBeDefined();
    // Verified with the shipped verifier and the secret the receiver was given — exactly
    // what an integrator writes on their side.
    expect(
      verifySignature(
        endpoint.secret,
        call?.body ?? '',
        call?.headers.get('keel-signature') ?? null,
      ),
    ).toBe(true);
    expect(JSON.parse(call?.body ?? '{}').data).toEqual({ id: 'tdo_1', title: 'Milk' });
    expect(call?.headers.get('keel-event')).toBe('todo.created');
  });

  it('a signature from a different endpoint’s secret does not verify', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    const impostor = await createEndpoint(
      acme,
      { url: 'https://b.test/hook', events: ['todo.deleted'] },
      database,
    );
    const calls = receiver(ok);

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    const call = calls[0];
    expect(
      verifySignature(
        impostor.secret,
        call?.body ?? '',
        call?.headers.get('keel-signature') ?? null,
      ),
    ).toBe(false);
  });
});

describe('failure', () => {
  it('retries a failing receiver and records why', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    receiver(() => new Response('nope', { status: 500 }));

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    const [delivery] = await listDeliveries(acme.organizationId, {}, database);
    expect(delivery?.status).toBe('pending');
    expect(delivery?.responseStatus).toBe(500);
    expect(delivery?.lastError).toContain('500');
    // Still queued for another attempt rather than dropped.
    expect(await database.select().from(job)).not.toHaveLength(0);
  });

  it('gives up after the attempt budget and disables the endpoint', async () => {
    const endpoint = await createEndpoint(
      acme,
      { url: 'https://a.test/hook', events: ['todo.created'] },
      database,
    );
    receiver(() => new Response('nope', { status: 500 }));
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    // Backoff schedules each retry into the future, so time is advanced rather than waited.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await runJobs(webhookHandlers, {
        database,
        asOf: new Date(Date.now() + attempt * 60 * 60_000),
      });
    }

    const [delivery] = await listDeliveries(acme.organizationId, {}, database);
    expect(delivery?.status).toBe('failed');

    /*
     * A dead receiver that stays subscribed turns every future event into guaranteed
     * failing work that grows with traffic. Disabling is the bound on that.
     */
    const [row] = await listEndpoints(acme.organizationId, database);
    expect(row?.disabledAt).not.toBeNull();
    expect(row?.id).toBe(endpoint.id);
    stderr.mockRestore();
  });

  /** A receiver that accepts the connection and never answers must not hold the worker. */
  it('times out a hanging receiver rather than waiting on it', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      // Never resolves on its own — only the abort signal ends it.
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new Error('The operation was aborted')),
        );
      });
    });

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    vi.useFakeTimers();
    const draining = drain(1);
    await vi.advanceTimersByTimeAsync(11_000);
    await draining;
    vi.useRealTimers();

    const [delivery] = await listDeliveries(acme.organizationId, {}, database);
    expect(delivery?.status).toBe('pending');
    expect(delivery?.lastError).toMatch(/abort/i);
  });
});

describe('replay', () => {
  it('sends a failed delivery again', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    let failing = true;
    receiver(() => (failing ? new Response('', { status: 500 }) : ok()));

    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();
    const [failed] = await listDeliveries(acme.organizationId, {}, database);
    expect(failed?.status).toBe('pending');

    failing = false;
    expect(await replayDelivery(acme, failed?.id ?? '', database)).toBe(true);
    await drain();

    const [replayed] = await listDeliveries(acme.organizationId, {}, database);
    expect(replayed?.status).toBe('delivered');
    expect(replayed?.deliveredAt).not.toBeNull();
  });

  it('refuses to replay another organisation’s delivery', async () => {
    await createEndpoint(acme, { url: 'https://a.test/hook', events: ['todo.created'] }, database);
    receiver(ok);
    await emit(acme, 'todo.created', { id: 'tdo_1' }, database);
    await drain();

    const [delivery] = await listDeliveries(acme.organizationId, {}, database);
    expect(await replayDelivery(other, delivery?.id ?? '', database)).toBe(false);
  });
});

describe('endpoints', () => {
  it('lists only the organisation’s own', async () => {
    await createEndpoint(acme, { url: 'https://acme.test/h', events: ['todo.created'] }, database);
    await createEndpoint(
      other,
      { url: 'https://other.test/h', events: ['todo.created'] },
      database,
    );

    expect((await listEndpoints(acme.organizationId, database)).map((r) => r.url)).toEqual([
      'https://acme.test/h',
    ]);
  });

  it('refuses to delete another organisation’s endpoint', async () => {
    const endpoint = await createEndpoint(
      acme,
      { url: 'https://acme.test/h', events: ['todo.created'] },
      database,
    );
    expect(await deleteEndpoint(other, endpoint.id, database)).toBe(false);
    expect(await deleteEndpoint(acme, endpoint.id, database)).toBe(true);
  });

  it('returns a secret that is not guessable from the row', async () => {
    const endpoint = await createEndpoint(
      acme,
      { url: 'https://acme.test/h', events: ['todo.created'] },
      database,
    );
    expect(endpoint.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    // Unlike an API key this *is* stored, and must be: both sides compute the same HMAC.
    const [row] = await listEndpoints(acme.organizationId, database);
    expect(JSON.stringify(row)).not.toContain(endpoint.secret);
  });
});
