/**
 * formatWhen — how a list says when something last happened, counted in calendar days on this
 * device's clock: the time today, Yesterday, the weekday this week, Last week, N weeks ago, then the
 * date from four weeks on.
 */
import { formatClockTime, formatShortDate, formatWeekday, formatWhen } from '../../../src/utils/localTime';

const NOW = new Date(2026, 9, 30, 14, 5); // Fri Oct 30 2026, 2:05 PM local

/** The same wall-clock time `days` calendar days before NOW. */
function daysAgo(days: number, hour = 14): Date {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(hour);
  return date;
}

describe('formatWhen', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('reads the clock time for today, and for a time later today', () => {
    expect(formatWhen(new Date(2026, 9, 30, 9, 7))).toBe('9:07 AM');
    expect(formatWhen(new Date(2026, 9, 30, 23, 59))).toBe('11:59 PM');
  });

  it('reads Yesterday for the calendar day before, even two hours ago', () => {
    jest.setSystemTime(new Date(2026, 9, 31, 1, 0));
    expect(formatWhen(new Date(2026, 9, 30, 23, 0))).toBe('Yesterday');
  });

  it('reads the weekday from 2 to 6 days ago', () => {
    expect(formatWhen(daysAgo(2))).toBe('Wed');
    expect(formatWhen(daysAgo(6))).toBe('Sat');
  });

  it('reads Last week from 7 to 13 days ago', () => {
    expect(formatWhen(daysAgo(7))).toBe('Last week');
    expect(formatWhen(daysAgo(13))).toBe('Last week');
  });

  it('reads N weeks ago from 14 to 27 days ago', () => {
    expect(formatWhen(daysAgo(14))).toBe('2 weeks ago');
    expect(formatWhen(daysAgo(20))).toBe('2 weeks ago');
    expect(formatWhen(daysAgo(21))).toBe('3 weeks ago');
    expect(formatWhen(daysAgo(27))).toBe('3 weeks ago');
  });

  it('reads the short date from 28 days ago', () => {
    expect(formatWhen(daysAgo(28))).toBe('Oct 2');
    expect(formatWhen(new Date(2025, 11, 25, 8, 0))).toBe('Dec 25');
  });

  it('takes a timestamp or an ISO string as well as a Date', () => {
    expect(formatWhen(daysAgo(1).getTime())).toBe('Yesterday');
    expect(formatWhen(daysAgo(10).toISOString())).toBe('Last week');
  });
});

describe('the parts formatWhen is made of', () => {
  it('formats the clock with 12 for noon and midnight', () => {
    expect(formatClockTime(new Date(2026, 0, 1, 0, 5))).toBe('12:05 AM');
    expect(formatClockTime(new Date(2026, 0, 1, 12, 0))).toBe('12:00 PM');
  });

  it('names the weekday and the short date', () => {
    expect(formatWeekday(new Date(2026, 9, 30))).toBe('Fri');
    expect(formatShortDate(new Date(2026, 2, 4))).toBe('Mar 4');
  });

  it('names no weekday or month for a date that cannot be read', () => {
    expect(formatWeekday('not a date')).toBe('');
    expect(formatShortDate('not a date')).toBe(' NaN');
  });
});
