'use server';

import { audit } from '@keel/audit';
import { createWebhookEndpointSchema } from '@keel/contracts/webhook';
import { requireScope } from '@keel/testbed-orgs/scope';
import {
  createEndpoint,
  deleteEndpoint,
  enableEndpoint,
  replayDelivery,
  UnsafeWebhookUrlError,
} from '@keel/webhooks';
import { revalidatePath } from 'next/cache';

/** Every export is a public endpoint: no helpers, no ids trusted, parse everything. */
export async function createEndpointAction(input: unknown) {
  const scope = await requireScope();
  const parsed = createWebhookEndpointSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  try {
    const endpoint = await createEndpoint(scope, parsed.data);
    await audit(scope, {
      action: 'webhook.endpoint_created',
      targetType: 'webhook_endpoint',
      targetId: endpoint.id,
      summary: `added a webhook to ${endpoint.url}`,
      detail: { events: parsed.data.events },
    });
    revalidatePath('/settings/webhooks', 'layout');
    // Shown once, like an API key — but this secret is genuinely stored, because the
    // receiver computes the same HMAC with it.
    return { ok: true as const, secret: endpoint.secret, url: endpoint.url };
  } catch (error) {
    // The URL guard's message is written for the person who typed it, so it is surfaced
    // rather than replaced with a generic failure.
    if (error instanceof UnsafeWebhookUrlError) {
      return { ok: false as const, error: error.message };
    }
    throw error;
  }
}

export async function deleteEndpointAction(id: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid endpoint' };

  const removed = await deleteEndpoint(scope, id);
  if (!removed) return { ok: false as const, error: 'Endpoint not found' };

  await audit(scope, {
    action: 'webhook.endpoint_deleted',
    targetType: 'webhook_endpoint',
    targetId: id,
    summary: 'removed a webhook',
  });
  revalidatePath('/settings/webhooks', 'layout');
  return { ok: true as const };
}

export async function enableEndpointAction(id: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid endpoint' };

  const enabled = await enableEndpoint(scope, id);
  if (!enabled) return { ok: false as const, error: 'Endpoint is not disabled' };

  await audit(scope, {
    action: 'webhook.endpoint_enabled',
    targetType: 'webhook_endpoint',
    targetId: id,
    summary: 're-enabled a webhook',
  });
  revalidatePath('/settings/webhooks', 'layout');
  return { ok: true as const };
}

export async function replayDeliveryAction(id: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid delivery' };

  const replayed = await replayDelivery(scope, id);
  if (!replayed) return { ok: false as const, error: 'Delivery not found' };

  await audit(scope, {
    action: 'webhook.delivery_replayed',
    targetType: 'webhook_delivery',
    targetId: id,
    summary: 'replayed a webhook delivery',
  });
  revalidatePath('/settings/webhooks', 'layout');
  return { ok: true as const };
}
