/**
 * Per-interaction counters, kept on the device and sent once per session as `session_summary`
 * (docs/ANALYTICS.md). A tap, a long-press, a scroll or an error shown is never an event of its own:
 * that keeps the event budget, and sends nothing a single interaction could reveal.
 *
 * Pure: no I/O. The analytics owner persists `toJSON()` so a crash still reports on the next launch.
 * OGAD keeps the same class (src/main/analytics/session-tally.ts); the summary shape is shared.
 */
import { ms } from './values';

const SUMMARY_COUNTERS = ['actions', 'errors_shown', 'long_press', 'settings_changed'] as const;
export type SummaryCounter = (typeof SUMMARY_COUNTERS)[number];

const SCROLL_BUCKETS = [0, 25, 50, 75, 100] as const;
export type ScrollBucket = (typeof SCROLL_BUCKETS)[number];

/** Keys a summary sends per counter: the most used first. */
export const SUMMARY_KEY_CAP = 50;
/** Keys held per counter while the session runs, so a runaway source cannot grow it. */
const TRACKED_KEY_CAP = 200;
const KEY = /^[a-z0-9][a-z0-9:_=-]{0,95}$/;

/** A scroll fraction (0..1) rounded down to its quarter; the very bottom counts as 100. */
export function scrollBucket(fraction: number): ScrollBucket {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  if (fraction >= 0.98) return 100;
  return SCROLL_BUCKETS[Math.min(3, Math.floor(fraction * 4))];
}

export interface SessionState {
  startedAt: number;
  /** Time in the foreground before `foregroundSince`. */
  foregroundMs: number;
  /** When the current foreground stretch began; null in the background. */
  foregroundSince: number | null;
  lastAt: number;
  screens: string[];
  screenViews: number;
  maxScroll: Record<string, ScrollBucket>;
  counters: Record<SummaryCounter, Record<string, number>>;
}

function emptyCounters(): Record<SummaryCounter, Record<string, number>> {
  return Object.fromEntries(SUMMARY_COUNTERS.map(name => [name, {}])) as Record<
    SummaryCounter,
    Record<string, number>
  >;
}

function topKeys(counts: Record<string, number>, cap: number): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, cap));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

function restoreCounters(raw: unknown): Record<SummaryCounter, Record<string, number>> {
  const counters = emptyCounters();
  if (!isRecord(raw)) return counters;
  for (const name of SUMMARY_COUNTERS) {
    const counts = raw[name];
    if (!isRecord(counts)) continue;
    for (const [key, count] of Object.entries(counts).slice(0, TRACKED_KEY_CAP)) {
      if (KEY.test(key) && isCount(count)) counters[name][key] = count;
    }
  }
  return counters;
}

function restoreScroll(raw: unknown): Record<string, ScrollBucket> {
  const maxScroll: Record<string, ScrollBucket> = {};
  if (!isRecord(raw)) return maxScroll;
  for (const [screen, pct] of Object.entries(raw).slice(0, TRACKED_KEY_CAP)) {
    if (KEY.test(screen) && (SCROLL_BUCKETS as readonly unknown[]).includes(pct)) {
      maxScroll[screen] = pct as ScrollBucket;
    }
  }
  return maxScroll;
}

export class SessionTally {
  private constructor(readonly state: SessionState) {}

  static start(now: number): SessionTally {
    return new SessionTally({
      startedAt: now,
      foregroundMs: 0,
      foregroundSince: now,
      lastAt: now,
      screens: [],
      screenViews: 0,
      maxScroll: {},
      counters: emptyCounters(),
    });
  }

  /** A session persisted before the app died. Anything malformed is dropped, not repaired. */
  static restore(raw: unknown): SessionTally | null {
    if (!isRecord(raw)) return null;
    const startedAt = num(raw.startedAt);
    if (!startedAt) return null;
    const lastAt = Math.max(startedAt, num(raw.lastAt));
    const since = typeof raw.foregroundSince === 'number' ? num(raw.foregroundSince) : null;
    const screens = Array.isArray(raw.screens)
      ? raw.screens.filter((s): s is string => typeof s === 'string' && KEY.test(s))
      : [];
    return new SessionTally({
      startedAt,
      // A crash ends the foreground stretch at the last thing that happened.
      foregroundMs: num(raw.foregroundMs) + (since !== null ? Math.max(0, lastAt - since) : 0),
      foregroundSince: null,
      lastAt,
      screens: screens.slice(0, TRACKED_KEY_CAP),
      screenViews: Math.floor(num(raw.screenViews)),
      maxScroll: restoreScroll(raw.maxScroll),
      counters: restoreCounters(raw.counters),
    });
  }

  count(counter: SummaryCounter, key: string, now: number): void {
    if (!KEY.test(key)) return;
    const counts = this.state.counters[counter];
    if (counts[key] === undefined && Object.keys(counts).length >= TRACKED_KEY_CAP) return;
    counts[key] = (counts[key] ?? 0) + 1;
    this.state.lastAt = now;
  }

  screenViewed(screen: string, now: number): void {
    if (!KEY.test(screen)) return;
    this.state.screenViews += 1;
    if (!this.state.screens.includes(screen) && this.state.screens.length < TRACKED_KEY_CAP) {
      this.state.screens.push(screen);
    }
    this.state.lastAt = now;
  }

  /** The deepest point reached on a screen. Returns true when it went deeper. */
  scrolled(screen: string, pct: ScrollBucket, now: number): boolean {
    if (!KEY.test(screen)) return false;
    const known = this.state.maxScroll[screen];
    if (known === undefined && Object.keys(this.state.maxScroll).length >= TRACKED_KEY_CAP) return false;
    if (known !== undefined && pct <= known) return false;
    this.state.maxScroll[screen] = pct;
    this.state.lastAt = now;
    return true;
  }

  foreground(now: number): void {
    if (this.state.foregroundSince === null) this.state.foregroundSince = now;
    this.state.lastAt = now;
  }

  background(now: number): void {
    const since = this.state.foregroundSince;
    if (since !== null) this.state.foregroundMs += Math.max(0, now - since);
    this.state.foregroundSince = null;
    this.state.lastAt = now;
  }

  /** Foreground time so far. */
  sessionMs(now: number): number {
    const since = this.state.foregroundSince;
    return ms(this.state.foregroundMs + (since !== null ? Math.max(0, now - since) : 0)) ?? 0;
  }

  /** The `session_summary` properties, each map capped to its most used keys. */
  summary(now: number): Record<string, unknown> {
    const { state } = this;
    const properties: Record<string, unknown> = {
      session_ms: this.sessionMs(now),
      screens: state.screens.length,
      screen_views: state.screenViews,
      max_scroll_pct: Object.fromEntries(Object.entries(state.maxScroll).slice(0, SUMMARY_KEY_CAP)),
    };
    for (const name of SUMMARY_COUNTERS) {
      properties[name] = topKeys(state.counters[name], SUMMARY_KEY_CAP);
    }
    return properties;
  }

  toJSON(): SessionState {
    return this.state;
  }
}
