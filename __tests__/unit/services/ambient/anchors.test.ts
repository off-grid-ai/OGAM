/**
 * Anchor -> segment mapping: a flag inside a segment's span picks that segment; a flag in a gap picks
 * the nearest; duplicates collapse; order is stable by first flag. This is what lets the summary and
 * the UI know which moments the user marked live.
 */

import { flagSegmentsForAnchors } from '../../../../src/services/ambient/anchors'

const segs = [
  { id: 'a', startMs: 0, endMs: 2_000 },
  { id: 'b', startMs: 5_000, endMs: 7_000 },
  { id: 'c', startMs: 10_000, endMs: 12_000 }
]

describe('flagSegmentsForAnchors', () => {
  it('flags the segment whose span contains the anchor', () => {
    expect(flagSegmentsForAnchors(segs, [6_000])).toEqual(['b'])
  })

  it('flags the nearest segment when the anchor falls in a gap', () => {
    expect(flagSegmentsForAnchors(segs, [3_000])).toEqual(['a']) // closer to a (1s) than b (2s)
    expect(flagSegmentsForAnchors(segs, [4_500])).toEqual(['b']) // closer to b
  })

  it('collapses duplicate flags on the same segment, order-stable', () => {
    expect(flagSegmentsForAnchors(segs, [11_000, 100, 11_500])).toEqual(['c', 'a'])
  })

  it('handles anchors past the end by picking the last segment', () => {
    expect(flagSegmentsForAnchors(segs, [99_000])).toEqual(['c'])
  })

  it('returns nothing when there are no anchors or no segments', () => {
    expect(flagSegmentsForAnchors(segs, [])).toEqual([])
    expect(flagSegmentsForAnchors([], [1_000])).toEqual([])
  })
})
