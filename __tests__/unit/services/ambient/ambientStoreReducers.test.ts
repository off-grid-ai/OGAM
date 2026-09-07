/**
 * The store's pure reducers: toggleId adds an id if absent and removes it if present (task check/
 * uncheck), and mergeSessions dedupes by id. Pinned here so the store's behaviour has a witness.
 */

import { toggleId, mergeSessions } from '../../../../src/stores/ambientTimelineStore'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'

describe('toggleId', () => {
  it('adds an absent id and removes a present one', () => {
    expect(toggleId([], 'a')).toEqual(['a'])
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b'])
  })
})

describe('mergeSessions', () => {
  const s = (id: string) => ({
    id, startMs: 0, endMs: 1, speechMs: 1, summary: { ...EMPTY_SUMMARY },
    summaryStatus: 'ok' as const, flaggedSegmentIds: [], segments: []
  })
  it('keeps one record per id, last write wins', () => {
    const merged = mergeSessions([s('a')], [{ ...s('a'), speechMs: 99 }, s('b')])
    expect(merged.map(x => x.id).sort()).toEqual(['a', 'b'])
    expect(merged.find(x => x.id === 'a')?.speechMs).toBe(99)
  })
})
