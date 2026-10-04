/**
 * The ambient recorder's VAD segmenter — pure, so tested without a microphone. Guards the
 * segmentation policy: open on speech, close on a silence gap, drop blips, force-split long runs,
 * and flush an open segment at stop. These are the rules that keep 24/7 capture down to real speech.
 */

import {
  advanceVad,
  flushVad,
  initialVadState,
  effectiveThreshold,
  DEFAULT_VAD_CONFIG,
  DEFAULT_ADAPTIVE_VAD_CONFIG,
  type EnergyFrame,
  type SpeechSegment,
  type VadConfig,
  type VadState
} from '../../../../src/services/ambient/vadSegmenter';

const CONFIG: VadConfig = {
  energyThreshold: 0.02,
  minSilenceMs: 800,
  minSpeechMs: 400,
  maxSegmentMs: 30_000
};

/** Run frames through the machine and collect every closed segment (including a final flush). */
function run(frames: EnergyFrame[], config: VadConfig = CONFIG): SpeechSegment[] {
  let state: VadState = initialVadState();
  const segments: SpeechSegment[] = [];
  for (const frame of frames) {
    const step = advanceVad(state, frame, config);
    state = step.state;
    if (step.segment) segments.push(step.segment);
  }
  const end = flushVad(state, config);
  if (end.segment) segments.push(end.segment);
  return segments;
}

/** Frames at a fixed cadence with the given RMS values. */
function frames(rmsSeries: number[], stepMs = 100): EnergyFrame[] {
  return rmsSeries.map((rms, i) => ({ tMs: i * stepMs, rms }));
}

const LOUD = 0.1;
const QUIET = 0.0;

describe('vadSegmenter', () => {
  it('stays silent and emits nothing for an all-quiet stream', () => {
    expect(run(frames(Array(20).fill(QUIET)))).toEqual([]);
  });

  it('opens on speech and closes after the silence gap', () => {
    // 10 loud frames (0..900ms of speech), then quiet long enough to close (>=800ms gap).
    const series = [...Array(10).fill(LOUD), ...Array(12).fill(QUIET)];
    const segments = run(frames(series));
    expect(segments).toHaveLength(1);
    // Speech from t=0 to the last loud frame at t=900ms.
    expect(segments[0]).toEqual({ startMs: 0, endMs: 900 });
  });

  it('drops a blip shorter than minSpeechMs', () => {
    // 2 loud frames = 100ms of speech (< 400ms), then silence.
    const series = [...Array(2).fill(LOUD), ...Array(12).fill(QUIET)];
    expect(run(frames(series))).toEqual([]);
  });

  it('does not close on a silence gap shorter than minSilenceMs', () => {
    // speech, a 300ms dip (< 800ms, keeps the segment open), then more speech, then a real gap.
    const series = [
      ...Array(6).fill(LOUD), // 0..500
      ...Array(3).fill(QUIET), // 600..800 short dip
      ...Array(6).fill(LOUD), // 900..1400 resumes
      ...Array(12).fill(QUIET) // long gap closes it
    ];
    const segments = run(frames(series));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ startMs: 0, endMs: 1400 });
  });

  it('force-splits a segment that runs past maxSegmentMs', () => {
    const cfg: VadConfig = { ...CONFIG, maxSegmentMs: 1000 };
    // 25 loud frames = continuous 2400ms of speech at 100ms cadence.
    const segments = run(frames(Array(25).fill(LOUD)), cfg);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    // First split lands at exactly maxSegmentMs from the start.
    expect(segments[0].startMs).toBe(0);
    expect(segments[0].endMs).toBe(1000);
    // Segments are contiguous — no audio dropped at the split.
    expect(segments[1].startMs).toBe(1000);
  });

  it('flushes an open segment when the stream ends mid-speech', () => {
    // Speech that never sees a closing silence gap — stop() must still capture it.
    const segments = run(frames(Array(10).fill(LOUD)));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ startMs: 0, endMs: 900 });
  });

  it('separates two utterances split by a real silence gap', () => {
    const series = [
      ...Array(6).fill(LOUD), // 0..500
      ...Array(10).fill(QUIET), // 600..1500 gap (>=800) closes #1
      ...Array(6).fill(LOUD), // 1600..2100
      ...Array(10).fill(QUIET) // closes #2
    ];
    const segments = run(frames(series));
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ startMs: 0, endMs: 500 });
    expect(segments[1]).toEqual({ startMs: 1600, endMs: 2100 });
  });

  it('is pure — the same (state, frame) yields the same result', () => {
    const state = initialVadState();
    const frame: EnergyFrame = { tMs: 0, rms: LOUD };
    expect(advanceVad(state, frame, CONFIG)).toEqual(advanceVad(state, frame, CONFIG));
    // And it did not mutate the input state.
    expect(state).toEqual(initialVadState());
  });

  it('ships defaults tuned for 16 kHz room speech', () => {
    expect(DEFAULT_VAD_CONFIG.energyThreshold).toBeGreaterThan(0);
    expect(DEFAULT_VAD_CONFIG.minSilenceMs).toBeGreaterThan(DEFAULT_VAD_CONFIG.minSpeechMs);
  });
});

