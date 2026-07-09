/**
 * Unit tests for buildWorkWindows - the pure logic behind VAD-gated
 * transcription (which windows get transcribed). No I/O.
 */
import { buildWorkWindows } from '../../../pro/locket/services/transcribeWindows';

describe('buildWorkWindows', () => {
  const MAX = 60_000; // 1 min windows for readable cases

  it('returns [] for a zero/negative duration', () => {
    expect(buildWorkWindows(0, MAX)).toEqual([]);
    expect(buildWorkWindows(-1, MAX)).toEqual([]);
  });

  it('with no speech ranges, tiles the whole file into max-sized windows', () => {
    expect(buildWorkWindows(120_000, MAX)).toEqual([
      { startMs: 0, endMs: 60_000 },
      { startMs: 60_000, endMs: 120_000 },
    ]);
  });

  it('with no speech ranges, a short file is one window', () => {
    expect(buildWorkWindows(40_000, MAX)).toEqual([{ startMs: 0, endMs: 40_000 }]);
  });

  it('an empty speech-range array falls back to the full file', () => {
    expect(buildWorkWindows(50_000, MAX, { speechRanges: [] })).toEqual([{ startMs: 0, endMs: 50_000 }]);
  });

  it('with speech ranges, transcribes only the speech and skips the silence between', () => {
    const windows = buildWorkWindows(120_000, MAX, {
      speechRanges: [{ startMs: 0, endMs: 40_000 }, { startMs: 100_000, endMs: 120_000 }],
    });
    expect(windows).toEqual([
      { startMs: 0, endMs: 40_000 },
      { startMs: 100_000, endMs: 120_000 },
    ]);
    // The silence 40s-100s is never emitted.
    expect(windows.some((w) => w.startMs >= 40_000 && w.endMs <= 100_000)).toBe(false);
  });

  it('pads each range and merges ranges that overlap after padding', () => {
    // Two ranges 500ms apart; a 1s pad makes them overlap -> one window.
    const windows = buildWorkWindows(60_000, MAX, {
      speechRanges: [{ startMs: 10_000, endMs: 20_000 }, { startMs: 20_500, endMs: 30_000 }],
      padMs: 1_000,
    });
    expect(windows).toEqual([{ startMs: 9_000, endMs: 31_000 }]);
  });

  it('splits a long merged speech range into max-sized sub-windows', () => {
    const windows = buildWorkWindows(200_000, MAX, { speechRanges: [{ startMs: 0, endMs: 200_000 }] });
    expect(windows).toEqual([
      { startMs: 0, endMs: 60_000 },
      { startMs: 60_000, endMs: 120_000 },
      { startMs: 120_000, endMs: 180_000 },
      { startMs: 180_000, endMs: 200_000 },
    ]);
  });

  it('clamps padded ranges to [0, durationMs]', () => {
    const windows = buildWorkWindows(100_000, MAX, {
      speechRanges: [{ startMs: 2_000, endMs: 98_000 }],
      padMs: 5_000, // pad would push to -3000 / 103000
    });
    expect(windows[0].startMs).toBe(0);
    expect(windows[windows.length - 1].endMs).toBe(100_000);
  });
});
