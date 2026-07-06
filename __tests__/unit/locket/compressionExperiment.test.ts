/**
 * Unit tests for the pure analysis helpers in compressionExperiment - the
 * functions that turn the two transcripts / two VAD runs into the comparison
 * numbers. The experiment's I/O (native encode/decode, whisper, VAD) is not
 * tested here; only the math that interprets the results. If these are wrong,
 * the on-device measurement is meaningless, so they're the part worth pinning.
 *
 * The module imports whisper.rn + RNFS + native modules at load time, so those
 * are mocked to no-ops; the helpers under test are pure and touch none of them.
 */

jest.mock('react-native', () => ({ NativeModules: {} }));
jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/docs' }));
jest.mock('whisper.rn', () => ({ initWhisperVad: jest.fn() }));
jest.mock('@offgrid/core/services/whisperService', () => ({ whisperService: {} }));
jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { tokenOverlap, compareVad } from '../../../pro/locket/services/compressionExperiment';
import type { VadResult } from '../../../pro/locket/services/vadDetect';

describe('tokenOverlap', () => {
  it('is 1.0 for identical text', () => {
    expect(tokenOverlap('hello there world', 'hello there world')).toBe(1);
  });

  it('ignores case and punctuation', () => {
    expect(tokenOverlap('Hello, there.', 'hello there')).toBe(1);
  });

  it('is 1.0 when both are empty', () => {
    expect(tokenOverlap('', '')).toBe(1);
  });

  it('is 0 when one side is empty', () => {
    expect(tokenOverlap('hello', '')).toBe(0);
    expect(tokenOverlap('', 'world')).toBe(0);
  });

  it('is 0 for fully disjoint text', () => {
    expect(tokenOverlap('alpha beta', 'gamma delta')).toBe(0);
  });

  it('reports partial overlap against the longer side', () => {
    // shared {the} = 1 token; longer side has 3 tokens -> 1/3.
    expect(tokenOverlap('the cat sat', 'the')).toBeCloseTo(1 / 3, 5);
  });

  it('counts a repeated word only as many times as both sides have it', () => {
    // "no no" vs "no" -> shared 1, max length 2 -> 0.5 (not 1.0).
    expect(tokenOverlap('no no', 'no')).toBe(0.5);
  });
});

const vad = (speech: { startMs: number; endMs: number }[]): VadResult => {
  const speechMs = speech.reduce((s, r) => s + (r.endMs - r.startMs), 0);
  return {
    speech,
    gaps: [],
    totalMs: 100000,
    speechMs,
    speechPct: Math.round((speechMs / 100000) * 100),
    wallMs: 0,
  };
};

describe('compareVad', () => {
  it('reports zero deltas for identical VAD results', () => {
    const a = vad([{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 3000 }]);
    const cmp = compareVad(a, vad([{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 3000 }]));
    expect(cmp.segDelta).toBe(0);
    expect(cmp.speechMsDelta).toBe(0);
    expect(cmp.meanBoundaryDriftMs).toBe(0);
  });

  it('reports a positive segDelta when AAC finds more segments', () => {
    const raw = vad([{ startMs: 0, endMs: 1000 }]);
    const aac = vad([{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 2500 }]);
    expect(compareVad(raw, aac).segDelta).toBe(1);
  });

  it('reports negative speechMsDelta when AAC detects less speech', () => {
    const raw = vad([{ startMs: 0, endMs: 5000 }]);   // 5000ms speech
    const aac = vad([{ startMs: 0, endMs: 4000 }]);   // 4000ms speech
    expect(compareVad(raw, aac).speechMsDelta).toBe(-1000);
  });

  it('averages boundary drift over matched segments (start+end)', () => {
    // one segment, start off by 100, end off by 300 -> mean of |100|,|300| = 200.
    const raw = vad([{ startMs: 1000, endMs: 5000 }]);
    const aac = vad([{ startMs: 1100, endMs: 5300 }]);
    expect(compareVad(raw, aac).meanBoundaryDriftMs).toBe(200);
  });

  it('drifts only over the overlap when counts differ', () => {
    // 2 raw, 1 aac -> compare only the first (index 0). start drift 50, end drift 50 -> 50.
    const raw = vad([{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 3000 }]);
    const aac = vad([{ startMs: 50, endMs: 1050 }]);
    const cmp = compareVad(raw, aac);
    expect(cmp.meanBoundaryDriftMs).toBe(50);
    expect(cmp.segDelta).toBe(-1);
  });
});
