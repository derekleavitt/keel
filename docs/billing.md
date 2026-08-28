# Billing

Plans, limits and subscription state. **No payment provider is wired in this template**, and
that is deliberate — doing so needs an account, live API keys and a webhook secret belonging
to whoever deploys it. Everything around the provider is built and tested; wiring one is four
functions.

## What is here

| Piece | Where |
|---|---|
| Plans and their limits | `packages/billing/src/plans.ts` |
| Entitlements and reconciliation | `packages/billing/src/index.ts` |
| The provider interface | `packages/billing/src/provider.ts` |
| Webhook endpoint | `apps/web/app/api/billing/webhook/route.ts` |
| Customer-facing screen | `/settings/billing` |

## Plans

```ts
free     1 seat    ·   3 lists   ·  10 MB
team    10 seats   · 100 lists   ·   1 GB
business  ∞        ·   ∞         ·  50 GB
```

`null` means unlimited, and is deliberately not a large number: `Infinity` does not survive
JSON, and a sentinel like `999999` eventually renders as "999,999 lists remaining".

Change them in `plans.ts` — a limit is data, so adding a plan is an entry there rather than
an audit of every call site.

## Limits are enforced in the query layer

`createList` checks the allowance before inserting. That placement is the point: the web UI,
the public API and any future import all reach the same function, so **there is no endpoint
to call instead**. A check in a server action would cover the browser and miss the API, which
is precisely the shape of bug the task that built this warned about.

Over the limit, the query throws `LimitExceededError` carrying the plan, the allowance and
the current usage. Callers turn it into their own answer: a message on the page, `402
limit_exceeded` from the API. Never a 500 — retrying a request that can never succeed is
worse than useless.

**Billing cannot count.** `checkLimit(organizationId, limit, used, db)` takes the usage from
its caller, because counting lists would mean `packages/billing` knowing which tables a
feature owns. The first draft did exactly that and Turbo refused the dependency graph; the
cycle was the design telling on itself.

## Reconciliation

Provider webhooks are neither ordered nor delivered once, and the two hazards need two
different mechanisms:

| Hazard | Prevented by |
|---|---|
| the same event delivered twice | primary key on `billing_event.id` |
| events arriving out of order | comparing against `subscription.last_event_at` |

The first has to be a constraint rather than a check: providers retry aggressively and two
retries can be in flight simultaneously, so a read-then-write races. The second cannot be a
constraint — an older event is a legitimate delivery that must be **recorded and not
applied**, which is why `billing_event` keeps a `skipped_reason`.

A duplicate answers `200`. Anything else makes the provider retry harder and eventually
disable the endpoint.

## Statuses

`past_due` keeps its entitlements. Cutting a customer off the moment a card expires loses
their access over something they can usually fix in a minute, while the provider is still
retrying the charge. `canceled` drops to **free**, not to nothing — a former customer can
still read and export what they wrote.

## Wiring a real provider

Implement `BillingProvider` (`packages/billing/src/provider.ts`) — four functions:

```ts
createCheckout(request)                  // → a URL the customer pays at
createPortalSession(customerId, url)     // → a URL where they manage the subscription
parseWebhook(rawBody, signature)         // → a normalised ProviderEvent, or null
name                                     // for logs
```

Then:

1. Set `BILLING_WEBHOOK_SECRET` and point the provider's webhook at
   `POST /api/billing/webhook`.
2. Swap `stubProvider()` for yours in the webhook route and the billing page.
3. Map the provider's event types onto `subscription.updated` / `subscription.canceled`.
   Everything downstream is written against that normalised shape, so ordering and
   idempotency are already handled.

**`parseWebhook` must be given the raw body**, before any parsing. Every provider signs the
exact bytes they sent, and `JSON.parse` followed by `JSON.stringify` does not reproduce them —
key order and number formatting both drift. Verifying against a re-serialised body fails
intermittently, which is the worst way for a signature check to fail.

## What is deliberately absent

- **No proration, invoices or tax.** These are the provider's job, and reimplementing them is
  how billing bugs become money bugs. Link to the provider's portal.
- **No usage-based metering.** The limits here are counts of things that exist, which a query
  answers exactly. Metered billing needs an aggregation pipeline and a different design.
- **No seat enforcement on invite yet.** `seats` is checked and displayed but not blocked at
  the invitation, because the invitation flow predates this and blocking it needs a message
  in a place that does not exist. Recorded as T-24.
