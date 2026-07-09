/**
 * Unit tests for split planning (recordingSplit.ts) - pure logic over a VAD map.
 */
import { planSplits, countSplits, SPLIT_GAP_DEFAULT_MS } from '../../../pro/locket/services/recordingSplit';
import type { VadResult } from '../../../pro/locket/services/vadDetect';

// Build a VadResult from speech segments; gaps are the inverse within totalMs.
function vad(totalMs: number, speech: [number, number][]): VadResult {
  const seg = speech.map(([s, e]) => ({ startMs: s, endMs: e }));
  const gaps: { startMs: number; endMs: number }[] = [];
  let cur = 0;
  for (const s of seg) {
    if (s.startMs > cur) gaps.push({ startMs: cur, endMs: s.startMs });
    cur = Math.max(cur, s.endMs);
  }
  if (cur < totalMs) gaps.push({ startMs: cur, endMs: totalMs });
  const speechMs = seg.reduce((a, s) => a + (s.endMs - s.startMs), 0);
  return { speech: seg, gaps, totalMs, speechMs, speechPct: Math.round((speechMs / totalMs) * 100), wallMs: 0 };
}

describe('planSplits', () => {
  it('does not split when no gap exceeds the threshold', () => {
    // speech with only short (5s) gaps, threshold 30s -> one piece
    const v = vad(120_000, [[0, 40_000], [45_000, 80_000], [85_000, 120_000]]);
    const pieces = planSplits(v, SPLIT_GAP_DEFAULT_MS);
    expect(pieces.length).toBe(1);
    expect(pieces[0]).toMatchObject({ startMs: 0, endMs: 120_000 });
  });

  it('splits at a long gap (midpoint) and folds the pieces', () => {
    // 40s speech, 60s gap (>30s), 40s speech -> 2 pieces, cut at gap midpoint
    const v = vad(140_000, [[0, 40_000], [100_000, 140_000]]);
    const pieces = planSplits(v, 30_000);
    expect(pieces.length).toBe(2);
    // divider = midpoint of 40k-100k gap = 70k
    expect(pieces[0]).toMatchObject({ startMs: 0, endMs: 70_000 });
    expect(pieces[1]).toMatchObject({ startMs: 70_000, endMs: 140_000 });
  });

  it('a higher threshold yields fewer pieces', () => {
    // speech runs to the very end so there's no trailing gap; two internal gaps.
    const v = vad(180_000, [[0, 30_000], [60_000, 90_000], [150_000, 180_000]]);
    // internal gaps: 30k-60k (30s), 90k-150k (60s)
    expect(countSplits(v, 20_000)).toBe(3); // both gaps split -> 3 pieces
    expect(countSplits(v, 45_000)).toBe(2); // only the 60s gap splits -> 2 pieces
    expect(countSplits(v, 90_000)).toBe(1); // neither splits -> 1 piece
  });

  it('reports speech duration within each piece', () => {
    const v = vad(140_000, [[0, 40_000], [100_000, 140_000]]);
    const pieces = planSplits(v, 30_000);
    expect(pieces[0].speechMs).toBe(40_000);
    expect(pieces[1].speechMs).toBe(40_000);
  });

  it('folds a too-short trailing piece into the previous one', () => {
    // a long gap right near the end would make a 1s final piece -> folded
    const v = vad(100_000, [[0, 40_000], [98_000, 99_000]]);
    const pieces = planSplits(v, 30_000, 3_000);
    // the tiny tail piece is absorbed, so we still get sensible pieces
    expect(pieces.every((p) => p.endMs - p.startMs >= 3_000)).toBe(true);
  });

  it('returns [] for an empty/zero-length recording', () => {
    expect(planSplits(vad(0, []), 30_000)).toEqual([]);
  });
});
