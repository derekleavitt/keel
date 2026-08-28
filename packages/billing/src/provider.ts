/**
 * The payment provider boundary.
 *
 * Nothing above this interface knows which provider is in use, and nothing below it knows
 * what a list or a seat is. That is what makes "the vendor could be swapped without touching
 * feature code" checkable rather than aspirational: `packages/billing` imports no vendor SDK,
 * and the only implementation shipped here is a stub.
 *
 * **No real provider is wired in this template, and that is deliberate.** Doing so needs an
 * account, live API keys and a webhook secret that belong to whoever deploys it — they are
 * not the template's to hold. `docs/billing.md` says exactly which four functions to write.
 */

export interface CheckoutRequest {
  organizationId: string;
  plan: string;
  seats: number;
  /** Where the provider returns the customer after success or cancellation. */
  returnUrl: string;
}

/**
 * A provider event, normalised.
 *
 * The shape every provider's webhook is translated *into*, so the reconciliation logic —
 * which is where the ordering and idempotency subtleties live — is written once and is not
 * coupled to any vendor's payload.
 */
export interface ProviderEvent {
  /** The provider's own id for this delivery. The idempotency key. */
  id: string;
  type: 'subscription.updated' | 'subscription.canceled';
  /** The provider's creation time, used to discard events that arrive out of order. */
  createdAt: Date;
  organizationId: string;
  plan?: string;
  status?: string;
  seats?: number;
  currentPeriodEnd?: Date | null;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
}

export interface BillingProvider {
  readonly name: string;
  /** A URL the customer is sent to in order to pay. */
  createCheckout(request: CheckoutRequest): Promise<{ url: string }>;
  /** A URL where an existing customer manages their own subscription. */
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /**
   * Verify a webhook's signature and parse it, or return null.
   *
   * Takes the **raw body**, never a parsed object: every provider signs the exact bytes
   * they sent, and `JSON.parse` followed by `JSON.stringify` does not reproduce them.
   * Returning null rather than throwing keeps "not for us" and "forged" indistinguishable
   * to the caller, which is the right answer for both.
   */
  parseWebhook(rawBody: string, signature: string | null): Promise<ProviderEvent | null>;
}

/**
 * The development provider.
 *
 * Not a mock in the testing sense — it is a real implementation of the interface that
 * happens to settle instantly and charge nobody. That lets the whole flow (checkout →
 * webhook → entitlement change → limit enforcement) run in tests and locally, which is the
 * part worth exercising; the vendor's hosted page is the part that is not.
 *
 * Its "signature" is a shared secret compared directly. That is enough to keep the endpoint
 * from being anonymously writable in development and is emphatically not a substitute for a
 * real provider's signing scheme.
 */
export function stubProvider(secret = 'whsec_stub'): BillingProvider {
  return {
    name: 'stub',
    async createCheckout(request) {
      // A local URL that completes the purchase, standing in for a hosted checkout page.
      const params = new URLSearchParams({
        organizationId: request.organizationId,
        plan: request.plan,
        seats: String(request.seats),
        returnUrl: request.returnUrl,
      });
      return { url: `/api/billing/stub-checkout?${params}` };
    },
    async createPortalSession(customerId, returnUrl) {
      return { url: `${returnUrl}?portal=${encodeURIComponent(customerId)}` };
    },
    async parseWebhook(rawBody, signature) {
      if (signature !== secret) return null;
      try {
        const body = JSON.parse(rawBody) as Record<string, unknown>;
        if (typeof body.id !== 'string' || typeof body.type !== 'string') return null;
        return {
          id: body.id,
          type: body.type as ProviderEvent['type'],
          createdAt: new Date(String(body.createdAt)),
          organizationId: String(body.organizationId),
          plan: body.plan as string | undefined,
          status: body.status as string | undefined,
          seats: typeof body.seats === 'number' ? body.seats : undefined,
          currentPeriodEnd: body.currentPeriodEnd ? new Date(String(body.currentPeriodEnd)) : null,
          providerCustomerId: body.providerCustomerId as string | undefined,
          providerSubscriptionId: body.providerSubscriptionId as string | undefined,
        };
      } catch {
        return null;
      }
    },
  };
}
