/**
 * Calendar-date arithmetic.
 *
 * Due dates are calendar days, not instants. "Due Tuesday" means Tuesday for a user in
 * Auckland and for one in Los Angeles, so nothing here ever converts to local time.
 *
 * All arithmetic is done in UTC, which cannot skip or repeat a day at a DST boundary the
 * way local-time arithmetic can. Comparison is plain string comparison — fixed-width ISO
 * dates sort chronologically, so `<` is both correct and cheaper than parsing.
 */
export type CalendarDate = string;

/** Today, as the user's calendar sees it in `timeZone`. */
export function todayIn(timeZone: string, instant: Date = new Date()): CalendarDate {
  // en-CA formats as YYYY-MM-DD, which is what we want to store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Shift a calendar date by whole days, in UTC so DST cannot move it. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isOverdue(dueDate: CalendarDate | null, today: CalendarDate): boolean {
  return dueDate !== null && dueDate < today;
}

export function isDueOn(dueDate: CalendarDate | null, day: CalendarDate): boolean {
  return dueDate === day;
}

export function isDueOnOrBefore(dueDate: CalendarDate | null, day: CalendarDate): boolean {
  return dueDate !== null && dueDate <= day;
}
