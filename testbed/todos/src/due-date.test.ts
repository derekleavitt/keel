import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  compareCalendarDates,
  isDueOn,
  isDueOnOrBefore,
  isOverdue,
  todayIn,
} from './due-date.ts';

describe('todayIn', () => {
  it('gives different calendar days for one instant in different zones', () => {
    // 2026-06-15T11:00Z is the 15th in London and already the 15th late-evening in
    // Auckland (UTC+12 in June — winter there, so not +13).
    const instant = new Date('2026-06-15T23:30:00Z');
    expect(todayIn('Pacific/Auckland', instant)).toBe('2026-06-16');
    expect(todayIn('Europe/London', instant)).toBe('2026-06-16');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-06-15');
  });

  it('is stable across a DST boundary', () => {
    // US DST ends 2026-11-01. The calendar date must not wobble.
    const before = new Date('2026-11-01T05:30:00Z');
    const after = new Date('2026-11-01T09:30:00Z');
    expect(todayIn('America/New_York', before)).toBe('2026-11-01');
    expect(todayIn('America/New_York', after)).toBe('2026-11-01');
  });
});

describe('addCalendarDays', () => {
  it('crosses a month boundary', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('handles a leap day', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('goes backwards', () => {
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('does not skip a day across a DST transition', () => {
    // Local-time arithmetic would land on the same day here; UTC arithmetic does not.
    expect(addCalendarDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('comparison', () => {
  it('sorts chronologically as plain strings', () => {
    const dates = ['2026-12-01', '2026-01-31', '2026-02-01'];
    expect([...dates].sort(compareCalendarDates)).toEqual([
      '2026-01-31',
      '2026-02-01',
      '2026-12-01',
    ]);
  });

  it('treats a missing due date as never overdue and never due', () => {
    expect(isOverdue(null, '2026-06-15')).toBe(false);
    expect(isDueOn(null, '2026-06-15')).toBe(false);
    expect(isDueOnOrBefore(null, '2026-06-15')).toBe(false);
  });

  it('distinguishes overdue from due today', () => {
    expect(isOverdue('2026-06-14', '2026-06-15')).toBe(true);
    expect(isOverdue('2026-06-15', '2026-06-15')).toBe(false);
    expect(isDueOn('2026-06-15', '2026-06-15')).toBe(true);
    expect(isDueOnOrBefore('2026-06-15', '2026-06-15')).toBe(true);
  });
});
