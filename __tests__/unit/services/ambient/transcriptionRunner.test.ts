/**
 * One deferred-transcription pass, end-to-end through a fake store + fake backends (real interfaces).
 * Guards the composition: it schedules, dispatches, persists transcripts, bumps attempts on failure,
 * defers on low battery, and handles a segment whose recording has been cleaned up.
 */

import {
  runTranscriptionPass,
  type AmbientRunnerDeps,
  type AmbientSegmentStore
} from '../../../../src/services/ambient/transcriptionRunner';
import type { DeviceConditions, PendingSegment } from '../../../../src/services/ambient/sttScheduler';
import type { SttExecutor, SttInput } from '../../../../src/services/ambient/sttExecutor';

const HEALTHY: DeviceConditions = { batteryLevel: 0.9, charging: true, macReachable: false };

function inputFor(id: string): SttInput {
  return { segmentId: id, recordingPath: `/rec/${id}.wav`, startMs: 0, endMs: 900 };
}

/** In-memory store recording writes, so a pass can be asserted against real state. */
function fakeStore(pending: PendingSegment[], missing: Set<string> = new Set()): AmbientSegmentStore & {
  transcripts: Record<string, string>;
  attempts: Record<string, number>;
} {
  const transcripts: Record<string, string> = {};
  const attempts: Record<string, number> = {};
  return {
    transcripts,
    attempts,
    pending: async () => pending,
    input: async (id) => (missing.has(id) ? null : inputFor(id)),
    saveTranscript: async (id, text) => {
      transcripts[id] = text;
    },
    markAttempt: async (id) => {
      attempts[id] = (attempts[id] ?? 0) + 1;
    }
  };
}

const okExecutor = (text: string): SttExecutor => ({ transcribe: async () => ({ text }) });
const failExecutor = (msg: string): SttExecutor => ({
  transcribe: async () => {
    throw new Error(msg);
  }
});

function deps(
  store: AmbientSegmentStore,
  device: DeviceConditions,
  executors: () => { phone: SttExecutor; mac?: SttExecutor }
): AmbientRunnerDeps {
  return { store, device: async () => device, executors };
}

describe('runTranscriptionPass', () => {
  it('transcribes pending segments and persists the text', async () => {
    const store = fakeStore([
      { id: 'a', startMs: 100, attempts: 0 },
      { id: 'b', startMs: 200, attempts: 0 }
    ]);
    const summary = await runTranscriptionPass(
      deps(store, HEALTHY, () => ({ phone: okExecutor('hello') }))
    );
    expect(summary).toEqual({ transcribed: 2, failed: 0, deferred: false });
    expect(store.transcripts).toEqual({ a: 'hello', b: 'hello' });
  });

  it('defers on low battery and writes nothing', async () => {
    const store = fakeStore([{ id: 'a', startMs: 100, attempts: 0 }]);
    const summary = await runTranscriptionPass(
      deps(store, { batteryLevel: 0.1, charging: false, macReachable: false }, () => ({
        phone: okExecutor('x')
      }))
    );
    expect(summary).toEqual({ transcribed: 0, failed: 0, deferred: true });
    expect(store.transcripts).toEqual({});
  });

  it('bumps the attempt count when transcription fails', async () => {
    const store = fakeStore([{ id: 'a', startMs: 100, attempts: 0 }]);
    const summary = await runTranscriptionPass(
      deps(store, HEALTHY, () => ({ phone: failExecutor('whisper OOM') }))
    );
    expect(summary).toEqual({ transcribed: 0, failed: 1, deferred: false });
    expect(store.attempts).toEqual({ a: 1 });
    expect(store.transcripts).toEqual({});
  });

  it('counts an attempt (not a transcript) when the recording is gone', async () => {
    const store = fakeStore([{ id: 'a', startMs: 100, attempts: 0 }], new Set(['a']));
    const summary = await runTranscriptionPass(
      deps(store, HEALTHY, () => ({ phone: okExecutor('x') }))
    );
    expect(summary).toEqual({ transcribed: 0, failed: 1, deferred: false });
    expect(store.attempts).toEqual({ a: 1 });
  });

  it('routes to the Mac when reachable, and records it', async () => {
    const store = fakeStore([{ id: 'a', startMs: 100, attempts: 0 }]);
    const summary = await runTranscriptionPass(
      deps(store, { ...HEALTHY, macReachable: true }, () => ({
        phone: okExecutor('phone'),
        mac: okExecutor('mac transcript')
      }))
    );
    expect(summary.transcribed).toBe(1);
    expect(store.transcripts).toEqual({ a: 'mac transcript' });
  });

  it('reports nothing to do for an empty queue', async () => {
    const store = fakeStore([]);
    const summary = await runTranscriptionPass(
      deps(store, HEALTHY, () => ({ phone: okExecutor('x') }))
    );
    expect(summary).toEqual({ transcribed: 0, failed: 0, deferred: false });
  });
});
