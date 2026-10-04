/**
 * AmbientRecorder orchestration — driven through a FAKE capture recorder (real interface, fake impl)
 * and a controllable clock, so the full start → level-stream → segment → stop flow is exercised
 * without a microphone. Guards: it subscribes on start, turns the RMS stream into segments via the
 * VAD core, flushes an open segment on stop, returns the recording file, and is idempotent.
 */

import { AmbientRecorder, type AmbientCaptureRecorder } from '../../../../src/services/ambient/ambientRecorder';
import type { SpeechSegment, VadConfig } from '../../../../src/services/ambient/vadSegmenter';

const CFG: VadConfig = { energyThreshold: 0.02, minSilenceMs: 800, minSpeechMs: 400, maxSegmentMs: 30_000 };
const LOUD = 0.1;
const QUIET = 0.0;

function fakeRecorder() {
  let listener: ((rms: number) => void) | null = null;
  const calls = { start: 0, stop: 0 };
  const rec: AmbientCaptureRecorder & {
    calls: typeof calls;
    emit(rms: number): void;
    subscribed(): boolean;
  } = {
    calls,
    emit: (rms) => listener?.(rms),
    subscribed: () => listener !== null,
    startRecording: async () => {
      calls.start += 1;
    },
    stopRecording: async () => {
      calls.stop += 1;
      return { path: '/ambient/rec.wav', durationSeconds: 42 };
    },
    onAudioLevel: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    }
  };
  return rec;
}

describe('AmbientRecorder', () => {
  it('subscribes on start and stays idle until then', async () => {
    const rec = fakeRecorder();
    const ar = new AmbientRecorder({ recorder: rec, now: () => 0, config: CFG });
    expect(ar.phaseNow()).toBe('idle');
    expect(rec.subscribed()).toBe(false);
    await ar.start(() => {});
    expect(ar.phaseNow()).toBe('recording');
    expect(rec.calls.start).toBe(1);
    expect(rec.subscribed()).toBe(true);
  });

  it('turns the live RMS stream into a closed speech segment', async () => {
    const rec = fakeRecorder();
    let clock = 1000;
    const ar = new AmbientRecorder({ recorder: rec, now: () => clock, config: CFG });
    const segs: SpeechSegment[] = [];
    await ar.start((s) => segs.push(s));

    const emit = (tMs: number, rms: number) => {
      clock = 1000 + tMs;
      rec.emit(rms);
    };
    for (let t = 0; t <= 900; t += 100) emit(t, LOUD); // speech 0..900
    for (let t = 1000; t <= 1800; t += 100) emit(t, QUIET); // silence gap closes it at t=1700

    expect(segs).toEqual([{ startMs: 0, endMs: 900 }]);
  });

  it('flushes an open segment on stop and returns the recording file', async () => {
    const rec = fakeRecorder();
    let clock = 0;
    const ar = new AmbientRecorder({ recorder: rec, now: () => clock, config: CFG });
    const segs: SpeechSegment[] = [];
    await ar.start((s) => segs.push(s));

    for (let t = 0; t <= 900; t += 100) {
      clock = t;
      rec.emit(LOUD); // speech that never sees a closing gap
    }
    const result = await ar.stop();

    expect(segs).toEqual([{ startMs: 0, endMs: 900 }]); // flushed
    expect(result).toEqual({ path: '/ambient/rec.wav', durationSeconds: 42 });
    expect(rec.calls.stop).toBe(1);
    expect(rec.subscribed()).toBe(false);
    expect(ar.phaseNow()).toBe('idle');
  });

  it('is idempotent: double start does not start twice, stop-when-idle returns null', async () => {
    const rec = fakeRecorder();
    const ar = new AmbientRecorder({ recorder: rec, now: () => 0, config: CFG });
    expect(await ar.stop()).toBeNull();
    await ar.start(() => {});
    await ar.start(() => {});
    expect(rec.calls.start).toBe(1);
  });

  it('ignores levels after stop', async () => {
    const rec = fakeRecorder();
    let clock = 0;
    const ar = new AmbientRecorder({ recorder: rec, now: () => clock, config: CFG });
    const segs: SpeechSegment[] = [];
    await ar.start((s) => segs.push(s));
    await ar.stop();
    clock = 5000;
    rec.emit(LOUD); // must be ignored — phase is idle and we unsubscribed
    expect(segs).toEqual([]);
  });
});
