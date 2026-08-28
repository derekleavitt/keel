import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  expandOccurrences,
  MAX_OCCURRENCES,
  type RecurrenceRule,
  todayIn,
  validateRule,
  weekdayOf,
} from './recurrence.ts';

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: 'daily',
  interval: 1,
  startDate: '2026-03-01',
  timeZone: 'America/Denver',
  ...over,
});

describe('date arithmetic across daylight saving', () => {
  /*
   * The bug this whole module is shaped to avoid. In America/Denver, 2026-03-08 is 23
   * hours long — adding 86,400,000ms to local midnight lands at 01:00 the next day, and
   * naive implementations either repeat or skip a date from here on.
   */
  it('advances one day per day through a spring-forward boundary', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('advances one day per day through an autumn boundary', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('produces exactly one occurrence per day across the transition', () => {
    const dates = expandOccurrences(rule({ startDate: '2026-03-06' }), {
      from: '2026-03-06',
      to: '2026-03-11',
    });
    expect(dates).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ]);
    expect(new Set(dates).size).toBe(dates.length);
  });

  /** The southern hemisphere transitions in the other direction, in a different month. */
  it('is correct in a zone whose DST runs the other way', () => {
    const dates = expandOccurrences(
      rule({ startDate: '2026-04-03', timeZone: 'Australia/Sydney' }),
      { from: '2026-04-03', to: '2026-04-07' },
    );
    expect(dates).toEqual(['2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06', '2026-04-07']);
  });

  it('keeps a weekly series on the same weekday across a transition', () => {
    const dates = expandOccurrences(rule({ frequency: 'weekly', startDate: '2026-03-02' }), {
      from: '2026-03-02',
      to: '2026-03-30',
    });
    expect(dates.map(weekdayOf)).toEqual([1, 1, 1, 1, 1]);
    expect(dates).toContain('2026-03-09');
  });
});

describe('"today" is a question about a place', () => {
  /*
   * The same instant is two different dates. A generator using the server's today creates
   * tomorrow's todo early for everyone west of it.
   */
  it('differs by zone at the same instant', () => {
    const instant = new Date('2026-03-08T06:30:00Z');
    expect(todayIn('Europe/London', instant)).toBe('2026-03-08');
    expect(todayIn('America/Denver', instant)).toBe('2026-03-07');
    expect(todayIn('Pacific/Auckland', instant)).toBe('2026-03-08');
  });

  it('handles the instant a zone crosses midnight', () => {
    expect(todayIn('America/Denver', new Date('2026-07-02T05:59:00Z'))).toBe('2026-07-01');
    expect(todayIn('America/Denver', new Date('2026-07-02T06:01:00Z'))).toBe('2026-07-02');
  });
});

describe('daily', () => {
  it('respects an interval', () => {
    expect(
      expandOccurrences(rule({ interval: 3 }), { from: '2026-03-01', to: '2026-03-10' }),
    ).toEqual(['2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10']);
  });

  it('never produces a date before the start', () => {
    expect(
      expandOccurrences(rule({ startDate: '2026-03-05' }), {
        from: '2026-03-01',
        to: '2026-03-06',
      }),
    ).toEqual(['2026-03-05', '2026-03-06']);
  });

  it('stops at `until`, inclusive', () => {
    expect(
      expandOccurrences(rule({ until: '2026-03-03' }), { from: '2026-03-01', to: '2026-03-31' }),
    ).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  });

  it('is empty when the window precedes the series', () => {
    expect(
      expandOccurrences(rule({ startDate: '2026-05-01' }), {
        from: '2026-03-01',
        to: '2026-03-31',
      }),
    ).toEqual([]);
  });
});

