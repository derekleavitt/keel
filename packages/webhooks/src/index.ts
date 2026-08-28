import { randomBytes } from 'node:crypto';
import { serverEnv } from '@keel/contracts/env';
import type { OrganizationId, Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { webhookDelivery, webhookEndpoint } from '@keel/db/schema';
import { enqueue } from '@keel/jobs';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { assertDeliverableUrl } from './url.ts';

export * from './signature.ts';
export * from './url.ts';

/**
 * Outbound webhooks.
 *
 * The shape that matters is the **two-stage** dispatch:
 *
 * 1. A mutation calls `emit()`, which writes exactly one job row — in the mutation's own
 *    transaction. No network, no endpoint lookup, no fan-out. This is what keeps a slow or
 *    dead receiver from being able to slow down a request: at write time nobody has been
 *    contacted and nobody can be waited on.
 * 2. The worker expands that one job into one delivery per subscribed endpoint, each with
 *    its own job and its own retry budget.
 *
 * Fanning out inside a single job instead would put every receiver behind the slowest one,
 * and a retry would re-POST to the endpoints that already succeeded. Same reasoning as the
 * digest in T-12 — see `.orchestration/lessons/` and `packages/jobs/src/queue.ts`.
 */

/**
 * How permissive the URL check may be here.
 *
 * Reading the environment can fail — a unit test, a clean checkout, anything that has no
 * `.env`. When it does, this returns the **strictest** policy rather than propagating the
 * error or guessing. A security control that widens because configuration is missing is
 * the wrong failure direction: the environments least likely to be configured are exactly
 * the ones where an accident is least likely to be noticed.
 */
function urlPolicy(): { allowInsecure: boolean; allowPrivate: boolean } {
  try {
    const env = serverEnv();
    return {
      allowInsecure: env.NODE_ENV !== 'production',
      allowPrivate: env.WEBHOOK_ALLOW_PRIVATE_HOSTS,
    };
  } catch {
    return { allowInsecure: false, allowPrivate: false };
  }
}

export const DISPATCH_JOB = 'webhook.dispatch';
export const DELIVER_JOB = 'webhook.deliver';

export interface DispatchPayload {
  organizationId: string;
  event: string;
  payload: Record<string, unknown>;
}

export interface DeliverPayload {
  deliveryId: string;
}

/**
 * Announce that something happened.
 *
 * Pass the transaction that performed the write and the announcement commits with it —
 * so a rolled-back mutation cannot notify anyone that it happened, and a committed one
 * cannot fail to.
 *
 * Cheap enough to call unconditionally: one insert, no lookup of whether anybody is
 * listening. Checking for subscribers here would put a second query on the write path of
 * every mutation to save work in the worker, which is the wrong side to optimise.
 */
export async function emit(
  scope: Scope,
  event: string,
  payload: Record<string, unknown>,
  database: KeelDatabase = db(),
): Promise<void> {
  await enqueue(
    DISPATCH_JOB,
    { organizationId: scope.organizationId, event, payload } satisfies DispatchPayload,
    {},
    database,
  );
}

export interface CreateEndpointInput {
  url: string;
  events: string[];
}

/** Register a receiver. The secret is returned once and shown once. */
export async function createEndpoint(
  scope: Scope,
  input: CreateEndpointInput,
  database: KeelDatabase = db(),
) {
  // Validated here rather than only in the form: this is the boundary every caller
  // crosses, including the API and any future import path.
  assertDeliverableUrl(input.url, urlPolicy());

  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const [row] = await database
    .insert(webhookEndpoint)
    .values({
      id: `whe_${randomBytes(12).toString('hex')}`,
      organizationId: scope.organizationId,
      url: input.url,
      secret,
      events: input.events,
    })
    .returning({ id: webhookEndpoint.id, url: webhookEndpoint.url });
  if (!row) throw new Error('createEndpoint inserted no row');
  return { ...row, secret };
}

export async function listEndpoints(organizationId: OrganizationId, database: KeelDatabase = db()) {
  return database
    .select({
      id: webhookEndpoint.id,
      url: webhookEndpoint.url,
      events: webhookEndpoint.events,
      disabledAt: webhookEndpoint.disabledAt,
      createdAt: webhookEndpoint.createdAt,
    })
    .from(webhookEndpoint)
    .where(eq(webhookEndpoint.organizationId, organizationId))
    .orderBy(desc(webhookEndpoint.createdAt));
}

/** Scoped by organization, so one tenant cannot remove another's endpoint. */
export async function deleteEndpoint(
  scope: Scope,
  id: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  const rows = await database
    .delete(webhookEndpoint)
    .where(
      and(eq(webhookEndpoint.id, id), eq(webhookEndpoint.organizationId, scope.organizationId)),
    )
    .returning({ id: webhookEndpoint.id });
  return rows.length > 0;
}

/**
 * Deliveries, newest first — the answer to "did they get it".
 *
 * Kept separately from the job rows because a successful job is deleted. A queue can say
 * what is failing now; only this can say what was sent yesterday.
 */
export async function listDeliveries(
  organizationId: OrganizationId,
  options: { status?: string; limit?: number } = {},
  database: KeelDatabase = db(),
) {
  const narrowing = [eq(webhookDelivery.organizationId, organizationId)];
  if (options.status) narrowing.push(eq(webhookDelivery.status, options.status));

  return database
    .select({
      id: webhookDelivery.id,
      endpointId: webhookDelivery.endpointId,
      url: webhookEndpoint.url,
      event: webhookDelivery.event,
      status: webhookDelivery.status,
      attempts: webhookDelivery.attempts,
      responseStatus: webhookDelivery.responseStatus,
      lastError: webhookDelivery.lastError,
      createdAt: webhookDelivery.createdAt,
      deliveredAt: webhookDelivery.deliveredAt,
    })
    .from(webhookDelivery)
    .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
    .where(and(...narrowing) ?? narrowing[0])
    .orderBy(desc(webhookDelivery.createdAt))
    .limit(options.limit ?? 100);
}

/**
 * Send a delivery again.
 *
 * Resets the attempt counter rather than continuing it: a replay follows a fix on the
 * receiver's side, so it deserves a full retry budget. The original attempt count is
 * already lost to the reset — which is why `attempts` is a live counter and the durable
 * record of what happened is the audit log and the error text, not this column.
 */
export async function replayDelivery(
  scope: Scope,
  id: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  const rows = await database
    .update(webhookDelivery)
    .set({ status: 'pending', attempts: 0, lastError: null })
    .where(
      and(eq(webhookDelivery.id, id), eq(webhookDelivery.organizationId, scope.organizationId)),
    )
    .returning({ id: webhookDelivery.id });
  if (rows.length === 0) return false;

  await enqueue(DELIVER_JOB, { deliveryId: id } satisfies DeliverPayload, {}, database);
  return true;
}

/**
 * Turn an endpoint back on after it has been disabled.
 *
 * Deliberately manual. Re-enabling on a timer would hammer a receiver that is down for a
 * week; a person re-enabling means somebody believes it is fixed.
 */
export async function enableEndpoint(
  scope: Scope,
  id: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  const rows = await database
    .update(webhookEndpoint)
    .set({ disabledAt: null })
    .where(
      and(
        eq(webhookEndpoint.id, id),
        eq(webhookEndpoint.organizationId, scope.organizationId),
        sql`${webhookEndpoint.disabledAt} is not null`,
      ),
    )
    .returning({ id: webhookEndpoint.id });
  return rows.length > 0;
}

/** Endpoints that should receive an event: subscribed, and not disabled. */
export async function subscribersFor(
  organizationId: string,
  event: string,
  database: KeelDatabase = db(),
) {
  return database
    .select({
      id: webhookEndpoint.id,
      url: webhookEndpoint.url,
      secret: webhookEndpoint.secret,
    })
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.organizationId, organizationId),
        isNull(webhookEndpoint.disabledAt),
        // Containment on the jsonb array: `events @> '["todo.created"]'`.
        sql`${webhookEndpoint.events} @> ${JSON.stringify([event])}::jsonb`,
      ),
    );
}
