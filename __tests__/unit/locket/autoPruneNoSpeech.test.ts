/**
 * autoPruneRecording — no-speech HIDING behavior.
 *
 * Regression guard for the bug where 6-7 min pure-noise clips survived: the
 * native capture layer delegated "discard a file with no speech" to the JS
 * post-pass, but the post-pass only TRIMMED clips that had speech and left a
 * 0%-speech clip raw + visible. Now a clip with no usable speech is marked
 * `noSpeech` (hidden from every list) while its audio is kept on disk.
 *
 * Drives the REAL recordings store + REAL autoPruneRecording + REAL
 * isRecordingVisible; only the VAD boundary (detectSpeechSegments, which needs
 * whisper.rn + native slicing) is mocked. Deleting the marking logic makes these
 * fail, and inverting the branch (leaving raw) fails the visibility assertion.
 */
import { autoPruneRecording } from '../../../pro/locket/services/speechCleanup';
import { useRecordingsStore, isRecordingVisible, type Recording } from '../../../pro/locket/stores/recordingsStore';

// Only the VAD boundary is mocked; the decision + store writes run for real.
const mockDetect = jest.fn();
jest.mock('../../../pro/locket/services/vadDetect', () => ({
  detectSpeechSegments: (...args: unknown[]) => mockDetect(...args),
}));

const baseRec = (over: Partial<Recording> = {}): Recording => ({
  id: 'rec-1',
  path: '/docs/rec-1.wav',
  startedAt: 1_000,
  endedAt: 361_000,
  durationMs: 360_000, // 6 min
  sizeBytes: 11_520_044,
  ...over,
});

const vadResult = (speech: { startMs: number; endMs: number }[], totalMs: number) => {
  const speechMs = speech.reduce((a, s) => a + (s.endMs - s.startMs), 0);
  return {
    speech,
    gaps: [],
    totalMs,
    speechMs,
    speechPct: totalMs > 0 ? Math.round((speechMs / totalMs) * 100) : 0,
    wallMs: 1,
  };
};

const seedOne = (rec: Recording) => {
  useRecordingsStore.setState({ recordings: [rec] });
};
const current = () => useRecordingsStore.getState().recordings[0];

beforeEach(() => {
  mockDetect.mockReset();
  useRecordingsStore.setState({ recordings: [] });
});

describe('autoPruneRecording — hides no-speech clips (keeps the file)', () => {
  it('0% speech → marks noSpeech, hides it, caches the 0% verdict, does NOT delete', async () => {
    const rec = baseRec();
    seedOne(rec);
    mockDetect.mockResolvedValue(vadResult([], rec.durationMs));

    await autoPruneRecording(rec.id);

    const after = current();
    expect(after.noSpeech).toBe(true);
    expect(isRecordingVisible(after)).toBe(false);          // hidden from every list
    expect(after.vad).toEqual(
      expect.objectContaining({ speechPct: 0, speechMs: 0, totalMs: rec.durationMs, speech: [] }),
    );
    // The audio row is still present (kept on disk / in the store) - never deleted.
    expect(useRecordingsStore.getState().recordings).toHaveLength(1);
  });

  it('negligible speech (<1s across the whole clip) → also marked noSpeech + hidden', async () => {
    const rec = baseRec({ id: 'rec-2', path: '/docs/rec-2.wav' });
    seedOne(rec);
    mockDetect.mockResolvedValue(vadResult([{ startMs: 10_000, endMs: 10_500 }], rec.durationMs));

    await autoPruneRecording(rec.id);

    const after = current();
    expect(after.noSpeech).toBe(true);
    expect(isRecordingVisible(after)).toBe(false);
  });

  it('a clip WITH real speech is NOT hidden (stays visible for trim)', async () => {
    const rec = baseRec({ id: 'rec-3', path: '/docs/rec-3.wav' });
    seedOne(rec);
    // 60s of speech in a 6-min clip - real content; must not be marked noSpeech.
    mockDetect.mockResolvedValue(vadResult([{ startMs: 0, endMs: 60_000 }], rec.durationMs));

    await autoPruneRecording(rec.id);

    const after = current();
    expect(after.noSpeech).toBeFalsy();
    expect(isRecordingVisible(after)).toBe(true);
  });
});
