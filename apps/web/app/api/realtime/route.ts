import {
  changesSince,
  currentCursor,
  POLL_INTERVAL_MS,
  REAUTHORIZE_EVERY_MS,
} from '@keel/realtime';
import { roleOnList } from '@keel/testbed-lists';
import { requireScopeOrNull } from '@keel/testbed-orgs/scope';

export const dynamic = 'force-dynamic';

/** Streams are long-lived; nothing about them may be cached or statically rendered. */
export const revalidate = 0;

/**
 * Which channels this caller may subscribe to.
 *
 * The channel string arrives from the client, so it is a *request*, not a permission. Every
 * name is resolved back to the resource it refers to and checked with the same helper the
 * pages use — `roleOnList` composes `visibleVia`, so a subscription can never be broader
 * than the page it is updating.
 *
 * Unknown channel kinds are dropped rather than rejected: a client on an older deploy asking
 * for something this server does not understand should lose that subscription, not the
 * connection.
 */
async function authorize(
  scope: Awaited<ReturnType<typeof requireScopeOrNull>>,
  requested: string[],
): Promise<string[]> {
  if (!scope) return [];

  const allowed = await Promise.all(
    requested.map(async (channel) => {
      const [kind, id] = channel.split(':');
      if (kind !== 'list' || !id) return null;
      return (await roleOnList(scope, id)) ? channel : null;
    }),
  );
  return allowed.filter((channel): channel is string => channel !== null);
}

/**
 * Server-sent events, not WebSockets.
 *
 * The traffic here is one-directional — the server tells the client "refetch" — and SSE is
 * one-directional. It also survives the deployment story this template is built for: it is
 * plain HTTP, it passes through proxies and CDNs that block socket upgrades, and the browser
 * reconnects on its own, resending `Last-Event-ID` so the cursor survives without any
 * client-side bookkeeping. A WebSocket would buy bidirectionality nothing here needs, and
 * cost every one of those properties.
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

  /*
   * The browser sends `Last-Event-ID` when *it* reconnects; the query parameter is for the
   * polling fallback, which has no such header. Both mean the same thing.
   */
  /*
   * Absent and zero are different, and conflating them is a silent bug.
   *
   * A tenant that has never changed anything has cursor 0, so "0" is a legitimate position
   * meaning "I have seen nothing" — not a missing value. Treating it as missing
   * fast-forwards the subscriber to now, which means the *first* change in a new workspace
   * is always dropped: exactly the change a new user is most likely to be watching for.
   */
  const raw = request.headers.get('last-event-id') ?? url.searchParams.get('cursor');
  const parsed = raw === null || raw === '' ? null : Number(raw);
  const supplied = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  let cursor = supplied ?? 0;

  /*
   * A single request that returns immediately, for the polling fallback. Same authorization,
   * same cursor semantics, no stream — so the degraded path cannot drift from the live one.
   */
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

      // Tells the browser how long to wait before reconnecting, and confirms the cursor the
      // client is actually subscribed from.
      send('ready', JSON.stringify({ cursor, channels }));
      controller.enqueue(encoder.encode(`retry: ${POLL_INTERVAL_MS * 3}\n\n`));

      let lastAuthorized = Date.now();

      try {
        while (!closed) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (closed) break;

          /*
           * Re-authorize periodically. A server action decides once and returns; a stream is
           * a decision that keeps being true, so it has to keep being made. Without this,
           * revoking a share leaves the other tab receiving notifications until it is closed.
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
            // A comment frame. Keeps proxies and load balancers from closing an idle
            // connection, and carries no event so the client ignores it.
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
      // Nginx and several CDNs buffer responses by default, which turns a stream into a
      // single response delivered when it ends — i.e. never.
      'x-accel-buffering': 'no',
    },
  });
}
