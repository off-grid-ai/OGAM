/**
 * When the nightly/deferred queue should drain. "Later" mode queues captures; this decides the clock
 * time that batch runs. A true background task fires it at the time; if that never ran (iOS gated it,
 * app was off), the app catches up on next open. Pure so both legs share one rule and it can be tested.
 */

/** Minutes since local midnight. Default: midnight. */
export const DEFAULT_PROCESSING_MINUTE_OF_DAY = 0

/** Quick presets offered next to the custom stepper. */
export const SCHEDULE_PRESETS: { label: string; minuteOfDay: number }[] = [
  { label: 'Midnight', minuteOfDay: 0 },
  { label: '3 AM', minuteOfDay: 3 * 60 },
  { label: '6 AM', minuteOfDay: 6 * 60 }
]

/** Clamp + wrap a minute-of-day into [0, 1439]. */
export function normalizeMinuteOfDay(minuteOfDay: number): number {
  const m = Math.round(minuteOfDay) % (24 * 60)
  return m < 0 ? m + 24 * 60 : m
}

/** "12:00 AM", "3:00 AM", "10:30 PM" - 12-hour label for a minute-of-day. */
export function formatScheduleLabel(minuteOfDay: number): string {
  const m = normalizeMinuteOfDay(minuteOfDay)
  const h24 = Math.floor(m / 60)
  const min = m % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`
}

/** The epoch-ms of today's scheduled time, in local time, relative to `nowMs`. */
export function scheduledTimeToday(nowMs: number, minuteOfDay: number): number {
  const d = new Date(nowMs)
  d.setHours(Math.floor(normalizeMinuteOfDay(minuteOfDay) / 60), normalizeMinuteOfDay(minuteOfDay) % 60, 0, 0)
  return d.getTime()
}

/**
 * Should the deferred queue drain right now? True when we're at/after today's scheduled time AND the
 * last scheduled run was before it (so we run once per day, and a missed night is caught up on open).
 */
export function shouldRunScheduled(
  nowMs: number,
  minuteOfDay: number,
  lastRunMs: number | null
): boolean {
  const target = scheduledTimeToday(nowMs, minuteOfDay)
  if (nowMs < target) return false
  if (lastRunMs == null) return true
  return lastRunMs < target
}
