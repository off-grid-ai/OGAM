/**
 * The pure timeline reducers: day grouping (newest day + newest session first, day totals) and the
 * store's id-dedupe merge. These are the rules the UI and the store both depend on, so they are pinned
 * once here rather than re-derived per surface.
 */

import {
  groupSessionsByDay,
  dayKeyOf,
  isIncludedSession,
  isAmbientSession,
  type TimelineSession,
  type SessionRelevance
} from '../../../../src/services/ambient/timelineModel'
import { mergeSessions } from '../../../../src/stores/ambientTimelineStore'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'

// Deterministic date parts (no real Date needed): map fixed epochs to y/m/d.
const PARTS: Record<number, { y: number; m: number; d: number }> = {
  1000: { y: 2026, m: 9, d: 3 },
  2000: { y: 2026, m: 9, d: 3 },
  3000: { y: 2026, m: 9, d: 2 }
}
const toParts = (ms: number) => PARTS[ms]

const session = (id: string, startMs: number, speechMs = 1000): TimelineSession => ({
  id,
  startMs,
  endMs: startMs + speechMs,
  speechMs,
  summary: { ...EMPTY_SUMMARY },
  summaryStatus: 'ok' as const,
  flaggedSegmentIds: [],
  segments: []
})

describe('dayKeyOf', () => {
  it('formats a zero-padded local day key', () => {
    expect(dayKeyOf(1000, () => ({ y: 2026, m: 9, d: 3 }))).toBe('2026-09-03')
    expect(dayKeyOf(1000, () => ({ y: 2026, m: 12, d: 25 }))).toBe('2026-12-25')
  })
})

describe('groupSessionsByDay', () => {
  it('groups by day, newest day first and newest session first within a day', () => {
    const groups = groupSessionsByDay(
      [session('a', 1000), session('b', 2000), session('c', 3000)],
      toParts
    )
    expect(groups.map(g => g.dayKey)).toEqual(['2026-09-03', '2026-09-02'])
    expect(groups[0].sessions.map(s => s.id)).toEqual(['b', 'a']) // 2000 before 1000
  })

  it('totals speech per day for the header', () => {
    const groups = groupSessionsByDay([session('a', 1000, 500), session('b', 2000, 700)], toParts)
    expect(groups[0].speechMs).toBe(1200)
  })

  it('returns nothing for no sessions', () => {
    expect(groupSessionsByDay([], toParts)).toEqual([])
  })
})

describe('mergeSessions', () => {
  it('keeps one record per id — re-saving a capture is idempotent', () => {
    const merged = mergeSessions([session('a', 1000)], [session('a', 1000), session('b', 2000)])
    expect(merged.map(s => s.id).sort()).toEqual(['a', 'b'])
  })

  it('lets a re-saved session overwrite the old one (last write wins)', () => {
    const updated = { ...session('a', 1000), summary: { ...EMPTY_SUMMARY, title: 'Updated' } }
    const merged = mergeSessions([session('a', 1000)], [updated])
    expect(merged).toHaveLength(1)
    expect(merged[0].summary.title).toBe('Updated')
  })
})

describe('isIncludedSession — the Day projection predicate', () => {
  const ambient: SessionRelevance = { ambient: true, score: 0.2, reason: 'x' }
  const kept: SessionRelevance = { ambient: false, score: 0.9, reason: 'x' }

  it('includes a session with no relevance verdict (unassessed = kept)', () => {
    expect(isIncludedSession(session('a', 1000))).toBe(true)
  })

  it('excludes an ambient session, includes a kept one', () => {
    expect(isIncludedSession({ ...session('a', 1000), relevance: ambient })).toBe(false)
    expect(isIncludedSession({ ...session('a', 1000), relevance: kept })).toBe(true)
  })

  it('user override wins over relevance in both directions', () => {
    // Ambient conversation the user chose to add back → included.
    expect(isIncludedSession({ ...session('a', 1000), relevance: ambient, userOverride: true })).toBe(true)
    // A relevant conversation the user removed → excluded (so its to-dos/journal/actions drop).
    expect(isIncludedSession({ ...session('a', 1000), relevance: kept, userOverride: false })).toBe(false)
  })

  it('ambient classification is independent of the include decision', () => {
    const s = { ...session('a', 1000), relevance: ambient, userOverride: true }
    expect(isAmbientSession(s)).toBe(true) // still overheard by relevance
    expect(isIncludedSession(s)).toBe(true) // but the user pulled it into the day
  })
})
