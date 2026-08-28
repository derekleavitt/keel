import { entitlements, LimitExceededError, requestsPerMinuteFor } from '@keel/billing';
import type { Scope } from '@keel/contracts/ids';
import type { Parser } from '@keel/contracts/parse';
import { consume, rateLimitHeaders } from '@keel/rate-limit';
import { identifyRequest } from '@keel/testbed-orgs/scope';

/**
 * The shared shape of every v1 endpoint.
 *
 * Errors are `{ error: { code, message } }` with a stable machine-readable `code`, because
 * an API consumer branches on the code and shows the message. Free-text errors force
 * clients to match on prose, which then cannot be reworded.
 */
export type ApiError = { error: { code: string; message: string } };

export const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      // Machine clients get an explicit version they can pin against.
      'x-keel-api-version': 'v1',
    },
  });

export const fail = (status: number, code: string, message: string) =>
  json({ error: { code, message } } satisfies ApiError, status);

/**
 * Resolve the caller, or answer 401.
 *
 * Every route goes through this rather than reading the header itself, so there is one
 * place that decides what an unauthenticated API request looks like — and so adding a
 * third credential type later touches one function.
 */
/**
 * The client's address, as far as it can be known.
 *
 * `x-forwarded-for` is set by the proxy in front of the app — and, absent a proxy, by the
 * client itself. **The operator has to guarantee their proxy overwrites it**, because an
 * attacker who can choose the header can choose a fresh identity per request and has no
 * limit at all. Documented in `docs/api.md`; there is no way for the application to tell the
 * difference on its own.
 *
 * The left-most entry is the original client; everything after it was appended by hops.
 */
function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

/** One minute, the window every published limit is expressed in. */
const WINDOW_MS = 60_000;

/**
 * Requests limited by address, applied **before** authentication.
 *
 * Before, on purpose: a limit that only counts successful requests does nothing about the
 * case worth worrying about — someone working through a list of stolen or guessed keys, every
 * attempt of which fails auth and would otherwise be free.
 *
 * Deliberately generous, because an address is a blunt identifier. Everyone in one office
 * shares a NAT and therefore shares this budget, so a tight limit here locks out a building
 * to slow down one script. The per-key limit below is where the real accounting happens; this
 * exists to stop the unauthenticated flood, not to price the API.
 *
 * The first version was 120/minute and the browser suite tripped it against itself — every
 * test runs from one address. That is the same arithmetic a customer's office does.
 */
const ANONYMOUS_POLICY = { limit: 600, windowMs: WINDOW_MS };

export async function withScope(
  request: Request,
  handler: (scope: Scope) => Promise<Response>,
): Promise<Response> {
  const address = await consume(`api:ip:${clientAddress(request)}`, ANONYMOUS_POLICY);
  if (!address.allowed) {
    return new Response(
      JSON.stringify({
        error: { code: 'rate_limited', message: 'Too many requests from this address.' },
      } satisfies ApiError),
      {
        status: 429,
        headers: { 'content-type': 'application/json', ...rateLimitHeaders(address) },
      },
    );
  }

  const identity = await identifyRequest(request);
  const scope = identity?.scope ?? null;
  if (!scope) {
    return new Response(
      JSON.stringify({
        error: { code: 'unauthenticated', message: 'Provide a valid API key.' },
      } satisfies ApiError),
      {
        status: 401,
        headers: {
          'content-type': 'application/json',
          // Named scheme and realm, so a generic HTTP client knows what to send.
          'www-authenticate': 'Bearer realm="keel", charset="UTF-8"',
        },
      },
    );
  }

  /*
   * The per-caller limit, keyed by the API key when there is one and by the organization
   * otherwise. Keying by *key* matters: revoking a leaked key should also revoke the traffic
   * it was generating, and an organization-wide key would let one runaway integration consume
   * the whole tenant's allowance.
   */
  const { plan } = await entitlements(scope.organizationId);
  const caller = await consume(
    identity?.apiKeyId ? `api:key:${identity.apiKeyId}` : `api:org:${scope.organizationId}`,
    { limit: requestsPerMinuteFor(plan), windowMs: WINDOW_MS },
  );

  if (!caller.allowed) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'rate_limited',
          message: `Your ${plan} plan allows ${requestsPerMinuteFor(plan)} requests per minute.`,
        },
      } satisfies ApiError),
      {
        status: 429,
        headers: { 'content-type': 'application/json', ...rateLimitHeaders(caller) },
      },
    );
  }

  /*
   * The allowance is reported on **every** response, not only when refused. A client that can
   * only learn its remaining quota by being refused has to make the request you wanted it not
   * to make.
   */
  const withHeaders = (response: Response) => {
    for (const [name, value] of Object.entries(rateLimitHeaders(caller))) {
      response.headers.set(name, value);
    }
    return response;
  };

  try {
    return withHeaders(await handler(scope));
  } catch (caught) {
    /*
     * A plan limit is a fact about the account, not a server fault. Left to the generic
     * handler below it became a 500, which tells an integrator to retry — and retrying is
     * exactly what will not help. 402 with the numbers in the message says what happened
     * and what to do about it.
     */
    if (caught instanceof LimitExceededError) {
      return fail(
        402,
        'limit_exceeded',
        `Your ${caught.check.plan} plan allows ${caught.check.limit} ${caught.limit}.`,
      );
    }
    // The message is deliberately not echoed: an internal error string can carry a query,
    // a column name or a connection target.
    console.error(JSON.stringify({ event: 'api.error', message: String(caught) }));
    return fail(500, 'internal_error', 'Something went wrong.');
  }
}

/**
 * Parse a JSON body against a contract schema.
 *
 * Returns a `Response` on failure rather than throwing, so a route reads as a straight
 * line. A malformed body and a schema violation are both 400 with the same shape — the
 * client's fix is the same either way.
 */
export async function parseBody<T>(
  request: Request,
  schema: Parser<T>,
): Promise<{ data: T } | { response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: fail(400, 'invalid_body', 'Body must be valid JSON.') };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      response: fail(
        400,
        'invalid_body',
        issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid body.',
      ),
    };
  }
  return { data: parsed.data };
}
