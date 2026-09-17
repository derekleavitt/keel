'use client';

import { WEBHOOK_EVENTS } from '@keel/contracts/webhook';
import { Button } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  createEndpointAction,
  deleteEndpointAction,
  enableEndpointAction,
  replayDeliveryAction,
} from './actions.ts';

export type EndpointRow = {
  id: string;
  url: string;
  events: string[];
  disabledAt: Date | null;
};

export type DeliveryRow = {
  id: string;
  url: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
};

export function WebhookManager({
  endpoints,
  deliveries,
}: {
  endpoints: EndpointRow[];
  deliveries: DeliveryRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<{ url: string; secret: string } | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    try {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong');
      router.refresh();
      return result;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <form
          action={async (data) => {
            const url = String(data.get('url') ?? '').trim();
            const events = WEBHOOK_EVENTS.filter((event) => data.get(event) === 'on');
            if (!url) return;

            const result = await run(() => createEndpointAction({ url, events }));
            if (result.ok && 'secret' in result && typeof result.secret === 'string') {
              setIssued({ url, secret: result.secret });
            }
          }}
          className="flex flex-col gap-3"
        >
          <input
            name="url"
            required
            placeholder="https://example.com/webhooks/keel"
            aria-label="Endpoint URL"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
          />
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 font-mono text-xs uppercase tracking-widest text-muted">
              Events
            </legend>
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={event}
                  defaultChecked={event === 'todo.created'}
                  className="size-4 accent-accent"
                />
                <span className="font-mono text-xs">{event}</span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={pending} className="self-start">
            Add endpoint
          </Button>
        </form>

        {error && (
          <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        {issued && (
          <div className="flex flex-col gap-2 rounded-md border border-accent bg-surface-2 px-4 py-3">
            <p className="text-sm font-medium">Signing secret for {issued.url} — shown once.</p>
            <output aria-label="Signing secret" className="break-all font-mono text-xs text-accent">
              {issued.secret}
            </output>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="self-start text-xs text-muted underline underline-offset-4"
            >
              I have copied it
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Endpoints</h2>
        {endpoints.length === 0 ? (
          <p className="text-sm text-muted">No endpoints yet.</p>
        ) : (
          <ul
            aria-label="Endpoints"
            className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
          >
            {endpoints.map((endpoint) => (
              <li
                key={endpoint.id}
                aria-label={`Endpoint ${endpoint.url}`}
                className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
              >
                <div className="flex flex-col gap-1">
                  <span className={endpoint.disabledAt ? 'text-sm text-muted' : 'text-sm'}>
                    {endpoint.url}
                    {endpoint.disabledAt && ' · disabled after repeated failures'}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {endpoint.events.join(' · ')}
                  </span>
                </div>
                <div className="flex gap-2">
                  {endpoint.disabledAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`Enable ${endpoint.url}`}
                      onClick={() => run(() => enableEndpointAction(endpoint.id))}
                    >
                      Enable
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Delete ${endpoint.url}`}
                    onClick={() => run(() => deleteEndpointAction(endpoint.id))}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Deliveries</h2>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted">Nothing has been sent yet.</p>
        ) : (
          <ul
            aria-label="Deliveries"
            className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
          >
            {deliveries.map((delivery) => (
              <li
                key={delivery.id}
                aria-label={`Delivery ${delivery.id}`}
                className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm">
                    <span className="font-mono text-xs">{delivery.event}</span> → {delivery.url}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {delivery.status}
                    {delivery.responseStatus !== null && ` · ${delivery.responseStatus}`}
                    {delivery.attempts > 0 && ` · ${delivery.attempts} attempts`}
                    {delivery.lastError && ` · ${delivery.lastError.slice(0, 80)}`}
                  </span>
                </div>
                {delivery.status !== 'delivered' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Replay ${delivery.id}`}
                    onClick={() => run(() => replayDeliveryAction(delivery.id))}
                  >
                    Replay
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