describe('weekly', () => {
  it('defaults to the start date’s weekday', () => {
    const dates = expandOccurrences(rule({ frequency: 'weekly', startDate: '2026-03-04' }), {
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(dates).toEqual(['2026-03-04', '2026-03-11', '2026-03-18', '2026-03-25']);
  });

  it('supports several weekdays', () => {
    const dates = expandOccurrences(
      rule({ frequency: 'weekly', startDate: '2026-03-02', byWeekday: [1, 4] }),
      { from: '2026-03-01', to: '2026-03-15' },
    );
    expect(dates).toEqual([
      '2026-03-02',
      '2026-03-05',
      '2026-03-09',
      '2026-03-12',
      // 2026-03-15 is a Sunday, so the next Monday falls outside the window.
    ]);
  });

  /*
   * Fortnights are counted from the week, not from the start date. Anchoring on the start
   * date would put a Monday and the Thursday beside it in different cycles.
   */
  it('keeps multiple weekdays in the same fortnight together', () => {
    const dates = expandOccurrences(
      rule({ frequency: 'weekly', interval: 2, startDate: '2026-03-05', byWeekday: [1, 4] }),
      { from: '2026-03-01', to: '2026-03-31' },
    );
    expect(dates).toEqual(['2026-03-05', '2026-03-16', '2026-03-19', '2026-03-30']);
  });

  it('deduplicates repeated weekdays', () => {
    const dates = expandOccurrences(
      rule({ frequency: 'weekly', startDate: '2026-03-02', byWeekday: [1, 1, 1] }),
      { from: '2026-03-01', to: '2026-03-10' },
    );
    expect(dates).toEqual(['2026-03-02', '2026-03-09']);
  });
});

describe('monthly', () => {
  it('keeps the day of the month', () => {
    expect(
      expandOccurrences(rule({ frequency: 'monthly', startDate: '2026-01-15' }), {
        from: '2026-01-01',
        to: '2026-04-30',
      }),
    ).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  /*
   * A deliberate departure from RFC 5545, which skips the month entirely. For a todo list
   * "the 31st" almost always means "the end of the month", and a missing reminder is a
   * worse failure than one that lands a day early.
   */
  it('clamps to the end of a short month rather than skipping it', () => {
    expect(
      expandOccurrences(rule({ frequency: 'monthly', startDate: '2026-01-31' }), {
        from: '2026-01-01',
        to: '2026-04-30',
      }),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28']);
  });

  it('handles a leap February', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('crosses a year boundary', () => {
    expect(
      expandOccurrences(rule({ frequency: 'monthly', interval: 2, startDate: '2026-11-10' }), {
        from: '2026-11-01',
        to: '2027-04-01',
      }),
    ).toEqual(['2026-11-10', '2027-01-10', '2027-03-10']);
  });
});

describe('refusing bad rules', () => {
  it.each([
    ['a zero interval', { interval: 0 }, 'Interval must be at least 1'],
    ['a negative interval', { interval: -1 }, 'Interval must be at least 1'],
    ['a fractional interval', { interval: 1.5 }, 'Interval must be at least 1'],
    ['an end before the start', { until: '2026-01-01' }, 'The end date is before the start date'],
    ['a bad weekday', { byWeekday: [9] }, 'Weekdays must be 0 (Sunday) to 6 (Saturday)'],
    ['an unknown zone', { timeZone: 'Mars/Olympus' }, 'Unknown time zone'],
    ['a malformed date', { startDate: '01/03/2026' }, 'Dates must be YYYY-MM-DD'],
  ])('rejects %s', (_label, over, message) => {
    expect(validateRule(rule(over as Partial<RecurrenceRule>))).toBe(message);
  });

  it('accepts a well-formed rule', () => {
    expect(validateRule(rule())).toBeNull();
  });

  /** An unbounded expansion driven by user-supplied dates is a denial of service. */
  it('never returns more than the ceiling', () => {
    const dates = expandOccurrences(rule({ startDate: '2000-01-01' }), {
      from: '2000-01-01',
      to: '2050-01-01',
    });
    expect(dates).toHaveLength(MAX_OCCURRENCES);
  });

  it('returns nothing for an invalid rule rather than throwing', () => {
    expect(
      expandOccurrences(rule({ interval: 0 }), { from: '2026-01-01', to: '2026-12-31' }),
    ).toEqual([]);
  });
});
