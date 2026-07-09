import {
  buildDayTimeline,
  timeBucket,
  clipState,
  recordingsForDay,
} from '../../../pro/locket/utils/dayTimeline';
import type { Recording } from '../../../pro/locket/stores/recordingsStore';

// Build a minimal Recording on 2026-07-08 at a given hour/min.
const mk = (id: string, hour: number, min: number, opts: Partial<Recording> = {}): Recording => {
  const startedAt = new Date(2026, 6, 8, hour, min, 0).getTime();
  return {
    id,
    path: `/rec/${id}.wav`,
    startedAt,
    endedAt: startedAt + 30_000,
    durationMs: 30_000,
    sizeBytes: 1000,
    ...opts,
  } as Recording;
};

describe('timeBucket (fixed clock boundaries)', () => {
  const at = (h: number) => timeBucket(new Date(2026, 6, 8, h, 0).getTime());
  it('maps hours to fixed buckets', () => {
    expect(at(6)).toBe('Morning'); // 5-12
    expect(at(11)).toBe('Morning');
    expect(at(12)).toBe('Afternoon'); // 12-17
    expect(at(16)).toBe('Afternoon');
    expect(at(17)).toBe('Evening'); // 17-21
    expect(at(20)).toBe('Evening');
    expect(at(21)).toBe('Night'); // 21-5
    expect(at(3)).toBe('Night');
  });
});

describe('clipState (three states, never blurred)', () => {
  it('raw when not transcribed', () => {
    expect(clipState(mk('a', 9, 0))).toBe('raw');
  });
  it('text when transcript has content', () => {
    expect(clipState(mk('a', 9, 0, { transcript: 'hello there' }))).toBe('text');
  });
  it('nospeech when transcribed but empty', () => {
    expect(clipState(mk('a', 9, 0, { transcript: '   ', transcriptStatus: 'done' }))).toBe('nospeech');
  });
});

describe('buildDayTimeline', () => {
  it('groups loose clips under time-of-day headers', () => {
    const items = buildDayTimeline([mk('a', 8, 0), mk('b', 13, 0)]);
    expect(items.map((i) => i.kind)).toEqual(['timeHeader', 'clip', 'timeHeader', 'clip']);
    expect((items[0] as any).label).toBe('Morning');
    expect((items[2] as any).label).toBe('Afternoon');
  });

  it('collapses same-eventId clips into one meeting block', () => {
    const items = buildDayTimeline([
      mk('a', 9, 0, { eventId: 'E1', eventTitle: 'Standup' }),
      mk('b', 9, 10, { eventId: 'E1', eventTitle: 'Standup' }),
    ]);
    const meetings = items.filter((i) => i.kind === 'meeting');
    expect(meetings).toHaveLength(1);
    expect((meetings[0] as any).title).toBe('Standup');
    expect((meetings[0] as any).clips).toHaveLength(2);
  });

  it('does not repeat a time header after a meeting (once per bucket)', () => {
    const items = buildDayTimeline([
      mk('a', 8, 0), // loose morning
      mk('b', 9, 0, { eventId: 'E1', eventTitle: 'Standup' }), // meeting
      mk('c', 9, 40), // loose morning again - no second Morning header
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      'timeHeader', // Morning (once)
      'clip', // a
      'meeting', // Standup
      'clip', // c
    ]);
    expect(items.filter((i) => i.kind === 'timeHeader')).toHaveLength(1);
  });

  it('orders everything by start time', () => {
    const items = buildDayTimeline([mk('late', 15, 0), mk('early', 7, 0)]);
    const clips = items.filter((i) => i.kind === 'clip') as any[];
    expect(clips[0].clip.id).toBe('early');
    expect(clips[1].clip.id).toBe('late');
  });
});

describe('recordingsForDay', () => {
  it('keeps only the same local calendar day', () => {
    const today = mk('t', 10, 0).startedAt;
    const other = new Date(2026, 6, 7, 10, 0).getTime();
    const list = [mk('t', 10, 0), { ...mk('o', 10, 0), startedAt: other } as Recording];
    const kept = recordingsForDay(list, today);
    expect(kept.map((r) => r.id)).toEqual(['t']);
  });
});
