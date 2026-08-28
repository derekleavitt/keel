import { RelativeTime } from './relative-time.tsx';

export type ActivityRow = {
  id: string;
  action: string;
  actorEmail: string;
  summary: string;
  createdAt: Date;
};

/**
 * The feed renders entirely from the entry.
 *
 * No joins back to lists or todos — the summary was composed when the event happened, and
 * half these rows describe things that no longer exist. A feed that resolves ids at read
 * time shows "(deleted)" exactly where the history is most interesting.
 */
export function ActivityFeed({ rows, empty }: { rows: ActivityRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;

  return (
    <ol
      aria-label="Activity"
      className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
    >
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1 bg-surface px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">
              <span className="text-muted">{row.actorEmail}</span> {row.summary}
            </span>
            <RelativeTime at={row.createdAt} />
          </div>
          <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
            {row.action}
          </span>
        </li>
      ))}
    </ol>
  );
}
