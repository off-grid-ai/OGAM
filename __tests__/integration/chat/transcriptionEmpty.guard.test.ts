/**
 * GUARD (integration) — transcription with no result must NOT auto-send an empty turn. The Shared
 * transcription outcome is the seam every voice-note send routes through: an empty transcript does
 * not dispatch, and it has a clear message distinct from a model-load failure.
 */
import {
  transcriptionOutcomeFrom,
  transcriptionOutcomeMessage,
  transcriptionShouldDispatch,
} from '@offgrid/application';

const outcomeFrom = (modelReady: boolean, cleanedText: string) =>
  transcriptionOutcomeFrom({ audioBytes: 1, modelReady, cleanedText });

describe('transcription empty result (guard)', () => {
  it('does not dispatch and shows a "didn\'t catch that" message when the transcript is empty', () => {
    const outcome = outcomeFrom(true, '   ');
    expect(transcriptionShouldDispatch(outcome)).toBe(false);
    expect(transcriptionOutcomeMessage(outcome)).toMatch(/catch that/i);
  });

  it('tells the user the voice model failed to load when whisper is not ready', () => {
    const outcome = outcomeFrom(false, '');
    expect(transcriptionShouldDispatch(outcome)).toBe(false);
    expect(transcriptionOutcomeMessage(outcome)).toMatch(/voice model/i);
  });

  it('dispatches the trimmed transcript when speech was heard', () => {
    const outcome = outcomeFrom(true, '  what is the capital of France  ');
    expect(transcriptionShouldDispatch(outcome)).toBe(true);
    expect(outcome).toEqual({ kind: 'transcribed', text: 'what is the capital of France' });
  });
});
