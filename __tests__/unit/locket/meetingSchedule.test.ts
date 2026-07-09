/**
 * Unit tests for the pure meeting-reminder scheduling math (selection window,
 * fire time, notification ids). No notifee / calendar / native imports.
 */
import {
  selectUpcomingMeetings,
  reminderFireTime,
  reminderNotificationId,
  isReminderId,
} from '../../../pro/locket/utils/meetingSchedule';
import type { MatchEvent } from '../../../pro/locket/utils/calendarMatch';

const iso = (ms: number) => new Date(ms).toISOString();
const NOW = 1_000_000_000_000; // fixed "now"
const WINDOW = 24 * 60 * 60 * 1000; // 24h
const MIN = 60_000;

const ev = (over: Partial<MatchEvent>): MatchEvent => ({
  id: 'e',
  title: 'Standup',
  startDate: iso(NOW + 30 * MIN),
  endDate: iso(NOW + 60 * MIN),
  ...over,
});

describe('selectUpcomingMeetings', () => {
  it('keeps a timed meeting starting inside the window', () => {
    const out = selectUpcomingMeetings([ev({})], NOW, WINDOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'e', title: 'Standup', startMs: NOW + 30 * MIN, endMs: NOW + 60 * MIN });
  });

  it('drops meetings that already started (in the past)', () => {
    expect(selectUpcomingMeetings([ev({ id: 'p', startDate: iso(NOW - MIN) })], NOW, WINDOW)).toEqual([]);
  });

  it('drops meetings beyond the window', () => {
    expect(selectUpcomingMeetings([ev({ id: 'far', startDate: iso(NOW + WINDOW + MIN) })], NOW, WINDOW)).toEqual([]);
  });

  it('skips all-day events (they would match the whole day)', () => {
    expect(selectUpcomingMeetings([ev({ allDay: true })], NOW, WINDOW)).toEqual([]);
  });

  it('skips events with an unparseable start', () => {
    expect(selectUpcomingMeetings([ev({ startDate: 'not-a-date' })], NOW, WINDOW)).toEqual([]);
  });

  it('dedupes by event id', () => {
    const out = selectUpcomingMeetings([ev({}), ev({})], NOW, WINDOW);
    expect(out).toHaveLength(1);
  });

  it('sorts by start time', () => {
    const a = ev({ id: 'a', startDate: iso(NOW + 3 * 60 * MIN) });
    const b = ev({ id: 'b', startDate: iso(NOW + 30 * MIN) });
    expect(selectUpcomingMeetings([a, b], NOW, WINDOW).map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('defaults a missing/invalid end to start + 1h, and a blank title to "Meeting"', () => {
    const out = selectUpcomingMeetings([ev({ endDate: undefined, title: '   ' })], NOW, WINDOW);
    expect(out[0].endMs).toBe(NOW + 30 * MIN + 60 * MIN);
    expect(out[0].title).toBe('Meeting');
  });
});

describe('reminderFireTime', () => {
  it('fires leadMs before the start', () => {
    expect(reminderFireTime(NOW + 30 * MIN, 2 * MIN, NOW)).toBe(NOW + 28 * MIN);
  });

  it('never returns a time in the past when the lead exceeds the time-to-start', () => {
    // Meeting in 1 min, lead 5 min -> would be in the past; clamps to ~now.
    expect(reminderFireTime(NOW + MIN, 5 * MIN, NOW)).toBe(NOW + 1000);
  });
});

describe('reminderNotificationId / isReminderId', () => {
  it('round-trips a stable, recognizable id', () => {
    const id = reminderNotificationId('event-42');
    expect(id).toBe('meeting-reminder-event-42');
    expect(isReminderId(id)).toBe(true);
    expect(isReminderId('some-other-notification')).toBe(false);
  });
});
