import { requireScopeOrNull } from '@keel/organizations/scope';
import {
  changesSince,
  currentCursor,
  POLL_INTERVAL_MS,
  REAUTHORIZE_EVERY_MS,
} from '@keel/realtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Which channels this caller may subscribe to.
 *
 * **This is yours to implement, and it returns nothing until you do.** The channel string
 * arrives from the client, so it is a *request*, not a permission — every name has to be
 * resolved back to the resource it refers to and checked with the same rule the pages use, so
 * a subscription can never be broader than the page it updates.
 *
 * The removed todo application authorized `list:<id>` by calling `roleOnList`, which composes
 * the same `visibleVia` predicate every list query uses. Do the equivalent for your resources:
 *
 *   const [kind, id] = channel.split(':');
 *   if (kind !== 'project' || !id) return null;
 *   return (await roleOnProject(scope, id)) ? channel : null;
 *
 * Refusing everything is the safe default. An empty list means the endpoint answers 403, which
 * is the correct answer while nothing is subscribable.
 */
async function authorize(
  _scope: Awaited<ReturnType<typeof requireScopeOrNull>>,
  _requested: string[],
): Promise<string[]> {
  return [];
}

/**
 * Server-sent events, not WebSockets.
 *
 * The traffic is one-directional — the server says "refetch" — and so is SSE. It is also
 * plain HTTP, so it survives proxies and CDNs that block socket upgrades, and the browser
 * reconnects on its own, resending `Last-Event-ID` so the cursor needs no client bookkeeping.
 *
 * Nothing about the change travels over the connection: a subscriber learns that a channel
 * moved and refetches through the ordinary authorized query. Pushing rows would mean
 * re-implementing every visibility rule at the socket layer, where getting it wrong fails open.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = (url.searchParams.get('channels') ?? '')
    .split(',')
    .map((channel) => channel.trim())
    .filter(Boolean)
    .slice(0, 20);

  const scope = await requireScopeOrNull();
  if (!scope) return new Response('Unauthorized', { status: 401 });

  let channels = await authorize(scope, requested);
  if (channels.length === 0) return new Response('No readable channels', { status: 403 });

  const raw = request.headers.get('last-event-id') ?? url.searchParams.get('cursor');
  const parsed = raw === null || raw === '' ? null : Number(raw);
  const supplied = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  let cursor = supplied ?? 0;

  if (url.searchParams.get('poll') === '1') {
    if (supplied === null) cursor = await currentCursor(scope.organizationId);
    const changes = await changesSince(scope.organizationId, channels, cursor);
    return Response.json(
      { cursor: changes.at(-1)?.id ?? cursor, changed: changes.map((c) => c.channel) },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  if (supplied === null) cursor = await currentCursor(scope.organizationId);

  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener('abort', () => {
    closed = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string, id?: number) => {
        const frame = `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${data}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      send('ready', JSON.stringify({ cursor, channels }));
      controller.enqueue(encoder.encode(`retry: ${POLL_INTERVAL_MS * 3}\n\n`));

      let lastAuthorized = Date.now();

      try {
        while (!closed) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (closed) break;

          /*
           * Re-authorize periodically. A server action decides once and returns; a stream is a
           * decision that stays true for as long as it is open, so it has to keep being made.
           * See .orchestration/lessons/L-042.md.
           */
          if (Date.now() - lastAuthorized > REAUTHORIZE_EVERY_MS) {
            channels = await authorize(scope, channels);
            lastAuthorized = Date.now();
            if (channels.length === 0) {
              send('revoked', '{}');
              break;
            }
          }

          const changes = await changesSince(scope.organizationId, channels, cursor);
          if (changes.length === 0) {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
            continue;
          }

          cursor = changes.at(-1)?.id ?? cursor;
          send('changed', JSON.stringify([...new Set(changes.map((c) => c.channel))]), cursor);
        }
      } catch (caught) {
        console.error(
          JSON.stringify({
            event: 'realtime.stream_failed',
            message: caught instanceof Error ? caught.message : String(caught),
          }),
        );
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the client going away. Nothing to do and nothing wrong.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
