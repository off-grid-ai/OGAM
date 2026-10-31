/**
 * session_summary aggregation (docs/ANALYTICS.md): what a session's counters add up to, the caps
 * that keep a summary small, and what survives a crash.
 */
import { SessionTally, SUMMARY_KEY_CAP, scrollBucket } from '../../../src/services/analytics/sessionTally';

describe('session tally', () => {
  it('adds up taps, long-presses, errors, settings, screens and the deepest scroll', () => {
    const tally = SessionTally.start(1_000);
    tally.count('actions', 'chat:send-button', 1_100);
    tally.count('actions', 'chat:send-button', 1_200);
    tally.count('actions', 'home:new-chat-button', 1_300);
    tally.count('long_press', 'chat:send-button', 1_350);
    tally.count('errors_shown', 'models:alert', 1_400);
    tally.count('settings_changed', 'theme=dark', 1_450);
    tally.screenViewed('home', 1_500);
    tally.screenViewed('chat', 1_600);
    tally.screenViewed('home', 1_700);
    tally.scrolled('home', 50, 1_800);
    tally.scrolled('home', 25, 1_900);
    tally.scrolled('settings', 100, 2_000);

    expect(tally.summary(4_000)).toEqual({
      session_ms: 3_000,
      screens: 2,
      screen_views: 3,
      max_scroll_pct: { home: 50, settings: 100 },
      actions: { 'chat:send-button': 2, 'home:new-chat-button': 1 },
      errors_shown: { 'models:alert': 1 },
      long_press: { 'chat:send-button': 1 },
      settings_changed: { 'theme=dark': 1 },
    });
  });

  it('sends only the 50 most used keys per counter, and ignores keys that are not ids', () => {
    const tally = SessionTally.start(0);
    for (let i = 0; i < 80; i += 1) {
      for (let n = 0; n <= i; n += 1) tally.count('actions', `home:button-${i}`, 1);
    }
    tally.count('actions', 'Home:My Diary.pdf', 1);
    tally.count('actions', '', 1);
    const actions = tally.summary(10).actions as Record<string, number>;
    expect(Object.keys(actions)).toHaveLength(SUMMARY_KEY_CAP);
    expect(actions['home:button-79']).toBe(80);
    expect(actions['home:button-30']).toBe(31);
    expect(actions['home:button-29']).toBeUndefined();
    expect(JSON.stringify(actions)).not.toMatch(/Diary/);
  });

  it('holds at most 200 keys while the session runs, so a runaway source cannot grow it', () => {
    const tally = SessionTally.start(0);
    for (let i = 0; i < 300; i += 1) tally.count('actions', `home:b-${i}`, 1);
    tally.count('actions', 'home:b-0', 1);
    expect(Object.keys(tally.toJSON().counters.actions)).toHaveLength(200);
    expect(tally.toJSON().counters.actions['home:b-0']).toBe(2);
    expect(tally.toJSON().counters.actions['home:b-250']).toBeUndefined();
  });

  it('rounds a scroll down to its quarter; the very bottom is 100', () => {
    expect([-1, 0, 0.1, 0.25, 0.49, 0.5, 0.74, 0.8, 0.97, 0.98, 1, Number.NaN].map(scrollBucket)).toEqual([
      0, 0, 0, 25, 25, 50, 50, 75, 75, 100, 100, 0,
    ]);
  });

  it('a crashed session comes back with its counters and the foreground time up to the last thing done', () => {
    const tally = SessionTally.start(1_000);
    tally.count('actions', 'chat:send-button', 5_000);
    tally.scrolled('chat', 75, 6_000);
    const restored = SessionTally.restore(JSON.parse(JSON.stringify(tally.toJSON())));
    expect(restored?.summary(99_999)).toMatchObject({
      session_ms: 5_000,
      actions: { 'chat:send-button': 1 },
      max_scroll_pct: { chat: 75 },
    });
  });

  it('drops anything malformed in a restored session instead of sending it', () => {
    expect(SessionTally.restore(null)).toBeNull();
    expect(SessionTally.restore({ startedAt: 'yesterday' })).toBeNull();
    const restored = SessionTally.restore({
      startedAt: 10,
      lastAt: 20,
      foregroundMs: 5,
      foregroundSince: null,
      screens: ['home', 'My Secret Project', 4],
      screenViews: 3,
      maxScroll: { home: 40, chat: 50 },
      counters: { actions: { 'home:send': 2, 'home:Diary.pdf': 1, 'home:x': -1 }, bogus: { a: 1 } },
    });
    expect(restored?.summary(20)).toEqual({
      session_ms: 5,
      screens: 1,
      screen_views: 3,
      max_scroll_pct: { chat: 50 },
      actions: { 'home:send': 2 },
      errors_shown: {},
      long_press: {},
      settings_changed: {},
    });
  });
});
