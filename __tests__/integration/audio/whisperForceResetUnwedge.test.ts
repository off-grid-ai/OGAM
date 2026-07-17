/**
 * whisperService.forceReset() must also clear the whole-file transcription busy-lock
 * (fileTranscribeStop). Before this fix, a forceReset that ran while a file transcription
 * was in flight left the lock set, so every later transcribeFile threw WhisperBusyError
 * ("a transcription is already in progress") until the app was restarted.
 *
 * Core-level proof: whole-file transcription has no core-app screen, so this drives the
 * REAL whisperService over a faked whisper.rn native context (the device boundary — the
 * only thing faked) and asserts a second transcription SUCCEEDS after a mid-flight
 * forceReset, instead of being permanently wedged.
 *
 * Delete-the-impl litmus: revert the forceReset change and the second transcribeFile
 * rejects with WhisperBusyError, turning this test red.
 */
import { whisperService, WhisperBusyError } from '../../../src/services/whisperService';

type FakeContext = { id: string; transcribe: jest.Mock };

const resetSingleton = () => {
  const s = whisperService as unknown as Record<string, unknown>;
  s.context = null;
  s.currentModelPath = null;
  s.isTranscribing = false;
  s.fileTranscribeStop = null;
  s.stopFn = null;
  s.fallbackRecorderActive = false;
};

describe('whisperService.forceReset clears the file-transcription busy lock', () => {
  beforeEach(resetSingleton);
  afterEach(resetSingleton);

  it('lets the next transcribeFile run after a forceReset during an in-flight job', async () => {
    const stopFirst = jest.fn();
    const stopSecond = jest.fn();
    const transcribe = jest
      .fn()
      // First call: stays in flight (promise never settles) so forceReset lands mid-job.
      .mockReturnValueOnce({ stop: stopFirst, promise: new Promise<never>(() => {}) })
      // Second call: resolves normally — this is what must NOT be blocked by the stale lock.
      .mockReturnValueOnce({ stop: stopSecond, promise: Promise.resolve({ result: 'second ok', segments: [] }) });

    const ctx: FakeContext = { id: 'fake-ctx', transcribe };
    const s = whisperService as unknown as Record<string, unknown>;
    s.context = ctx;
    s.currentModelPath = '/models/ggml-base.bin';

    // First transcription starts; transcribeFile sets fileTranscribeStop synchronously before its await.
    const inFlight = whisperService.transcribeFile('/a.wav');
    inFlight.catch(() => {}); // never settles; keep the runtime quiet
    await Promise.resolve();
    expect(s.fileTranscribeStop).toBe(stopFirst);

    // A realtime/dictation error path calls forceReset while the file job is in flight.
    whisperService.forceReset();
    expect(stopFirst).toHaveBeenCalled(); // best-effort native stop of the orphaned job
    expect(s.fileTranscribeStop).toBeNull(); // the lock is cleared (the fix)

    // The next transcription must NOT throw WhisperBusyError.
    let busy = false;
    const result = await whisperService.transcribeFile('/b.wav').catch((e) => {
      if (e instanceof WhisperBusyError) busy = true;
      throw e;
    });
    expect(busy).toBe(false);
    expect(result).toContain('second ok');
    expect(transcribe).toHaveBeenCalledTimes(2);
  });
});
