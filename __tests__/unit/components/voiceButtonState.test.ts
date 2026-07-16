/**
 * Pure unit layer under the VoiceRecordButton state projection (derive.ts) — drives the
 * REAL function with zero mocks. The behavior is proven at the UI by
 * __tests__/integration/chat/micDownloadIsNotLoader.rendered.redflow.test.tsx; this thin
 * layer pins every branch of the pure derivation (spec: docs/GAPS_BACKLOG.md IMG_0143 —
 * a background STT download must never render as the mic busy spinner).
 */
import { deriveVoiceButtonState, ringQuadrants } from '../../../src/components/VoiceRecordButton/derive';

const base = {
  isAvailable: false,
  isModelLoading: false,
  isTranscribing: false,
  isRecording: false,
  downloadProgressById: {} as Record<string, number>,
};

describe('deriveVoiceButtonState — the one download/load split', () => {
  it('a tap-triggered model load is the loading spinner, even while a download runs', () => {
    expect(deriveVoiceButtonState({ ...base, isModelLoading: true, downloadProgressById: { 'base.en': 0.4 } }))
      .toEqual({ kind: 'loading' });
  });

  it('transcribing (not recording) is the transcribing spinner', () => {
    expect(deriveVoiceButtonState({ ...base, isAvailable: true, isTranscribing: true }))
      .toEqual({ kind: 'transcribing' });
  });

  it('recording wins over the transcribing spinner (live mic renders, not a spinner)', () => {
    expect(deriveVoiceButtonState({ ...base, isAvailable: true, isTranscribing: true, isRecording: true }))
      .toEqual({ kind: 'ready' });
  });

  it('SPEC: another STT model already usable → normal idle mic even mid-download', () => {
    expect(deriveVoiceButtonState({ ...base, isAvailable: true, downloadProgressById: { 'base.en': 0.3 } }))
      .toEqual({ kind: 'ready' });
  });

  it('SPEC: none usable + a download in flight → downloading with that progress', () => {
    expect(deriveVoiceButtonState({ ...base, downloadProgressById: { 'base.en': 0.62 } }))
      .toEqual({ kind: 'downloading', progress: 0.62 });
  });

  it('concurrent downloads: the furthest-along model drives the ring', () => {
    expect(deriveVoiceButtonState({ ...base, downloadProgressById: { 'tiny.en': 0.1, 'base.en': 0.8 } }))
      .toEqual({ kind: 'downloading', progress: 0.8 });
  });

  it('none usable, nothing downloading → unavailable', () => {
    expect(deriveVoiceButtonState(base)).toEqual({ kind: 'unavailable' });
  });
});

describe('ringQuadrants — static determinate quadrant fill (top → right → bottom → left)', () => {
  it.each<[number, [boolean, boolean, boolean, boolean]]>([
    [0, [false, false, false, false]],
    [0.1, [true, false, false, false]],
    [0.25, [true, false, false, false]],
    [0.3, [true, true, false, false]],
    [0.62, [true, true, true, false]],
    [0.75, [true, true, true, false]],
    [1, [true, true, true, true]],
  ])('progress %p fills %p', (progress, expected) => {
    expect(ringQuadrants(progress)).toEqual(expected);
  });
});
