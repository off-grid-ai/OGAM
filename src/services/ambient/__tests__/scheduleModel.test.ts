import {
  normalizeMinuteOfDay,
  formatScheduleLabel,
  scheduledTimeToday,
  shouldRunScheduled,
  DEFAULT_PROCESSING_MINUTE_OF_DAY
} from '../scheduleModel'

describe('scheduleModel', () => {
  it('normalizes and wraps minute-of-day', () => {
    expect(normalizeMinuteOfDay(0)).toBe(0)
    expect(normalizeMinuteOfDay(24 * 60)).toBe(0)
    expect(normalizeMinuteOfDay(-30)).toBe(24 * 60 - 30)
    expect(normalizeMinuteOfDay(25 * 60)).toBe(60)
  })

  it('formats a 12-hour label', () => {
    expect(formatScheduleLabel(0)).toBe('12:00 AM')
    expect(formatScheduleLabel(3 * 60)).toBe('3:00 AM')
    expect(formatScheduleLabel(13 * 60 + 5)).toBe('1:05 PM')
    expect(formatScheduleLabel(12 * 60)).toBe('12:00 PM')
    expect(formatScheduleLabel(23 * 60 + 30)).toBe('11:30 PM')
  })

  it('default is midnight', () => {
    expect(DEFAULT_PROCESSING_MINUTE_OF_DAY).toBe(0)
    expect(formatScheduleLabel(DEFAULT_PROCESSING_MINUTE_OF_DAY)).toBe('12:00 AM')
  })

  it('scheduledTimeToday lands on the local time today', () => {
    const now = new Date(2026, 0, 15, 9, 0, 0, 0).getTime() // 9am Jan 15
    const target = new Date(scheduledTimeToday(now, 3 * 60))
    expect(target.getHours()).toBe(3)
    expect(target.getMinutes()).toBe(0)
    expect(target.getDate()).toBe(15)
  })

  it('does not run before the scheduled time', () => {
    const now = new Date(2026, 0, 15, 2, 0, 0).getTime() // 2am
    expect(shouldRunScheduled(now, 3 * 60, null)).toBe(false)
  })

  it('runs once at/after the time when never run', () => {
    const now = new Date(2026, 0, 15, 4, 0, 0).getTime() // 4am, after 3am
    expect(shouldRunScheduled(now, 3 * 60, null)).toBe(true)
  })

  it('does not run twice after the same day’s run', () => {
    const now = new Date(2026, 0, 15, 8, 0, 0).getTime()
    const ranAt = new Date(2026, 0, 15, 3, 5, 0).getTime() // ran just after 3am today
    expect(shouldRunScheduled(now, 3 * 60, ranAt)).toBe(false)
  })

  it('catches up the next day even if yesterday ran', () => {
    const now = new Date(2026, 0, 16, 5, 0, 0).getTime() // next day, 5am
    const ranAt = new Date(2026, 0, 15, 3, 5, 0).getTime() // ran yesterday
    expect(shouldRunScheduled(now, 3 * 60, ranAt)).toBe(true)
  })
})
