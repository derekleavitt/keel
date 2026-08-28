# The public API

Versioned under `/api/v1`. Everything returns JSON; every response carries
`x-keel-api-version`.

## Authentication

Create a key at **Settings → API keys**. The token is shown once, at creation, and cannot
be recovered afterwards — nothing stored can reconstruct it.

```bash
curl https://your-app/api/v1/lists \
  -H "Authorization: Bearer keel_sk_…"
```

A key **acts as the user who created it, in the organization it was created in, and in no
other**. Membership is re-checked on every request rather than trusted from the key, so
removing someone from an organization disables their keys for it immediately — there is
nothing to invalidate.

A missing or invalid key gets `401` with a `WWW-Authenticate: Bearer` challenge. Unknown
key, wrong secret and revoked key are indistinguishable, on purpose: telling them apart
tells an attacker which half of a guess was right.

Requests without an `Authorization` header fall back to the session cookie, so the same
endpoints work from a browser during development.

## Errors

```json
{ "error": { "code": "not_found", "message": "No such list." } }
```

Branch on `code`; show `message`. Codes are stable, messages are not.

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_body` | Body was not JSON, or failed the schema. The message names the field. |
| 400 | `missing_parameter` | A required query parameter was absent. |
| 401 | `unauthenticated` | No key, bad key, or revoked key. |
| 404 | `not_found` | No such resource **or** not yours. Deliberately the same answer — see below. |
| 405 | `method_not_allowed` | Wrong verb for this path. |
| 500 | `internal_error` | Logged server-side. The message is never echoed to the client. |

**404 rather than 403 for another tenant's data.** A `403` confirms the id exists, which
turns the API into an enumeration oracle. The query layer returns nothing for "not yours"
and for "no such thing" alike, so this is the natural answer rather than a special case.

## Endpoints

### Lists

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/lists` | Every list visible to the caller — owned and shared. |
| `POST` | `/api/v1/lists` | `{ name, colour? }`. `201` with `Location`. |
| `GET` | `/api/v1/lists/:id` | The list and its todos. |
| `PATCH` | `/api/v1/lists/:id` | `{ name?, colour? }`. Owner only — an editor grant does not rename. |
| `DELETE` | `/api/v1/lists/:id` | `204`. Deletes the todos with it. |

### Todos

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/todos?listId=…` | Todos in one list. |
| `POST` | `/api/v1/todos` | `{ listId, title, notes?, dueDate?, priority? }`. `201` with `Location`. |
| `GET` | `/api/v1/todos/:id` | One todo. |
| `PATCH` | `/api/v1/todos/:id` | `{ title?, notes?, dueDate?, priority? }`. |
| `DELETE` | `/api/v1/todos/:id` | `204`. |

## Worked example

```bash
KEY="keel_sk_…"
API="https://your-app/api/v1"

LIST=$(curl -s -X POST "$API/lists" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"name":"Release checklist"}' | jq -r .data.id)

curl -s -X POST "$API/todos" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "{\"listId\":\"$LIST\",\"title\":\"Cut the tag\"}"

curl -s "$API/lists/$LIST" -H "Authorization: Bearer $KEY" | jq .
```

## Adding an endpoint

Route handlers live in `apps/web/app/api/v1/`. Every one of them:

1. wraps its body in `withScope(request, …)` from `_api.ts`, which resolves the caller and
   answers `401` — routes never read the `Authorization` header themselves;
2. validates any body with `parseBody(request, schema)` against a contract schema;
3. calls the **same query helpers the web UI calls**, with the resolved `Scope`.

Point 3 is the design. Authorization lives in the query layer, so an endpoint cannot be
more permissive than the page showing the same data — and the audit log records API
activity for free, because `audit()` sits beside the write rather than in the action layer.
See `.orchestration/lessons/L-028.md`.

## What is deliberately absent

- **No pagination.** The testbed has no collection large enough to need it, and a cursor
  API designed against no data is a cursor API designed wrong. `GET /lists` returns
  everything; add pagination when a real caller hits a real limit.
- **No rate limiting yet.** That is T-22, and it belongs in front of every entry point
  rather than in these handlers.
- **No key expiry.** Revocation is the mechanism. Automatic expiry without a rotation flow
  produces outages, not security.

---

# Webhooks

Subscribe at **Settings → Webhooks**. Keel POSTs a signed JSON body to your URL when
something happens in your organisation.

## Events

`todo.created` · `todo.completed` · `todo.reopened` · `todo.deleted`

The list is closed. A typo in a subscription would otherwise be silent — an endpoint that
matches nothing and delivers nothing looks exactly like a receiver that is simply idle.

## The request

```http
POST /your/endpoint
content-type: application/json
keel-event: todo.created
keel-delivery: whd_9f2c…
keel-signature: t=1756329600,v1=6f1a…

