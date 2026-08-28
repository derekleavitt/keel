/**
 * A timestamp rendered as "3 minutes ago".
 *
 * Server-rendered, deliberately: the alternative formats on the client, which means the
 * first paint shows either nothing or a raw ISO string, and the feed flickers as it
 * hydrates. The cost is that the text ages until the next request — acceptable for a log,
 * where "2 hours ago" being a minute stale changes nothing. The exact instant stays
 * available in the `title`.
 */
export function RelativeTime({ at }: { at: Date }) {
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));

  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds < 60
      ? [seconds, 'second']
      : seconds < 3600
        ? [Math.round(seconds / 60), 'minute']
        : seconds < 86_400
          ? [Math.round(seconds / 3600), 'hour']
          : [Math.round(seconds / 86_400), 'day'];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  return (
    <time dateTime={at.toISOString()} title={at.toISOString()} className="text-xs text-muted">
      {formatter.format(-value, unit)}
    </time>
  );
}
