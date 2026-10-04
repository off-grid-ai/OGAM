/**
 * The week reflection: one bar per day (zeros included), speech + conversation totals, tasks kept vs
 * total across the week, and the most-mentioned people. Aggregates only the sessions on the given week
 * days, so a session outside the week is ignored.
 */

import { reflectWeek } from '../../../../src/services/ambient/reflectModel'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'
import type { TimelineSession } from '../../../../src/services/ambient/timelineModel'

// Fixed epochs -> day parts.
const PARTS: Record<number, { y: number; m: number; d: number }> = {
  10: { y: 2026, m: 9, d: 5 },
  20: { y: 2026, m: 9, d: 6 },
  30: { y: 2026, m: 9, d: 6 },
  99: { y: 2026, m: 8, d: 1 } // outside the week
}
const toParts = (ms: number) => PARTS[ms]

const session = (
  id: string,
  startMs: number,
  speechMs: number,
  people: string[],
  actionItems: string[]
): TimelineSession => ({
  id,
  startMs,
  endMs: startMs + 1,
  speechMs,
  summary: { ...EMPTY_SUMMARY, people, actionItems },
  summaryStatus: 'ok',
  flaggedSegmentIds: [],
  segments: []
})

const week = ['2026-09-05', '2026-09-06']
const sessions = [
  session('a', 10, 1000, ['Priya'], ['Fix build']),
  session('b', 20, 2000, ['Priya', 'Sam'], ['Send quote']),
  session('c', 30, 500, ['Sam'], []),
  session('x', 99, 9999, ['Nobody'], ['Ignored']) // outside the week
]

describe('reflectWeek', () => {
  it('bars each day of the week, with zeros, and totals speech + conversations in the week only', () => {
    const r = reflectWeek(sessions, new Set(), week, toParts)
    expect(r.bars).toEqual([
      { dayKey: '2026-09-05', count: 1 },
      { dayKey: '2026-09-06', count: 2 }
    ])
    expect(r.conversationCount).toBe(3) // x is excluded
    expect(r.totalSpeechMs).toBe(3500)
  })

  it('counts tasks kept vs total across the week', () => {
    const r = reflectWeek(sessions, new Set(['a#0']), week, toParts)
    expect(r.tasksTotal).toBe(2) // Fix build + Send quote (Ignored is outside the week)
    expect(r.tasksKept).toBe(1)
  })

  it('ranks the most-mentioned people', () => {
    const r = reflectWeek(sessions, new Set(), week, toParts)
    expect(r.topPeople).toEqual([
      { name: 'Priya', count: 2 },
      { name: 'Sam', count: 2 }
    ])
  })

  it('includes empty days as zero bars', () => {
    const r = reflectWeek([], new Set(), ['2026-09-05', '2026-09-06'], toParts)
    expect(r.bars.map(b => b.count)).toEqual([0, 0])
    expect(r.conversationCount).toBe(0)
  })
})