describe('vadSegmenter — adaptive noise floor', () => {
  const ADAPTIVE: VadConfig = {
    ...CONFIG,
    adaptive: { marginFactor: 3.5, floorRisePerSec: 1.5, minFloor: 0.005 }
  };

  it('effectiveThreshold tracks floor × margin (never below minFloor)', () => {
    const loud: VadState = { ...initialVadState(), noiseFloor: 0.03 };
    expect(effectiveThreshold(loud, ADAPTIVE)).toBeCloseTo(0.105, 6); // 0.03 × 3.5
    const quiet: VadState = { ...initialVadState(), noiseFloor: 0.0001 };
    expect(effectiveThreshold(quiet, ADAPTIVE)).toBe(0.005); // clamped to minFloor
    // Non-adaptive config ignores the floor and uses the fixed threshold.
    expect(effectiveThreshold(loud, CONFIG)).toBe(CONFIG.energyThreshold);
  });

  it('ignores steady café hum that a fixed threshold would mislabel as speech', () => {
    // Background hum at 0.03 — above the FIXED 0.02 threshold (so fixed mode fires), but the adaptive
    // floor rises to it so its threshold (0.03×3.5=0.105) leaves it as silence.
    const hum = frames(Array(20).fill(0.03));
    expect(run(hum, ADAPTIVE)).toEqual([]);
    // Prove the contrast: the same hum under the fixed threshold opens a (bogus) segment.
    expect(run(hum, CONFIG).length).toBeGreaterThan(0);
  });

  it('detects real speech that rises well above the café floor', () => {
    // 2s of 0.03 hum, then 600ms of 0.4 speech, then hum again (silence relative to the raised floor).
    const series = [...Array(20).fill(0.03), ...Array(6).fill(0.4), ...Array(10).fill(0.03)];
    const segments = run(frames(series), ADAPTIVE);
    expect(segments).toHaveLength(1);
    expect(segments[0].startMs).toBe(2000);
    expect(segments[0].endMs).toBe(2500);
  });

  it('catches faint speech in a quiet room that a fixed threshold would miss', () => {
    // Quiet room floor ~0.002; speech at 0.012 is below the fixed 0.02 threshold but above the adaptive
    // floor-relative one (max(0.005, 0.002×3.5)=0.007).
    const series = [...Array(10).fill(0.002), ...Array(6).fill(0.012), ...Array(10).fill(0.002)];
    const segments = run(frames(series), ADAPTIVE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ startMs: 1000, endMs: 1500 });
    // Fixed threshold misses it entirely.
    expect(run(series.map((rms, i) => ({ tMs: i * 100, rms })), CONFIG)).toEqual([]);
  });

  it('provides an adaptive preset with the standard timing', () => {
    expect(DEFAULT_ADAPTIVE_VAD_CONFIG.adaptive?.marginFactor).toBeGreaterThan(1);
    expect(DEFAULT_ADAPTIVE_VAD_CONFIG.minSilenceMs).toBe(DEFAULT_VAD_CONFIG.minSilenceMs);
  });
});
