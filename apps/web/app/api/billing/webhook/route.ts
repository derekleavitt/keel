import { applyProviderEvent, stubProvider } from '@keel/billing';
import { serverEnv } from '@keel/contracts/env';

export const dynamic = 'force-dynamic';

/**
 * The provider's webhook.
 *
 * Three things this endpoint must get right, none of them obvious from the happy path:
 *
 * 1. **Read the raw body**, before any parsing. Every provider signs the exact bytes they
 *    sent, and `JSON.parse` then `JSON.stringify` does not reproduce them — key order and
 *    number formatting both drift. Signature verification against a re-serialised body
 *    fails intermittently, which is the worst way for it to fail.
 * 2. **Answer 200 to anything already handled.** A duplicate is the provider retrying, and
 *    a non-2xx makes it retry harder and eventually disable the endpoint.
 * 3. **Never authenticate by session.** There is no user here; the signature *is* the
 *    authentication.
 */
export async function POST(request: Request): Promise<Response> {
  const provider = stubProvider(serverEnv().BILLING_WEBHOOK_SECRET ?? 'whsec_stub');

  const raw = await request.text();
  const signature =
    request.headers.get('keel-billing-signature') ?? request.headers.get('stripe-signature');

  const event = await provider.parseWebhook(raw, signature);
  if (!event) {
    // Unsigned, forged, or simply not ours — all the same answer, and none of them a retry.
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  const result = await applyProviderEvent(event);

  /*
   * 200 even when the event was not applied. "Duplicate" and "stale" are both correct
   * outcomes of correct delivery — the provider has done its job and should stop. The reason
   * is returned so it is visible in their dashboard's delivery log.
   */
  return Response.json({ received: true, ...result });
}
