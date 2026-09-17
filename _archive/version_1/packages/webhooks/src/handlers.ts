import { randomBytes } from 'node:crypto';
import { webhookDelivery, webhookEndpoint } from '@keel/db/schema';
import type { JobHandler } from '@keel/jobs';
import { enqueue } from '@keel/jobs';
import { eq } from 'drizzle-orm';
import {
  DELIVER_JOB,
  type DeliverPayload,
  DISPATCH_JOB,
  type DispatchPayload,
  subscribersFor,
} from './index.ts';
import { SIGNATURE_HEADER, signPayload } from './signature.ts';

/** How long a receiver gets before we give up on an attempt. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** Attempts before an endpoint is disabled rather than retried forever. */
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Stage one: expand one event into one delivery per subscriber.
 *
 * Runs in the worker, not on the request path, so the endpoint lookup and the fan-out cost
 * nothing to the user who caused the event.
 */
export const dispatchHandler: JobHandler<DispatchPayload> = {
  kind: DISPATCH_JOB,
  async handle(payload, { database }) {
    const endpoints = await subscribersFor(payload.organizationId, payload.event, database);
    // Nobody listening is the common case and is not an error.
    if (endpoints.length === 0) return;

    for (const endpoint of endpoints) {
      const deliveryId = `whd_${randomBytes(12).toString('hex')}`;
      /*
       * One transaction per endpoint, not one for the batch. A batch means a single
       * failing insert loses every delivery in it, including the ones that were fine.
       */
      await database.transaction(async (tx) => {
        await tx.insert(webhookDelivery).values({
          id: deliveryId,
          endpointId: endpoint.id,
          organizationId: payload.organizationId,
          event: payload.event,
          payload: payload.payload,
        });
        await enqueue(DELIVER_JOB, { deliveryId } satisfies DeliverPayload, {}, tx);
      });
    }
  },
};

/**
 * Stage two: POST one delivery to one receiver.
 *
 * **Throws on failure**, which is the contract with the queue: throwing is what earns the
 * exponential backoff and, eventually, the dead letter. Catching and returning normally
 * would mark the job done and lose the delivery silently.
 */
export const deliverHandler: JobHandler<DeliverPayload> = {
  kind: DELIVER_JOB,
  maxAttempts: MAX_DELIVERY_ATTEMPTS,
  async handle(payload, { database, attempt }) {
    const [row] = await database
      .select({
        id: webhookDelivery.id,
        event: webhookDelivery.event,
        body: webhookDelivery.payload,
        status: webhookDelivery.status,
        endpointId: webhookEndpoint.id,
        url: webhookEndpoint.url,
        secret: webhookEndpoint.secret,
      })
      .from(webhookDelivery)
      .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
      .where(eq(webhookDelivery.id, payload.deliveryId))
      .limit(1);

    // The delivery or its endpoint was deleted between enqueue and run. Nothing to do, and
    // retrying will never find it — return rather than throw.
    if (!row) return;
    // A replay that already succeeded, or a duplicate job. Do not re-POST.
    if (row.status === 'delivered') return;

    const body = JSON.stringify({
      id: row.id,
      event: row.event,
      // Seconds, matching the signature timestamp, so a receiver comparing them does not
      // have to know that one is milliseconds.
      created: Math.floor(Date.now() / 1000),
      data: row.body,
    });

    let responseStatus: number | null = null;
    let failure: string | null = null;

    try {
      const response = await fetch(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signPayload(row.secret, body),
          'keel-event': row.event,
          'keel-delivery': row.id,
        },
        body,
        /*
         * A receiver that accepts the connection and never responds would otherwise hold a
         * worker until the platform kills the request — one hung endpoint stalling the
         * queue for everyone. The timeout is what makes "a slow receiver cannot slow down
         * the app" true of the worker as well as the request path.
         */
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      responseStatus = response.status;
      if (!response.ok) failure = `Receiver responded ${response.status}`;
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (!failure) {
      await database
        .update(webhookDelivery)
        .set({
          status: 'delivered',
          attempts: attempt,
          responseStatus,
          lastError: null,
          deliveredAt: new Date(),
        })
        .where(eq(webhookDelivery.id, row.id));
      return;
    }

    const exhausted = attempt >= MAX_DELIVERY_ATTEMPTS;
    await database
      .update(webhookDelivery)
      .set({
        status: exhausted ? 'failed' : 'pending',
        attempts: attempt,
        responseStatus,
        lastError: failure.slice(0, 2000),
      })
      .where(eq(webhookDelivery.id, row.id));

    if (exhausted) {
      /*
       * Disable the endpoint rather than leaving it subscribed.
       *
       * A permanently dead receiver that stays subscribed turns every future event into a
       * guaranteed-failing delivery — unbounded work with no chance of success, growing
       * with traffic. Disabling is visible and reversible; the deliveries already recorded
       * are what a human reads before re-enabling it.
       */
      await database
        .update(webhookEndpoint)
        .set({ disabledAt: new Date() })
        .where(eq(webhookEndpoint.id, row.endpointId));
      console.error(
        JSON.stringify({
          event: 'webhook.endpoint_disabled',
          endpointId: row.endpointId,
          message: failure,
        }),
      );
      // Exhausted: recorded and disabled. Throwing again would only dead-letter a job whose
      // outcome is already durable in `webhook_delivery`.
      return;
    }

    // Not exhausted: throw, so the queue applies its backoff and tries again.
    throw new Error(failure);
  },
};

/** Register both stages with the worker. */
export const webhookHandlers = [dispatchHandler, deliverHandler] as const;
