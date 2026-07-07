/**
 * Unit tests for the pure range math in speechCleanup - the safety-critical
 * logic (delete/keep composition + transcript remap after a cut). No I/O.
 */
import {
  mergeRanges,
  subtractRanges,
  computeKeptRanges,
  remapSegments,
  remapSegmentsToFull,
  type Range,
} from '../../../pro/locket/services/speechCleanup';

const r = (startMs: number, endMs: number): Range => ({ startMs, endMs });
const seg = (startMs: number, endMs: number, text = 'x') => ({ text, startMs, endMs });

describe('mergeRanges', () => {
  it('merges overlapping and adjacent, sorts', () => {
    expect(mergeRanges([r(10, 20), r(5, 12), r(30, 40)])).toEqual([r(5, 20), r(30, 40)]);
    expect(mergeRanges([r(20, 30), r(30, 40)])).toEqual([r(20, 40)]); // touching merges
  });
  it('returns [] for empty', () => {
    expect(mergeRanges([])).toEqual([]);
  });
});

describe('subtractRanges / computeKeptRanges', () => {
  it('removes a middle chunk, splitting the range', () => {
    expect(subtractRanges([r(0, 100)], [r(40, 60)])).toEqual([r(0, 40), r(60, 100)]);
  });
  it('trims edges', () => {
    expect(subtractRanges([r(0, 100)], [r(0, 20), r(90, 100)])).toEqual([r(20, 90)]);
  });
  it('fully removed range disappears', () => {
    expect(subtractRanges([r(10, 20)], [r(0, 100)])).toEqual([]);
  });
  it('no overlap leaves base intact (merged)', () => {
    expect(subtractRanges([r(0, 10), r(20, 30)], [r(12, 15)])).toEqual([r(0, 10), r(20, 30)]);
  });
  it('computeKeptRanges = speech minus deleted', () => {
    expect(computeKeptRanges([r(0, 40), r(60, 100)], [r(70, 80)]))
      .toEqual([r(0, 40), r(60, 70), r(80, 100)]);
  });
  it('empty deleted returns speech merged', () => {
    expect(computeKeptRanges([r(0, 40)], undefined)).toEqual([r(0, 40)]);
  });
});

describe('remapSegments', () => {
  // kept = [0-40s] + [60-100s] (a 20s gap removed). New timeline: 0-40 keeps,
  // then 60-100 shifts down by 20s -> 40-80.
  const kept = [r(0, 40_000), r(60_000, 100_000)];

  it('shifts a segment in the second kept range down by the removed length', () => {
    const out = remapSegments([{ text: 'a', startMs: 70_000, endMs: 90_000 }], kept);
    expect(out).toEqual([{ text: 'a', startMs: 50_000, endMs: 70_000 }]);
  });
  it('keeps a segment in the first kept range unchanged', () => {
    const out = remapSegments([{ text: 'b', startMs: 10_000, endMs: 20_000 }], kept);
    expect(out).toEqual([{ text: 'b', startMs: 10_000, endMs: 20_000 }]);
  });
  it('drops a segment entirely inside a removed gap', () => {
    expect(remapSegments([{ text: 'gap', startMs: 45_000, endMs: 55_000 }], kept)).toEqual([]);
  });
  it('splits a segment straddling a removed boundary into per-kept-range pieces', () => {
    // 30s-70s straddles the removed 40-60 gap: kept parts 30-40 (->30-40) and
    // 60-70 (->40-50).
    const out = remapSegments([{ text: 's', startMs: 30_000, endMs: 70_000 }], kept);
    expect(out).toEqual([
      { text: 's', startMs: 30_000, endMs: 40_000 },
      { text: 's', startMs: 40_000, endMs: 50_000 },
    ]);
  });
  it('never produces negative or overlapping-with-self lengths', () => {
    const out = remapSegments([{ text: 'x', startMs: 0, endMs: 100_000 }], kept);
    expect(out.every((s) => s.endMs > s.startMs)).toBe(true);
  });
  it('empty in -> empty out', () => {
    expect(remapSegments(undefined, kept)).toEqual([]);
  });
});

describe('remapSegmentsToFull (inverse - restore)', () => {
  // Same scenario: kept = [0-40s] + [60-100s], 40-60s removed. Compacted
  // timeline is 0-80s; the second range occupies compacted 40-80s.
  const kept = [r(0, 40_000), r(60_000, 100_000)];

  it('maps a compacted second-range segment back up by the removed length', () => {
    // compacted 50-70s -> full 70-90s (add back the 20s gap).
    expect(remapSegmentsToFull([seg(50_000, 70_000, 'a')], kept)).toEqual([seg(70_000, 90_000, 'a')]);
  });

  it('leaves a first-range segment unchanged', () => {
    expect(remapSegmentsToFull([seg(10_000, 20_000, 'b')], kept)).toEqual([seg(10_000, 20_000, 'b')]);
  });

  it('round-trips: forward then inverse restores a segment that did not straddle a boundary', () => {
    const original = [seg(10_000, 20_000, 'p'), seg(70_000, 90_000, 'q')];
    const compacted = remapSegments(original, kept);
    const restored = remapSegmentsToFull(compacted, kept);
    expect(restored).toEqual(original);
  });

  it('clamps a time past the end of kept audio into the last range', () => {
    // compacted 80s = end; maps to full 100s (end of the second kept range).
    expect(remapSegmentsToFull([seg(79_000, 80_000, 'z')], kept)).toEqual([seg(99_000, 100_000, 'z')]);
  });

  it('empty / no kept ranges -> empty out', () => {
    expect(remapSegmentsToFull(undefined, kept)).toEqual([]);
    expect(remapSegmentsToFull([seg(0, 1000)], [])).toEqual([]);
  });
});
