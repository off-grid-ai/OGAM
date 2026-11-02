/**
 * When a scheduled task is due. Pure (time is passed in), so it is tested without a device.
 * A task is due once for each time it was meant to run: the latest such time that has passed, if the task was
 * created before it and has not run for it yet. Missed runs do not pile up: after being away, a daily task runs once.
 */
export type Repeat = 'once' | 'daily' | 'weekdays' | 'weekly';

export interface ScheduleTiming {
  repeat: Repeat;
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday (weekly). */
  weekday?: number;
  /** The moment a one-time task is meant to run. */
  onceAt?: number;
  createdAt: number;
  lastRunAt?: number;
}

const DAY = 864e5;
const atTime = (day: Date, hour: number, minute: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).getTime();

const matchesDay = (t: ScheduleTiming, day: Date) =>
  t.repeat === 'daily' || (t.repeat === 'weekdays' && day.getDay() >= 1 && day.getDay() <= 5) || (t.repeat === 'weekly' && day.getDay() === (t.weekday ?? 1));

/** The latest time (<= now) this task was meant to run, or null. */
export function latestOccurrence(t: ScheduleTiming, now: number): number | null {
  if (t.repeat === 'once') return t.onceAt !== undefined && t.onceAt <= now ? t.onceAt : null;
  for (let back = 0; back <= 7; back++) {
    const day = new Date(now - back * DAY);
    if (!matchesDay(t, day)) continue;
    const at = atTime(day, t.hour, t.minute);
    if (at <= now) return at;
  }
  return null;
}

/** The next time (> now) this task will be meant to run, or null (a one-time task that has passed). */
export function nextOccurrence(t: ScheduleTiming, now: number): number | null {
  if (t.repeat === 'once') return t.onceAt !== undefined && t.onceAt > now ? t.onceAt : null;
  for (let ahead = 0; ahead <= 8; ahead++) {
    const day = new Date(now + ahead * DAY);
    if (!matchesDay(t, day)) continue;
    const at = atTime(day, t.hour, t.minute);
    if (at > now) return at;
  }
  return null;
}

/** True when the task should run now. */
export function isDue(t: ScheduleTiming & { enabled: boolean }, now: number): boolean {
  if (!t.enabled) return false;
  const occurrence = latestOccurrence(t, now);
  return occurrence !== null && occurrence >= t.createdAt && (t.lastRunAt ?? 0) < occurrence;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Every day at 07:30", "Weekdays at 08:00", "Every Monday at 09:15", "Once, Tuesday at 18:00". */
export function describeTiming(t: ScheduleTiming): string {
  const time = `${pad(t.hour)}:${pad(t.minute)}`;
  if (t.repeat === 'daily') return `Every day at ${time}`;
  if (t.repeat === 'weekdays') return `Weekdays at ${time}`;
  if (t.repeat === 'weekly') return `Every ${WEEKDAYS[t.weekday ?? 1]} at ${time}`;
  return t.onceAt !== undefined ? `Once, ${WEEKDAYS[new Date(t.onceAt).getDay()]} at ${time}` : 'Once';
}

/** The next moment at hour:minute, today if it has not passed yet, else tomorrow (for a one-time task). */
export function nextTimeOfDay(hour: number, minute: number, now: number): number {
  const today = atTime(new Date(now), hour, minute);
  return today > now ? today : atTime(new Date(now + DAY), hour, minute);
}
