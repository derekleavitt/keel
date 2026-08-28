'use client';

import { RECURRENCE_FREQUENCIES } from '@keel/contracts/recurrence';
import {
  createRecurrenceAction,
  deleteRecurrenceAction,
  pauseRecurrenceAction,
} from '@keel/testbed-todos/actions';
import { Button } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type SeriesRow = {
  id: string;
  title: string;
  frequency: string;
  interval: number;
  startDate: string;
  until: string | null;
  timeZone: string;
  pausedAt: Date | null;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RepeatPanel({ listId, series }: { listId: string; series: SeriesRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [frequency, setFrequency] = useState<string>('weekly');

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    try {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Repeating</h2>

      <form
        action={(data) => {
          const title = String(data.get('title') ?? '').trim();
          if (!title) return;
          const byWeekday = WEEKDAYS.map((_, index) => index).filter(
            (index) => data.get(`weekday-${index}`) === 'on',
          );

          run(() =>
            createRecurrenceAction({
              listId,
              title,
              frequency,
              interval: Number(data.get('interval') ?? 1),
              byWeekday: frequency === 'weekly' && byWeekday.length > 0 ? byWeekday : null,
              startDate: String(data.get('startDate') ?? ''),
              until: String(data.get('until') ?? '') || null,
              /*
               * The browser's zone, not the server's. A series anchored to the server's
               * timezone lands on the wrong day for everyone who is not sitting beside it,
               * and does so silently.
               */
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
          );
        }}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <input
          name="title"
          required
          placeholder="What repeats?"
          aria-label="Repeating todo title"
          autoComplete="off"
          className="h-10 w-full rounded-md border border-line bg-surface-2 px-3 text-sm outline-none focus-visible:border-accent"
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Every</span>
            <input
              name="interval"
              type="number"
              min={1}
              max={365}
              defaultValue={1}
              aria-label="Repeat interval"
              className="h-9 w-16 rounded-md border border-line bg-surface-2 px-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Frequency</span>
            <select
              name="frequency"
              aria-label="Frequency"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
              className="h-9 rounded-md border border-line bg-surface-2 px-2 text-sm"
            >
              {RECURRENCE_FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        {frequency === 'weekly' && (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Days of the week</legend>
            {WEEKDAYS.map((label, index) => (
              <label key={label} className="flex items-center gap-1 text-xs">
                <input type="checkbox" name={`weekday-${index}`} className="size-3 accent-accent" />
                {label}
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">From</span>
            <input
              name="startDate"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              aria-label="Start date"
              className="h-9 rounded-md border border-line bg-surface-2 px-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Until</span>
            <input
              name="until"
              type="date"
              aria-label="End date"
              className="h-9 rounded-md border border-line bg-surface-2 px-2 text-sm"
            />
          </label>
        </div>

        <Button type="submit" disabled={pending} className="self-start">
          Repeat this
        </Button>
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {series.length > 0 && (
        <ul
          aria-label="Series"
          className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
        >
          {series.map((row) => (
            <li
              key={row.id}
              aria-label={`Series ${row.title}`}
              className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <span className={row.pausedAt ? 'text-sm text-muted' : 'text-sm'}>
                  {row.title}
                  {row.pausedAt && ' · paused'}
                </span>
                <span className="font-mono text-xs text-muted">
                  every {row.interval > 1 ? `${row.interval} ` : ''}
                  {row.frequency.replace(/ly$/, row.interval > 1 ? 's' : 'ly')} · from{' '}
                  {row.startDate}
                  {row.until && ` until ${row.until}`} · {row.timeZone}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`${row.pausedAt ? 'Resume' : 'Pause'} ${row.title}`}
                  onClick={() => run(() => pauseRecurrenceAction(row.id, !row.pausedAt))}
                >
                  {row.pausedAt ? 'Resume' : 'Pause'}
                </Button>
                {/*
                 * "Stop repeating" rather than "Delete": the todos already generated stay,
                 * and the label should not suggest otherwise.
                 */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`Stop repeating ${row.title}`}
                  onClick={() => run(() => deleteRecurrenceAction(row.id))}
                >
                  Stop repeating
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
