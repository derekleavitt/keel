/**
 * Recurrence: turning a rule into the calendar dates it covers.
 *
 * Pure functions over `YYYY-MM-DD` strings — no database, no clock except the one you pass
 * in. Everything that makes recurrence hard is date arithmetic, and date arithmetic is
 * exactly the thing that is miserable to debug through a database and a job queue.
 *
 * ## The two rules that keep this correct
 *
 * **1. A calendar date is not an instant, and must never be manipulated as one.** The
 * classic bug is advancing a day by adding 86,400,000 milliseconds. Across a daylight
 * saving boundary a local day is 23 or 25 hours, so that addition lands on the previous or
 * next day and every subsequent occurrence is shifted. All arithmetic here happens in UTC,
 * which has no DST, and dates are only ever interpreted in a zone when answering "what day
 * is it *there*".
 *
 * **2. "Today" is a question about a place.** At 2026-03-08T06:30:00Z it is March 8th in
 * London and still March 7th in Denver. A generator that uses the server's idea of today
 * creates tomorrow's todo early for anyone west of it, and misses today's for anyone east.
 * `todayIn()` is the only way this module asks what day it is.
 */

export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceRule {
  frequency: Frequency;
  /** Every N days/weeks/months. Must be >= 1. */
  interval: number;
  /** Weekly only: days of the week, 0 = Sunday. Empty means "the start date's weekday". */
  byWeekday?: number[];
  /** `YYYY-MM-DD`. The series never produces a date before this. */
  startDate: string;
  /** `YYYY-MM-DD`, inclusive. Null means it runs forever. */
  until?: string | null;
  /** IANA zone, e.g. `America/Denver`. Decides what "today" means for this series. */
  timeZone: string;
}

/** A calendar date, decomposed. No time, no zone — those are separate questions. */
interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function formatDate({ year, month, day }: CalendarDate): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parseDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Not a calendar date: ${value}`);
  const [, year, month, day] = match as unknown as [string, string, string, string];
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/**
 * The date, as a UTC instant at midnight.
 *
 * UTC deliberately: this is a *calculation* space, not a moment anybody experiences. UTC
 * has no daylight saving, so adding days here can never drift.
 */
function toUtc(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromUtc(ms: number): CalendarDate {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** Add whole days. Safe across every boundary, because UTC has none. */
export function addDays(value: string, days: number): string {
  return formatDate(fromUtc(toUtc(parseDate(value)) + days * 86_400_000));
}

/** 0 = Sunday. */
export function weekdayOf(value: string): number {
  return new Date(toUtc(parseDate(value))).getUTCDay();
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The last day of a month, so February and the 31st can be reconciled. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add whole months, **clamping** the day to the end of the target month.
 *
 * "Monthly on the 31st" in a 30-day month has no correct answer, only a chosen one.
 * RFC 5545 skips the month entirely. This clamps to the last day instead, because for a
 * todo list the rule people mean by "the 31st" is almost always "the end of the month" —
 * skipping silently produces no todo at all, and a missing reminder is a worse failure
 * than one that lands a day early. The departure is deliberate; see the tests.
 */
export function addMonths(value: string, months: number): string {
  const date = parseDate(value);
  const zeroBased = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return formatDate({ year, month, day: Math.min(date.day, daysInMonth(year, month)) });
}

/**
 * What day it is in a given place.
 *
 * `en-CA` formats as `YYYY-MM-DD`, which is the one locale that gives an ISO date straight
 * out of `Intl` with no reassembly.
 */
export function todayIn(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Reject a rule that would loop forever or produce nonsense, with a usable reason. */
export function validateRule(rule: RecurrenceRule): string | null {
  if (!Number.isInteger(rule.interval) || rule.interval < 1) return 'Interval must be at least 1';
  try {
    parseDate(rule.startDate);
    if (rule.until) parseDate(rule.until);
  } catch {
    return 'Dates must be YYYY-MM-DD';
  }
  if (rule.until && compareDates(rule.until, rule.startDate) < 0) {
    return 'The end date is before the start date';
  }
  if (rule.byWeekday?.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return 'Weekdays must be 0 (Sunday) to 6 (Saturday)';
  }
  try {
    todayIn(rule.timeZone);
  } catch {
    return 'Unknown time zone';
  }
  return null;
}

/** A hard ceiling, so a one-day interval over a decade cannot be requested by accident. */
export const MAX_OCCURRENCES = 500;

/**
 * Every date the rule produces within `[from, to]`, inclusive, in ascending order.
 *
 * Bounded by both the window and `MAX_OCCURRENCES` — an unbounded expansion driven by
 * user-supplied dates is a denial of service with extra steps.
 */
export function expandOccurrences(
  rule: RecurrenceRule,
  window: { from: string; to: string },
): string[] {
  if (validateRule(rule)) return [];

  const last = rule.until && compareDates(rule.until, window.to) < 0 ? rule.until : window.to;
  if (compareDates(rule.startDate, last) > 0) return [];

  const results: string[] = [];
  const emit = (date: string) => {
    if (compareDates(date, window.from) >= 0 && compareDates(date, last) <= 0) {
      results.push(date);
    }
  };

  if (rule.frequency === 'daily') {
    for (
      let date = rule.startDate;
      compareDates(date, last) <= 0 && results.length < MAX_OCCURRENCES;
      date = addDays(date, rule.interval)
    ) {
      emit(date);
    }
    return results;
  }

  if (rule.frequency === 'weekly') {
    const weekdays = rule.byWeekday?.length
      ? [...new Set(rule.byWeekday)].sort((a, b) => a - b)
      : [weekdayOf(rule.startDate)];

    /*
     * Weeks are anchored to the Sunday on or before the start date, not to the start date
     * itself. Otherwise "every 2 weeks on Mon and Thu" starting on a Thursday would count
     * its fortnights from Thursday, and the Monday in the same week would belong to a
     * different cycle than the Thursday beside it.
     */
    const anchor = addDays(rule.startDate, -weekdayOf(rule.startDate));

    for (
      let weekStart = anchor;
      compareDates(weekStart, last) <= 0 && results.length < MAX_OCCURRENCES;
      weekStart = addDays(weekStart, 7 * rule.interval)
    ) {
      for (const weekday of weekdays) {
        const date = addDays(weekStart, weekday);
        if (compareDates(date, rule.startDate) >= 0) emit(date);
      }
    }
    return results.sort(compareDates);
  }

  for (
    let date = rule.startDate;
    compareDates(date, last) <= 0 && results.length < MAX_OCCURRENCES;
    date = addMonths(date, rule.interval)
  ) {
    emit(date);
  }
  return results;
}
