import { describeTiming, isDue, latestOccurrence, nextOccurrence, nextTimeOfDay, type ScheduleTiming } from '../../../src/schedule/due';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
// 2026-11-04 is a Wednesday.
const base = (over: Partial<ScheduleTiming & { enabled: boolean }>): ScheduleTiming & { enabled: boolean } =>
  ({ repeat: 'daily', hour: 8, minute: 0, createdAt: at(2026, 11, 1), enabled: true, ...over });

describe('scheduled task timing', () => {
  it('a daily task is due after its time today, once, and not before', () => {
    expect(isDue(base({}), at(2026, 11, 4, 7, 59))).toBe(true); // yesterday 08:00 was missed: runs once on return
    const t = base({ lastRunAt: at(2026, 11, 3, 8, 0) });
    expect(isDue(t, at(2026, 11, 4, 7, 59))).toBe(false);
    expect(isDue(t, at(2026, 11, 4, 8, 1))).toBe(true);
    expect(isDue({ ...t, lastRunAt: at(2026, 11, 4, 8, 0) }, at(2026, 11, 4, 23, 0))).toBe(false);
  });
  it('a new task does not run for a time before it was made', () => {
    const t = base({ createdAt: at(2026, 11, 4, 9, 0) });
    expect(isDue(t, at(2026, 11, 4, 9, 30))).toBe(false);
    expect(isDue(t, at(2026, 11, 5, 8, 1))).toBe(true);
  });
  it('after days away a task runs once, not once per missed day', () => {
    const t = base({ lastRunAt: at(2026, 11, 1, 8, 0) });
    expect(latestOccurrence(t, at(2026, 11, 8, 12, 0))).toBe(at(2026, 11, 8, 8, 0));
    expect(isDue(t, at(2026, 11, 8, 12, 0))).toBe(true);
    expect(isDue({ ...t, lastRunAt: at(2026, 11, 8, 8, 0) }, at(2026, 11, 8, 12, 0))).toBe(false);
  });
  it('weekdays skip the weekend, and a weekly task waits for its day', () => {
    // Sunday 2026-11-08 at noon: the latest weekday run was Friday the 6th.
    expect(latestOccurrence(base({ repeat: 'weekdays' }), at(2026, 11, 8, 12, 0))).toBe(at(2026, 11, 6, 8, 0));
    expect(nextOccurrence(base({ repeat: 'weekdays' }), at(2026, 11, 7, 12, 0))).toBe(at(2026, 11, 9, 8, 0));
    const weekly = base({ repeat: 'weekly', weekday: 1 }); // Monday
    expect(latestOccurrence(weekly, at(2026, 11, 4, 12, 0))).toBe(at(2026, 11, 2, 8, 0));
    expect(nextOccurrence(weekly, at(2026, 11, 4, 12, 0))).toBe(at(2026, 11, 9, 8, 0));
  });
  it('a one-time task runs once at its moment and never again', () => {
    const t = base({ repeat: 'once', onceAt: at(2026, 11, 5, 18, 0), createdAt: at(2026, 11, 4) });
    expect(isDue(t, at(2026, 11, 5, 17, 59))).toBe(false);
    expect(isDue(t, at(2026, 11, 5, 18, 1))).toBe(true);
    expect(isDue({ ...t, lastRunAt: at(2026, 11, 5, 18, 0) }, at(2026, 11, 6))).toBe(false);
    expect(nextOccurrence(t, at(2026, 11, 6))).toBeNull();
  });
  it('a switched-off task is never due', () => {
    expect(isDue(base({ enabled: false }), at(2026, 11, 4, 12))).toBe(false);
  });
  it('describes the timing in words, and picks today or tomorrow for a one-time time', () => {
    expect(describeTiming(base({ hour: 7, minute: 5 }))).toBe('Every day at 07:05');
    expect(describeTiming(base({ repeat: 'weekly', weekday: 0 }))).toBe('Every Sunday at 08:00');
    expect(nextTimeOfDay(18, 0, at(2026, 11, 4, 9, 0))).toBe(at(2026, 11, 4, 18, 0));
    expect(nextTimeOfDay(8, 0, at(2026, 11, 4, 9, 0))).toBe(at(2026, 11, 5, 8, 0));
  });
});
