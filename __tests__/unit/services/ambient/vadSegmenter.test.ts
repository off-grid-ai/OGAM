/**
 * The ambient recorder's VAD segmenter — pure, so tested without a microphone. Guards the
 * segmentation policy: open on speech, close on a silence gap, drop blips, force-split long runs,
 * and flush an open segment at stop. These are the rules that keep 24/7 capture down to real speech.
 */

import {
  advanceVad,
  flushVad,
  initialVadState,
  DEFAULT_VAD_CONFIG,
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