{ "id": "whd_9f2c…", "event": "todo.created", "created": 1756329600,
  "data": { "id": "tdo_…", "listId": "lst_…", "title": "Milk" } }
```

Respond `2xx` to acknowledge. Anything else is a failure and will be retried.

## Verify the signature before trusting the body

Your URL is reachable by anyone who learns it, so an unverified body proves nothing about
where it came from.

```ts
import { verifySignature } from '@keel/webhooks/signature';

if (!verifySignature(secret, rawBody, request.headers.get('keel-signature'))) {
  return new Response('bad signature', { status: 401 });
}
```

Verify against the **raw body**, before parsing. `JSON.parse` followed by `JSON.stringify`
does not reliably reproduce the bytes that were signed.

Implementing it yourself is four lines:

```
signed  = `${t}.${rawBody}`
expect  = HMAC_SHA256(secret, signed)          // hex
valid   = constantTimeEquals(expect, v1) && abs(now - t) < 300
```

The timestamp is inside the signed string, which is what stops a captured delivery being
replayable forever — and why a stale `t` must be rejected even when the digest matches.

## Delivery, retries and failure

Delivery is a **two-stage** queue. A mutation writes one job in its own transaction; a
worker then expands that into one delivery per subscriber, each with its own retry budget.

The consequences are worth knowing:

- **A slow receiver cannot slow down the app.** Nothing is contacted on the request path.
  A receiver that never responds is abandoned after 10 seconds.
- **A rolled-back mutation notifies nobody**, because the announcement commits with it.
- **Failures do not cascade.** One dead receiver does not delay or duplicate deliveries to
  the others, because each has its own job.
- **Retries back off** — 1m, 2m, 4m, 8m, 16m — and stop after 5 attempts.
- **A persistently failing endpoint is disabled**, not retried forever. A dead receiver
  that stays subscribed turns every future event into guaranteed-failing work that grows
  with traffic. Re-enable it yourself once it is fixed; nothing re-enables on a timer.

Every attempt is recorded with its response status and error. Failed deliveries can be
**replayed** from the same screen — replay re-queues, so the entry stays until a worker
pass actually succeeds.

**Deliveries are at-least-once.** A receiver that times out after doing the work will be
retried, so make your handler idempotent — `keel-delivery` is stable across retries of the
same delivery and is the key to deduplicate on.

## Where a URL may point

HTTPS, a public address, no credentials in the URL. Loopback, private ranges, link-local
and cloud-metadata hosts are refused, because a webhook URL is input that the *server*
fetches — the classic SSRF surface.

For local development, `WEBHOOK_ALLOW_PRIVATE_HOSTS=1` permits `127.0.0.1` so you can run a
receiver on your own machine. `pnpm db:up` sets it. The environment contract **refuses to
start** if it is ever set with `NODE_ENV=production`, and it never unblocks cloud metadata.

The honest limit: this validates the URL, not the connection. A host that resolves publicly
now can resolve to `127.0.0.1` at delivery time. Closing that needs address pinning at
connect time — see `.orchestration/lessons/L-034.md`.
