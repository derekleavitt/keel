'use client';

import type { Agenda } from '@keel/testbed-views';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * The agenda, rendered in the reader's timezone.
 *
 * `today` is resolved on the client because only the browser knows the user's zone. A
 * server-computed day shows the wrong thing to anyone not on the server's clock — and
 * the PRD's bar is "correct at midnight without a refresh", which is exactly when that
 * mismatch becomes visible.
 */
export function AgendaView({
  initial,
  load,
}: {
  initial: Agenda;
  load: (tz: string) => Promise<Agenda>;
}) {
  const [agenda, setAgenda] = useState(initial);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === initial.today) return;
    let cancelled = false;
    load(zone).then((fresh) => {
      if (!cancelled) setAgenda(fresh);
    });
    return () => {
      cancelled = true;
    };
  }, [initial, load]);

  if (agenda.empty) {
    return (
      <p className="text-sm text-muted">
        Nothing due today.{' '}
        <Link href="/lists" className="text-accent underline underline-offset-4">
          Go to your lists
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {agenda.overdue.length > 0 && (
        <Section title="Overdue" tone="overdue" entries={agenda.overdue} />
      )}
      {agenda.dueToday.length > 0 && (
        <Section title="Due today" tone="today" entries={agenda.dueToday} />
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  entries,
}: {
  title: string;
  tone: 'overdue' | 'today';
  entries: Agenda['overdue'];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        <span className="font-mono text-xs font-normal text-muted">{entries.length}</span>
      </h2>
      <ul
        aria-label="Agenda"
        className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
      >
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1 bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm">{entry.title}</span>
              <span
                className={
                  tone === 'overdue'
                    ? 'font-mono text-xs text-accent'
                    : 'font-mono text-xs text-muted'
                }
              >
                {entry.dueDate}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Link href={`/lists/${entry.listId}`} className="underline underline-offset-4">
                {entry.listName}
              </Link>
              {entry.priority !== 'none' && <span>· {entry.priority} priority</span>}
              {entry.tags.map((tag) => (
                <span key={tag.id} className="rounded-full border border-line px-2 py-0.5">
                  {tag.name}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
