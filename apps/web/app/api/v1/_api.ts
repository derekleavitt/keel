import type { Scope } from '@keel/contracts/ids';
import type { Parser } from '@keel/contracts/parse';
import { scopeFromRequest } from '@keel/testbed-orgs/scope';

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
export async function withScope(
  request: Request,
  handler: (scope: Scope) => Promise<Response>,
): Promise<Response> {
  const scope = await scopeFromRequest(request);
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

  try {
    return await handler(scope);
  } catch (caught) {
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
