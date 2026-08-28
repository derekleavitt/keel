'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

/**
 * Subscribe to change notifications for some channels and run `onChange` when they move.
 *
 * The callback is deliberately not given the change — it is a signal to refetch, not data.
 * See `@keel/realtime` for why: anything delivered over the connection would have to carry
 * its own authorization story, while a refetch goes through the query the page already uses.
 *
 * ## Degrading rather than breaking
 *
 * `EventSource` reconnects on its own and resends `Last-Event-ID`, so an ordinary blip needs
 * no help. What it cannot recover from is an environment where streaming does not work at
 * all — a proxy that buffers the response, a corporate filter, a runtime with no
 * `EventSource`. Those look identical to a flapping connection from inside the browser, so
 * the rule is *count the failures*: after several with no successful message in between,
 * stop trying to stream and poll the same endpoint instead.
 *
 * Polling is the same route with `?poll=1`, the same authorization and the same cursor, so
 * the degraded path cannot drift from the live one — it is exercised by the same tests.
 */
export function useLiveUpdates(
  channels: string[],
  onChange: () => void,
  options: { cursor?: number; enabled?: boolean; pollIntervalMs?: number } = {},
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');

  /*
   * The callback and the cursor live in refs so that changing either does not tear down the
   * connection. `onChange` is almost always an inline arrow — a new identity every render —
   * and in an effect dependency it would reconnect on every keystroke.
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const cursorRef = useRef(options.cursor ?? 0);

  const key = channels.join(',');
  const enabled = options.enabled !== false && key.length > 0;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const url = (extra = '') =>
      `/api/realtime?channels=${encodeURIComponent(key)}${extra}` +
      (cursorRef.current > 0 ? `&cursor=${cursorRef.current}` : '');

    function startPolling() {
      if (stopped || pollTimer) return;
      source?.close();
      source = null;
      setStatus('polling');

      const tick = async () => {
        try {
          const response = await fetch(url('&poll=1'), { cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as { cursor: number; changed: string[] };
          if (body.cursor > cursorRef.current) {
            cursorRef.current = body.cursor;
            if (body.changed.length > 0) onChangeRef.current();
          }
          setStatus('polling');
        } catch {
          // Polling is the last resort, so a failure here is reported and retried rather
          // than escalated — there is nowhere further to fall back to.
          setStatus('offline');
        }
      };

      void tick();
      pollTimer = setInterval(tick, pollIntervalMs);
    }

    function startStreaming() {
      if (stopped) return;
      if (typeof EventSource === 'undefined') {
        startPolling();
        return;
      }

      setStatus('connecting');
      source = new EventSource(url());

      source.addEventListener('ready', (event) => {
        failures = 0;
        setStatus('live');
        try {
          const data = JSON.parse((event as MessageEvent).data) as { cursor: number };
          if (data.cursor > cursorRef.current) cursorRef.current = data.cursor;
        } catch {
          // A malformed frame is not worth dropping the connection over.
        }
      });

      source.addEventListener('changed', (event) => {
        failures = 0;
        setStatus('live');
        const message = event as MessageEvent;
        // The browser tracks `lastEventId` for its own reconnects; mirroring it here keeps
        // the polling fallback resuming from the same place.
        const id = Number(message.lastEventId);
        if (Number.isFinite(id) && id > cursorRef.current) cursorRef.current = id;
        onChangeRef.current();
      });

      /*
       * The server closes the stream when the subscriber may no longer read the channel.
       * Reconnecting would be answered with 403 forever, so stop entirely — the page it is
       * updating is about to become unreadable too.
       */
      source.addEventListener('revoked', () => {
        stopped = true;
        source?.close();
        setStatus('offline');
      });

      source.onerror = () => {
        failures += 1;
        setStatus('connecting');
        if (failures >= 3) startPolling();
      };
    }

    startStreaming();

    return () => {
      stopped = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [key, enabled, pollIntervalMs]);

  return status;
}
